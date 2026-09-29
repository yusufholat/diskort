// En son masaüstü sürümünü GitHub Releases'ten okur (önbellekli). İndirme sayfası, güncelleme
// yönlendirmeleri ve "eski istemci bağlanamaz" kuralı bu tek kaynağı kullanır.
// Kullanıcılar GitHub'a gitmez: sayfa /download/<platform> adresine bağlanır, API dosyaya yönlendirir.

import { compareVersions } from '@diskort/shared';

export type Platform = 'windows' | 'linux-appimage' | 'linux-deb' | 'mac-arm64' | 'mac-x64' | 'android' | 'ios';

export interface PlatformAsset {
  name: string;
  size: number;
  url: string;
}

export interface LatestRelease {
  version: string;
  publishedAt: string;
  assets: Partial<Record<Platform, PlatformAsset>>;
  /** Kablosuz (OTA) güncelleme bildirimleri: Diskort-<sürüm>-ota-<platform>.json */
  ota: Partial<Record<OtaPlatform, PlatformAsset>>;
}

export type OtaPlatform = 'android' | 'ios';

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

const MATCHERS: Record<Platform, RegExp> = {
  windows: /setup.*\.exe$/i,
  'linux-appimage': /\.appimage$/i,
  'linux-deb': /\.deb$/i,
  'mac-arm64': /arm64\.dmg$/i,
  'mac-x64': /x64\.dmg$/i,
  // Hepsini içeren APK (ilk kurulum); işlemciye özel olanlar yalnızca uygulama içi güncellemede
  android: /-android\.apk$/i,
  // Ad Hoc imzalı iOS uygulaması: yalnızca UDID'si kayıtlı cihazlara kurulur (bkz. docs/ios.md)
  ios: /-ios\.ipa$/i,
};

export const PLATFORMS = Object.keys(MATCHERS) as Platform[];

const OTA_MATCHERS: Record<OtaPlatform, RegExp> = {
  android: /-ota-android\.json$/i,
  ios: /-ota-ios\.json$/i,
};

/** Dosya adındaki sürüm: Diskort-0.2.1-android.apk → 0.2.1 */
export function versionInName(name: string): string | null {
  return /(?:^|[-_])v?(\d+\.\d+\.\d+)(?=[-_.])/.exec(name)?.[1] ?? null;
}

function toAsset(asset: GithubAsset): PlatformAsset {
  return { name: asset.name, size: asset.size, url: asset.browser_download_url };
}

export function pickAssets(assets: GithubAsset[]): Partial<Record<Platform, PlatformAsset>> {
  const result: Partial<Record<Platform, PlatformAsset>> = {};
  for (const platform of PLATFORMS) {
    const asset = assets.find((a) => MATCHERS[platform].test(a.name));
    if (asset) result[platform] = toAsset(asset);
  }
  return result;
}

export function pickOtaAssets(assets: GithubAsset[]): Partial<Record<OtaPlatform, PlatformAsset>> {
  const result: Partial<Record<OtaPlatform, PlatformAsset>> = {};
  for (const [platform, matcher] of Object.entries(OTA_MATCHERS) as [OtaPlatform, RegExp][]) {
    const asset = assets.find((a) => matcher.test(a.name));
    if (asset) result[platform] = toAsset(asset);
  }
  return result;
}

const CACHE_TTL_MS = 5 * 60_000;
/**
 * GitHub'ı yoklama aralığı: yeni sürüm (OTA, APK, masaüstü) en geç bu kadar sonra görülür. Koşullu istek
 * (ETag) kullanılır: sürüm değişmediyse GitHub 304 döner ve bu istek kimliksiz sınırdan (saatte 60) düşmez;
 * düşse de saatte 30 istek sınırın altında kalır.
 */
const POLL_INTERVAL_MS = 2 * 60_000;
/** Notlarda bilinmeyen yeni bir sürüm görülünce sürüm bilgisi en fazla bu sıklıkta tazelenir */
const NOTES_REFRESH_MIN_MS = 30_000;

type ReleaseListener = (release: LatestRelease) => void;

/** Uygulama içi "Yenilikler" sayfası için bir sürümün notları */
export interface ReleaseNotes {
  version: string;
  publishedAt: string;
  /** Sürüm notları (Markdown: başlıklar, madde işaretleri, kalın yazı) */
  notes: string;
}

const NOTES_LIMIT = 30;

