import type { OtaPlatform, ReleaseService } from './releases.js';

export interface OtaUpdate {
  version: string;
  runtimeVersion: string;
  /** Güncelleme kimliği (bildirimdeki id) */
  id: string;
  /** İmzalı bildirim metni: telefona olduğu gibi gönderilir, imza tam olarak bu metnin üstündedir */
  manifest: string;
  /** Bildirimin RSA-SHA256 imzası (base64); anahtar sunucuda değil, derleme sisteminde durur */
  signature: string;
}

const RETRY_MS = 60_000;

interface Entry {
  url: string;
  at: number;
  promise: Promise<OtaUpdate | null>;
  failed: boolean;
}

/**
 * Telefonların kablosuz (OTA) güncellemesi: en son sürümdeki imzalı bildirimi (CI'ın ürettiği
 * Diskort-<sürüm>-ota-<platform>.json) okur ve önbellekte tutar. Sunucu bildirimi değiştiremez;
 * telefon imzayı uygulamanın içindeki sertifikayla doğrular.
 */
export class OtaService {
  private readonly entries = new Map<OtaPlatform, Entry>();

  constructor(
    private readonly releases: ReleaseService,
    private readonly log?: { warn(obj: unknown, msg?: string): void },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** En son sürümün bu platform için güncellemesi; yoksa ya da okunamadıysa null. */
  async latest(platform: OtaPlatform): Promise<OtaUpdate | null> {
    const release = await this.releases.latest();
    const asset = release?.ota[platform];
    if (!release || !asset) return null;

    const cached = this.entries.get(platform);
    if (cached && cached.url === asset.url && !(cached.failed && Date.now() - cached.at > RETRY_MS)) {
      return cached.promise;
    }
    const entry: Entry = { url: asset.url, at: Date.now(), failed: false, promise: Promise.resolve(null) };
    entry.promise = this.load(asset.url, platform, release.version).then((update) => {
      entry.failed = update === null;
      return update;
    });
    this.entries.set(platform, entry);
    return entry.promise;
  }

  private async load(url: string, platform: OtaPlatform, version: string): Promise<OtaUpdate | null> {
    try {
      const res = await this.fetchImpl(url, {
        headers: { 'User-Agent': 'diskort-server' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Partial<Record<string, unknown>>;
      const { manifest, signature, runtimeVersion } = body;
      if (typeof manifest !== 'string' || typeof signature !== 'string' || typeof runtimeVersion !== 'string') {
        throw new Error('eksik alan');
      }
      if (body.platform !== platform || body.version !== version) throw new Error('platform ya da sürüm uyuşmuyor');
      const parsed = JSON.parse(manifest) as { id?: unknown; runtimeVersion?: unknown };
      if (typeof parsed.id !== 'string' || parsed.runtimeVersion !== runtimeVersion) {
        throw new Error('bildirim bozuk');
      }
      return { version, runtimeVersion, id: parsed.id, manifest, signature };
    } catch (err) {
      this.log?.warn({ err: String(err), url }, 'OTA güncelleme bildirimi okunamadı');
      return null;
    }
  }
}
