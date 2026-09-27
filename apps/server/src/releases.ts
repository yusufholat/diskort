// En son masaüstü sürümünü GitHub Releases'ten okur (önbellekli). İndirme sayfası, güncelleme
// yönlendirmeleri ve "eski istemci bağlanamaz" kuralı bu tek kaynağı kullanır.
// Kullanıcılar GitHub'a gitmez: sayfa /download/<platform> adresine bağlanır, API dosyaya yönlendirir.

export type Platform = 'windows' | 'linux-appimage' | 'linux-deb' | 'mac-arm64' | 'mac-x64' | 'android';

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

export type OtaPlatform = 'android';

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
};

export const PLATFORMS = Object.keys(MATCHERS) as Platform[];

const OTA_MATCHERS: Record<OtaPlatform, RegExp> = {
  android: /-ota-android\.json$/i,
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

type ReleaseListener = (release: LatestRelease) => void;

export class ReleaseService {
  private cache: { at: number; value: LatestRelease } | null = null;
  private inflight: Promise<LatestRelease | null> | null = null;
  private readonly listeners = new Set<ReleaseListener>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** En son yayınlanmış sürüm; GitHub'a ulaşılamazsa son bilinen değer (yoksa null). */
  latest(): Promise<LatestRelease | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return Promise.resolve(this.cache.value);
    return this.refresh();
  }

  /** Yeni bir sürüm yayınlandığında (sürüm numarası değişince) çağrılır. */
  onNewRelease(listener: ReleaseListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Düzenli aralıklarla GitHub'ı yoklar; böylece yeni sürüm birkaç dakika içinde fark edilir. */
  startPolling(intervalMs = CACHE_TTL_MS): void {
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
      const res = await this.fetchImpl(`https://api.github.com/repos/${this.repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'diskort-server' },
        signal: AbortSignal.timeout(8000),
      });
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
      if (previous && previous !== value.version) {
        for (const listener of this.listeners) listener(value);
      }
      return value;
    } catch {
      return this.cache?.value ?? null;
    }
  }
}
