// Bağlantı önizlemeleri (Discord'daki "embed"): mesajdaki adresler arka planda açılır, sayfanın
// OpenGraph/Twitter kartı bilgileri ya da YouTube oEmbed'i okunur. Doğrudan resim/GIF bağlantıları resim,
// video dosyaları video önizlemesi olur. X/Twitter gönderileri için FxTwitter'ın herkese açık API'si
// kullanılır (x.com botlara bilgi vermez). Tüm istekler safeFetch'ten (SSRF korumalı) geçer; resimler
// EmbedMediaService ile sunucumuz üzerinden verilir. Sonuçlar veritabanında önbelleğe alınır (başarılı
// 24 saat, önizlemesiz 1 saat, ağ hatası 10 dakika). Aynı anda en fazla 6 istek, alan adı başına 2.

import type { LinkEmbed, LinkEmbedImage } from '@diskort/shared';
import type { Store } from './db.js';
import type { EmbedMediaService, Fetcher } from './embedMedia.js';
import { EMBED_MEDIA_MAX_BYTES } from './embedMedia.js';
import {
  cleanLine,
  cleanText,
  decodeHtml,
  DESCRIPTION_MAX,
  NAME_MAX,
  parseHtmlMeta,
  TITLE_MAX,
  type PageMeta,
} from './htmlMeta.js';
import { ConcurrencyLimiter, KeyedLimiter } from './limiter.js';
import { FetchError, readCapped, safeFetch } from './safeFetch.js';

const POSITIVE_TTL_MS = 24 * 60 * 60_000;
const NEGATIVE_TTL_MS = 60 * 60_000;
const ERROR_TTL_MS = 10 * 60_000;
/** Sayfanın en fazla bu kadarı okunur (<head> genelde çok daha kısadır) */
const HTML_MAX_BYTES = 1024 * 1024;
const JSON_MAX_BYTES = 256 * 1024;
const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,image/*;q=0.8,video/*;q=0.5,*/*;q=0.1';
const TWEET_TEXT_MAX = 1000;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/pjpeg', 'image/gif', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

// ---------- Özel siteler ----------

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

/** "90", "90s", "1m30s", "1h2m3s" → saniye */
export function parseYoutubeTime(raw: string | null): number | null {
  if (!raw) return null;
  if (/^\d+s?$/.test(raw)) return Number.parseInt(raw, 10) || null;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const total = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return total > 0 ? total : null;
}

/** YouTube video bağlantısıysa kimliği ve başlangıç saniyesi */
export function youtubeVideo(raw: string): { id: string; start: number | null } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (parts[0] && ['shorts', 'live', 'embed', 'v'].includes(parts[0])) id = parts[1] ?? null;
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { id, start: parseYoutubeTime(url.searchParams.get('t') ?? url.searchParams.get('start')) };
}

const TWEET_HOSTS = new Set([
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'fxtwitter.com',
  'vxtwitter.com',
  'fixupx.com',
  'fixvx.com',
]);

/** X/Twitter gönderi bağlantısıysa kullanıcı adı ve gönderi kimliği */
export function tweetOf(raw: string): { user: string; id: string } | null {
  try {
    const url = new URL(raw);
    if (!TWEET_HOSTS.has(url.hostname.toLowerCase())) return null;
    const m = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})(?:\/|$)/.exec(url.pathname);
    return m ? { user: m[1]!, id: m[2]! } : null;
  } catch {
    return null;
  }
}

// ---------- Hizmet ----------

interface Logger {
  warn(obj: unknown, msg?: string): void;
}

/** Önizleme alınamadı: önbellekte ne kadar kalacağıyla */
class NoPreview extends Error {
  constructor(readonly ttl: number) {
    super('önizleme yok');
  }
}