export class ReleaseService {
  private notesCache: { at: number; value: ReleaseNotes[] } | null = null;
  private notesInflight: Promise<ReleaseNotes[]> | null = null;
  private cache: { at: number; value: LatestRelease } | null = null;
  /** Son başarılı yanıtın ETag'i (koşullu istek için) */
  private etag: string | null = null;
  private inflight: Promise<LatestRelease | null> | null = null;
  private readonly listeners = new Set<ReleaseListener>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * En son yayınlanmış sürüm; GitHub'a ulaşılamazsa son bilinen değer (yoksa null). Bilinen bir değer varsa
   * GitHub beklenmez: süresi dolduysa arka planda tazelenir (telefonun açılıştaki güncelleme denetimi 4 sn'de
   * vazgeçer; GitHub'ın yavaşlığı OTA'yı kaçırtmasın). Yeni sürüm yoklamayla (startPolling) görülür.
   */
  latest(): Promise<LatestRelease | null> {
    if (this.cache) {
      if (Date.now() - this.cache.at >= CACHE_TTL_MS) void this.refresh();
      return Promise.resolve(this.cache.value);
    }
    return this.refresh();
  }

  /** Son bilinen sürüm, GitHub'a gitmeden (henüz okunmadıysa null; yönetim paneli) */
  known(): LatestRelease | null {
    return this.cache?.value ?? null;
  }

  /**
   * Yayınlanmış son sürümlerin notları, yeniden eskiye (önbellekli; GitHub'a ulaşılamazsa son bilinen).
   * Notlar en son sürüm bilgisinden önce tazelenmiş olabilir: bilinen en son sürümden yeni bir not görülürse
   * sürüm bilgisi tazelenir, o sürüm yine de görülmediyse notu gösterilmez (telefonda "Yenilikler" APK /
   * OTA güncellemesinden önce çıkmasın).
   */
  async recentNotes(): Promise<ReleaseNotes[]> {
    const notes = await this.loadNotes();
    const known = await this.latest();
    if (!known) return notes;
    // Arka plandaki tazeleme bu arada bitmiş olabilir: önbellekteki en güncel değer
    let latest = this.cache?.value.version ?? known.version;
    const ahead = notes.some((n) => compareVersions(n.version, latest) > 0);
    // Sık tazelenmez: "en son" işaretlenmemiş yeni bir sürüm varsa her istek GitHub'a gitmesin
    if (ahead && (!this.cache || Date.now() - this.cache.at >= NOTES_REFRESH_MIN_MS)) {
      latest = (await this.refresh())?.version ?? latest;
    }
    return notes.filter((n) => compareVersions(n.version, latest) <= 0);
  }

  private loadNotes(): Promise<ReleaseNotes[]> {
    if (this.notesCache && Date.now() - this.notesCache.at < CACHE_TTL_MS) {
      return Promise.resolve(this.notesCache.value);
    }
    this.notesInflight ??= this.fetchNotes().finally(() => {
      this.notesInflight = null;
    });
    return this.notesInflight;
  }

  private async fetchNotes(): Promise<ReleaseNotes[]> {
    try {
      const res = await this.fetchImpl(`https://api.github.com/repos/${this.repo}/releases?per_page=${NOTES_LIMIT}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'diskort-server' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const body = (await res.json()) as {
        tag_name: string;
        published_at: string | null;
        body: string | null;
        draft: boolean;
        prerelease: boolean;
      }[];
      const value = body
        .filter((r) => !r.draft && !r.prerelease && r.published_at)
        .map((r) => ({ version: r.tag_name.replace(/^v/, ''), publishedAt: r.published_at!, notes: r.body ?? '' }));
      this.notesCache = { at: Date.now(), value };
      return value;
    } catch {
      return this.notesCache?.value ?? [];
    }
  }

  /** Yeni bir sürüm yayınlandığında (sürüm numarası değişince) çağrılır. */
  onNewRelease(listener: ReleaseListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Düzenli aralıklarla GitHub'ı yoklar; böylece yeni sürüm birkaç dakika içinde fark edilir. */
  startPolling(intervalMs = POLL_INTERVAL_MS): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref();
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private refresh(): Promise<LatestRelease | null> {
    this.inflight ??= this.fetchLatest().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchLatest(): Promise<LatestRelease | null> {
    try {
      const etag = this.cache ? this.etag : null;
      const res = await this.fetchImpl(`https://api.github.com/repos/${this.repo}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'diskort-server',
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
        signal: AbortSignal.timeout(8000),
      });
      // Değişmedi: bilinen sürüm geçerli
      if (res.status === 304 && this.cache) {
        this.cache = { at: Date.now(), value: this.cache.value };
        return this.cache.value;
      }
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const body = (await res.json()) as { tag_name: string; published_at: string; assets: GithubAsset[] };
      const value: LatestRelease = {
        version: body.tag_name.replace(/^v/, ''),
        publishedAt: body.published_at,
        assets: pickAssets(body.assets),
        ota: pickOtaAssets(body.assets),
      };
      const previous = this.cache?.value.version;
      this.cache = { at: Date.now(), value };
      this.etag = res.headers?.get('etag') ?? null;
      if (previous && previous !== value.version) {
        // Yeni sürümün notları da hemen görünsün
        this.notesCache = null;
        for (const listener of this.listeners) listener(value);
      }
      return value;
    } catch {
      return this.cache?.value ?? null;
    }
  }
}
