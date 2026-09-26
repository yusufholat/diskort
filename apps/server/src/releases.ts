// İndirme sayfası için en son masaüstü sürümünü GitHub Releases'ten okur (önbellekli).
// Kullanıcılar GitHub'a gitmez: sayfa /download/<platform> adresine bağlanır, API dosyaya yönlendirir.

export type Platform = 'windows' | 'linux-appimage' | 'linux-deb' | 'mac-arm64' | 'mac-x64';

export interface PlatformAsset {
  name: string;
  size: number;
  url: string;
}

export interface LatestRelease {
  version: string;
  publishedAt: string;
  assets: Partial<Record<Platform, PlatformAsset>>;
}

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
};

export const PLATFORMS = Object.keys(MATCHERS) as Platform[];

export function pickAssets(assets: GithubAsset[]): Partial<Record<Platform, PlatformAsset>> {
  const result: Partial<Record<Platform, PlatformAsset>> = {};
  for (const platform of PLATFORMS) {
    const asset = assets.find((a) => MATCHERS[platform].test(a.name));
    if (asset) result[platform] = { name: asset.name, size: asset.size, url: asset.browser_download_url };
  }
  return result;
}

const CACHE_TTL_MS = 5 * 60_000;

export class ReleaseService {
  private cache: { at: number; value: LatestRelease } | null = null;
  private inflight: Promise<LatestRelease | null> | null = null;

  constructor(
    private readonly repo: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** En son yayınlanmış sürüm; GitHub'a ulaşılamazsa son bilinen değer (yoksa null). */
  latest(): Promise<LatestRelease | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return Promise.resolve(this.cache.value);
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<LatestRelease | null> {
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
      };
      this.cache = { at: Date.now(), value };
      return value;
    } catch {
      return this.cache?.value ?? null;
    }
  }
}