export class LinkPreviewService {
  private readonly inflight = new Map<string, Promise<LinkEmbed | null>>();
  private readonly global = new ConcurrencyLimiter(6, 500);
  private readonly perHost = new KeyedLimiter(2, 50);
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly store: Store,
    private readonly media: EmbedMediaService,
    private readonly fetcher: Fetcher = safeFetch,
    private readonly log?: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Arka plan işini izler (testler ve kapanış için idle()) */
  track(work: Promise<unknown>): void {
    const tracked = work.catch((err: unknown) => this.log?.warn({ err: String(err) }, 'bağlantı önizlemesi başarısız'));
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  /** Süren tüm arka plan işleri bitince */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /** Yalnızca önbellekten (süresi geçmemişse); bilinmiyorsa undefined */
  cached(url: string): LinkEmbed | null | undefined {
    return this.store.getLinkPreview(url, this.now());
  }

  /** Adreslerin önizlemeleri (sırasıyla; önizlemesi olmayanlar atlanır) */
  async embedsFor(urls: string[]): Promise<LinkEmbed[]> {
    const results = await Promise.all(urls.map((url) => this.resolve(url)));
    return results.filter((e): e is LinkEmbed => e !== null);
  }

  /** Tek adresin önizlemesi: önbellekten ya da açılarak */
  resolve(url: string): Promise<LinkEmbed | null> {
    const cached = this.cached(url);
    if (cached !== undefined) return Promise.resolve(cached);
    const running = this.inflight.get(url);
    if (running) return running;
    const promise = this.load(url).finally(() => this.inflight.delete(url));
    this.inflight.set(url, promise);
    return promise;
  }

  private async load(url: string): Promise<LinkEmbed | null> {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
    let embed: LinkEmbed | null = null;
    let ttl = POSITIVE_TTL_MS;
    try {
      embed = await this.perHost.run(host, () => this.global.run(() => this.build(url)));
      if (!embed) ttl = NEGATIVE_TTL_MS;
    } catch (err) {
      if (err instanceof NoPreview) ttl = err.ttl;
      else if (err instanceof FetchError) ttl = err.code === 'timeout' || err.code === 'network' ? ERROR_TTL_MS : NEGATIVE_TTL_MS;
      // Sıra dolu: önbelleğe yazılmaz, sonraki mesajda yeniden denenir
      else return null;
      embed = null;
    }
    this.store.setLinkPreview(url, embed, this.now() + ttl, this.now());
    return embed;
  }

  private async build(url: string): Promise<LinkEmbed | null> {
    const video = youtubeVideo(url);
    if (video) return this.youtube(url, video.id, video.start);
    const tweet = tweetOf(url);
    if (tweet) {
      const embed = await this.tweet(url, tweet).catch(() => null);
      if (embed) return embed;
    }
    return this.generic(url);
  }

  private async image(url: string | null): Promise<LinkEmbedImage | null> {
    if (!url) return null;
    const file = await this.media.get(url, true);
    return file && file.width && file.height ? { url: this.media.sign(url), width: file.width, height: file.height } : null;
  }

  private async json(url: string): Promise<unknown> {
    const res = await this.fetcher(url, { accept: 'application/json' });
    if (!res.contentType.includes('json')) {
      res.close();
      throw new NoPreview(NEGATIVE_TTL_MS);
    }
    const { data } = await readCapped(res, JSON_MAX_BYTES);
    try {
      return JSON.parse(data.toString('utf8')) as unknown;
    } catch {
      throw new NoPreview(NEGATIVE_TTL_MS);
    }
  }

  private async youtube(url: string, id: string, start: number | null): Promise<LinkEmbed | null> {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    // Özel/silinmiş videoda oEmbed 401/404 döner: önizleme yok
    const data = (await this.json(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`)) as {
      title?: unknown;
      author_name?: unknown;
    };
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return {
      type: 'link',
      kind: 'youtube',
      url,
      siteName: 'YouTube',
      title: cleanLine(str(data.title), TITLE_MAX),
      description: null,
      author: cleanLine(str(data.author_name), NAME_MAX),
      color: '#ff0000',
      image: await this.image(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`),
      largeImage: true,
      youtubeId: id,
      youtubeStart: start,
    };
  }

  private async tweet(url: string, tweet: { user: string; id: string }): Promise<LinkEmbed | null> {
    const body = (await this.json(`https://api.fxtwitter.com/${tweet.user}/status/${tweet.id}`)) as {
      tweet?: {
        text?: unknown;
        author?: { name?: unknown; screen_name?: unknown };
        media?: { photos?: { url?: unknown }[]; videos?: { thumbnail_url?: unknown }[] };
      };
    };
    const t = body?.tweet;
    if (!t) return null;
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const name = cleanLine(str(t.author?.name), NAME_MAX);
    const handle = str(t.author?.screen_name);
    const media = str(t.media?.photos?.[0]?.url) ?? str(t.media?.videos?.[0]?.thumbnail_url);
    const image = await this.image(media && /^https:\/\//.test(media) ? media : null);
    return {
      type: 'link',
      kind: 'article',
      url,
      siteName: 'X',
      title: name ? cleanLine(handle ? `${name} (@${handle})` : name, TITLE_MAX) : null,
      description: cleanText(str(t.text), TWEET_TEXT_MAX),
      author: null,
      color: '#1d9bf0',
      image,
      largeImage: true,
    };
  }

  private async generic(url: string): Promise<LinkEmbed | null> {
    const res = await this.fetcher(url, { accept: HTML_ACCEPT });
    const type = res.contentType;
    const base = { type: 'link' as const, url, author: null, color: null, description: null };
    if (IMAGE_TYPES.has(type)) {
      const { data } = await readCapped(res, EMBED_MEDIA_MAX_BYTES);
      const file = await this.media.ingest(url, data);
      if (!file) return null;
      return {
        ...base,
        kind: 'image',
        siteName: null,
        title: null,
        image: { url: this.media.sign(url), width: file.width, height: file.height },
        largeImage: true,
      };
    }
    if (VIDEO_TYPES.has(type)) {
      res.close();
      return { ...base, kind: 'video', siteName: cleanLine(new URL(res.url).hostname, NAME_MAX), title: null, image: null, largeImage: true, video: { url } };
    }
    if (type !== 'text/html' && type !== 'application/xhtml+xml') {
      res.close();
      return null;
    }
    const { data } = await readCapped(res, HTML_MAX_BYTES, true);
    const meta: PageMeta = parseHtmlMeta(decodeHtml(data, res.charset), res.url);
    if (!meta.title && !meta.description && !meta.image) return null;
    const image = await this.image(meta.image);
    const large =
      image !== null &&
      (meta.card === 'summary_large_image' || (meta.card === null && image.width >= 400 && image.width >= image.height));
    return {
      type: 'link',
      kind: 'article',
      url,
      siteName: meta.siteName,
      title: meta.title,
      description: meta.description ? cleanText(meta.description, DESCRIPTION_MAX) : null,
      author: meta.author,
      color: meta.color,
      image,
      largeImage: large,
    };
  }

  /** Temizlik: süresi geçmiş önbellek kayıtları */
  sweep(): void {
    this.store.sweepLinkPreviews(this.now());
  }
}
