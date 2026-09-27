// GIF araması (GIPHY): istemciler GIPHY'ye değil bize sorar; API anahtarı sunucuda kalır (GIPHY_API_KEY).
// Sonuçlar kısa süre önbellekte tutulur (aynı arama GIPHY'ye tekrar gitmez; deneme anahtarının saatlik
// sınırı düşüktür). Medya (GIF/MP4/WebP) GIPHY'nin sunucularından doğrudan yüklenir, burada aktarılmaz.
// Metni yalnızca bir GIPHY bağlantısı olan mesaja GIF gömülür (embedsFor): bilgiler seçicinin az önce
// aldığı sonuçlardan ya da GIPHY'den gelir; istemcinin gönderdiği adres ve boyutlara güvenilmez.

import type { Embed, GifEmbed, GifPage, GifResult } from '@diskort/shared';

const API = 'https://api.giphy.com/v1/gifs';
/** Sayfa başına sonuç */
export const GIF_PAGE_SIZE = 24;
/** GIPHY'nin kabul ettiği en büyük başlangıç (daha ötesi istenmez) */
export const GIF_MAX_OFFSET = 4999;
/** Arama metni en fazla bu kadar karakter (GIPHY sınırı) */
export const GIF_QUERY_MAX_LENGTH = 50;
const PAGE_TTL_MS = 5 * 60_000;
const MAX_PAGES = 300;
/** Seçicide görülen/gönderilen GIF'lerin bilgisi: mesaja gömerken GIPHY'ye yeniden sorulmaz */
const KNOWN_TTL_MS = 24 * 60 * 60_000;
const UNKNOWN_TTL_MS = 10 * 60_000;
const MAX_KNOWN = 5000;
const REQUEST_TIMEOUT_MS = 6000;
/** Mesaj gönderilirken bilinmeyen GIF için GIPHY'ye en fazla bu kadar beklenir */
const LOOKUP_TIMEOUT_MS = 3000;
/** GIPHY "çok fazla istek" dedikten sonra bu süre yalnızca önbellekten yanıt verilir */
const COOLDOWN_MS = 60_000;

export const GIF_RATINGS = ['g', 'pg', 'pg-13', 'r'] as const;

export interface GifConfig {
  /** Yoksa GIF araması kapalıdır (istemciler düğmeyi göstermez) */
  apiKey: string | null;
  /** İçerik sınırı (GIPHY "rating") */
  rating: string;
  /** Arama dili (GIPHY "lang") */
  lang: string;
}

export class GifError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const GIF_ID = /^[A-Za-z0-9]{3,64}$/;
const MEDIA_HOST = /^(?:media[0-9]?|i)\.giphy\.com$/;
const PAGE_URL = /^https:\/\/giphy\.com\/gifs\/[A-Za-z0-9-]{1,200}$/;

/** Mesaj metninde tek başına duran GIPHY bağlantısından GIF kimliği (sayfa ya da medya adresi) */
const LINK_PATTERNS = [
  /^https?:\/\/(?:www\.)?giphy\.com\/gifs\/(?:[A-Za-z0-9-]*-)?([A-Za-z0-9]+)\/?(?:[?#]\S*)?$/,
  /^https?:\/\/(?:www\.)?giphy\.com\/embed\/([A-Za-z0-9]+)\/?(?:[?#]\S*)?$/,
  /^https?:\/\/media[0-9]?\.giphy\.com\/media\/(?:v1\.[A-Za-z0-9_=-]+\/)?([A-Za-z0-9]+)\/[\w.-]+(?:[?#]\S*)?$/,
  /^https?:\/\/i\.giphy\.com\/(?:media\/(?:v1\.[A-Za-z0-9_=-]+\/)?)?([A-Za-z0-9]+)(?:\/[\w.-]+|\.(?:gif|webp|mp4))(?:[?#]\S*)?$/,
];

export function giphyIdFromLink(content: string): string | null {
  const text = content.trim();
  if (!text || text.length > 600 || /\s/.test(text)) return null;
  for (const pattern of LINK_PATTERNS) {
    const id = pattern.exec(text)?.[1];
    if (id && GIF_ID.test(id)) return id;
  }
  return null;
}

/** Yalnızca GIPHY'nin medya sunucularındaki https adresleri */
function mediaUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 1000) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && MEDIA_HOST.test(url.hostname) && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function dimension(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isInteger(n) && n > 0 && n <= 10_000 ? n : null;
}

interface GiphyRendition {
  url?: unknown;
  width?: unknown;
  height?: unknown;
  mp4?: unknown;
  webp?: unknown;
}

interface GiphyGif {
  id?: unknown;
  url?: unknown;
  title?: unknown;
  images?: Record<string, GiphyRendition | undefined>;
}

/** GIPHY'nin yanıtındaki bir GIF'i sadeleştirir; eksik ya da güvenilmez adresliyse null. */
export function normalizeGif(g: GiphyGif): GifResult | null {
  if (typeof g?.id !== 'string' || !GIF_ID.test(g.id)) return null;
  const images = g.images ?? {};
  const original = images.original;
  const small = images.downsized ?? images.downsized_medium;
  const preview = images.fixed_width;
  const width = dimension(original?.width);
  const height = dimension(original?.height);
  const gif = mediaUrl(small?.url) ?? mediaUrl(original?.url);
  const previewGif = mediaUrl(preview?.url) ?? gif;
  if (!width || !height || !gif || !previewGif) return null;
  const pageUrl = typeof g.url === 'string' && PAGE_URL.test(g.url) ? g.url : `https://giphy.com/gifs/${g.id}`;
  const title = typeof g.title === 'string' ? g.title.trim().slice(0, 140) : '';
  const previewWidth = dimension(preview?.width) ?? 200;
  return {
    id: g.id,
    url: pageUrl,
    title,
    width,
    height,
    gif,
    mp4: mediaUrl(original?.mp4),
    webp: mediaUrl(original?.webp),
    still: mediaUrl(images.original_still?.url) ?? mediaUrl(images.downsized_still?.url),
    preview: {
      gif: previewGif,
      webp: mediaUrl(preview?.webp),
      mp4: mediaUrl(preview?.mp4),
      width: previewWidth,
      height: dimension(preview?.height) ?? Math.round((previewWidth * height) / width),
    },
  };
}

export const toEmbed = ({ preview: _preview, ...gif }: GifResult): GifEmbed => ({ type: 'gif', provider: 'giphy', ...gif });

/** Önbellek anahtarı ve GIPHY'ye giden arama metni: boşluklar sadeleşir, küçük harf */
export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr').slice(0, GIF_QUERY_MAX_LENGTH);
}

interface Logger {
  warn(obj: unknown, msg?: string): void;
}

export class GifService {
  /** Sayfa önbelleği; aynı anda gelen aynı istekler tek GIPHY isteğine iner */
  private readonly pages = new Map<string, { at: number; promise: Promise<GifPage> }>();
  private readonly known = new Map<string, { at: number; embed: GifEmbed | null }>();
  private cooldownUntil = 0;
  private warnedAuth = false;

  constructor(
    private readonly config: GifConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly log?: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.apiKey);
  }

  trending(offset = 0): Promise<GifPage> {
    return this.page('trending', {}, offset);
  }

  search(query: string, offset = 0): Promise<GifPage> {
    return this.page('search', { q: normalizeQuery(query), lang: this.config.lang }, offset);
  }

  /**
   * Mesajın gömülü içeriği: metin yalnızca bir GIPHY bağlantısıysa o GIF, değilse boş. Seçiciden
   * gönderilen GIF zaten bilinir; yapıştırılan bağlantı için GIPHY'ye kısa süreli sorulur.
   */
  async embedsFor(content: string): Promise<Embed[]> {
    const id = giphyIdFromLink(content);
    if (!id || !this.enabled) return [];
    const known = this.known.get(id);
    if (known && this.now() - known.at < (known.embed ? KNOWN_TTL_MS : UNKNOWN_TTL_MS)) {
      return known.embed ? [known.embed] : [];
    }
    if (this.now() < this.cooldownUntil) return [];
    try {
      const body = await this.call(`${API}/${id}`, {}, LOOKUP_TIMEOUT_MS);
      const gif = normalizeGif((body as { data?: GiphyGif }).data ?? {});
      this.remember(id, gif ? toEmbed(gif) : null);
      return gif ? [toEmbed(gif)] : [];
    } catch (err) {
      // Bulunamayan kimlik bir süre yeniden sorulmaz; diğer hatalarda mesaj GIF'siz gider
      if (err instanceof GifError && err.code === 'gif_not_found') this.remember(id, null);
      return [];
    }
  }

  private async page(endpoint: 'trending' | 'search', params: Record<string, string>, offset: number): Promise<GifPage> {
    if (!this.enabled) throw new GifError(404, 'gifs_disabled', 'GIF araması bu sunucuda kapalı.');
    const start = Math.max(0, Math.min(GIF_MAX_OFFSET, Math.floor(offset)));
    const key = `${endpoint}\n${params.q ?? ''}\n${start}`;
    const cached = this.pages.get(key);
    if (cached && this.now() - cached.at < PAGE_TTL_MS) return cached.promise;
    if (this.now() < this.cooldownUntil) {
      throw new GifError(503, 'gifs_busy', 'GIF araması şu an çok yoğun, biraz sonra tekrar dene.');
    }

    const promise = this.call(`${API}/${endpoint}`, {
      ...params,
      limit: String(GIF_PAGE_SIZE),
      offset: String(start),
      rating: this.config.rating,
    }).then((body) => this.toPage(body, start));
    this.pages.set(key, { at: this.now(), promise });
    this.prune();
    // Hatalar önbellekte kalmaz
    promise.catch(() => {
      if (this.pages.get(key)?.promise === promise) this.pages.delete(key);
    });
    return promise;
  }

  private toPage(body: unknown, start: number): GifPage {
    const { data, pagination } = body as { data?: unknown; pagination?: { count?: unknown; total_count?: unknown } };
    const results: GifResult[] = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(data) ? (data as GiphyGif[]) : []) {
      const gif = normalizeGif(item);
      if (!gif || seen.has(gif.id)) continue;
      seen.add(gif.id);
      results.push(gif);
      this.remember(gif.id, toEmbed(gif));
    }
    const count = typeof pagination?.count === 'number' ? pagination.count : Array.isArray(data) ? data.length : 0;
    const total = typeof pagination?.total_count === 'number' ? pagination.total_count : 0;
    const nextOffset = start + count;
    const next = count > 0 && nextOffset < total && nextOffset <= GIF_MAX_OFFSET ? nextOffset : null;
    return { results, next };
  }

  /** GIPHY isteği; hatalar kullanıcıya gösterilecek GifError'a çevrilir */
  private async call(url: string, params: Record<string, string>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const query = new URLSearchParams({ api_key: this.config.apiKey ?? '', ...params });
    let res: Response;
    try {
      res = await this.fetchImpl(`${url}?${query}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      this.log?.warn({ err: String(err) }, 'GIPHY isteği başarısız');
      throw new GifError(502, 'gifs_unavailable', 'GIF\'lere şu an ulaşılamıyor, biraz sonra tekrar dene.');
    }
    if (res.status === 429) {
      this.cooldownUntil = this.now() + COOLDOWN_MS;
      this.log?.warn({}, 'GIPHY istek sınırına ulaşıldı (anahtarın saatlik sınırı)');
      throw new GifError(503, 'gifs_busy', 'GIF araması şu an çok yoğun, biraz sonra tekrar dene.');
    }
    if (res.status === 401 || res.status === 403) {
      if (!this.warnedAuth) this.log?.warn({ status: res.status }, 'GIPHY anahtarı reddedildi (GIPHY_API_KEY)');
      this.warnedAuth = true;
      throw new GifError(503, 'gifs_unavailable', 'GIF araması şu an kullanılamıyor.');
    }
    if (res.status === 404) throw new GifError(404, 'gif_not_found', 'GIF bulunamadı.');
    if (!res.ok) {
      this.log?.warn({ status: res.status }, 'GIPHY hata döndü');
      throw new GifError(502, 'gifs_unavailable', 'GIF\'lere şu an ulaşılamıyor, biraz sonra tekrar dene.');
    }
    try {
      return await res.json();
    } catch {
      throw new GifError(502, 'gifs_unavailable', 'GIF\'lere şu an ulaşılamıyor, biraz sonra tekrar dene.');
    }
  }

  private remember(id: string, embed: GifEmbed | null): void {
    this.known.delete(id); // en yeni sona geçer
    this.known.set(id, { at: this.now(), embed });
    while (this.known.size > MAX_KNOWN) this.known.delete(this.known.keys().next().value!);
  }

  private prune(): void {
    if (this.pages.size <= MAX_PAGES) return;
    const now = this.now();
    for (const [key, entry] of this.pages) if (now - entry.at >= PAGE_TTL_MS) this.pages.delete(key);
    while (this.pages.size > MAX_PAGES) this.pages.delete(this.pages.keys().next().value!);
  }
}
