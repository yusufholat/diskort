import { compareVersions, type ClientPlatform } from '@diskort/shared';
import type { ReleaseService } from './releases.js';

/** Sürümünü göndermeyen masaüstü istemcileri: 0.1.3 öncesi (bu sürümler IDENTIFY'da sürüm bildirmezdi). */
export const LEGACY_CLIENT_VERSION = '0.1.2';

export function parsePlatform(value: unknown): ClientPlatform {
  return value === 'android' || value === 'ios' ? value : 'desktop';
}

/**
 * Zorunlu güncelleme kuralı, platforma göre:
 * - Masaüstü: en son yayınlanan GitHub sürümünden eski istemciler bağlanamaz.
 * - Android/iOS: sunucu ayarındaki en düşük sürüm (MIN_ANDROID_VERSION / MIN_IOS_VERSION). Mobil
 *   arayüz güncellemeleri uygulama açılırken kendiliğinden iner; bu kural yalnızca uyumsuz yerel
 *   sürümleri durdurmak içindir.
 * En düşük sürüm bilinmiyorsa (GitHub'a ulaşılamadı, ayar yok) kimse engellenmez.
 */
export class ClientVersionPolicy {
  constructor(
    private readonly releases: ReleaseService,
    private readonly enforce: boolean,
    private readonly mobileMinimums: Partial<Record<'android' | 'ios', string | null>> = {},
  ) {}

  /** Bağlanabilmek için gereken en düşük sürüm; kural kapalıysa veya bilinmiyorsa null. */
  async required(platform: ClientPlatform = 'desktop'): Promise<string | null> {
    if (!this.enforce) return null;
    if (platform !== 'desktop') return this.mobileMinimums[platform] ?? null;
    return (await this.releases.latest())?.version ?? null;
  }

  /** İstemci eskiyse kurması gereken sürümü, değilse null döner. */
  async outdated(clientVersion: unknown, platform?: unknown): Promise<string | null> {
    const required = await this.required(parsePlatform(platform));
    if (!required) return null;
    const version = typeof clientVersion === 'string' && clientVersion ? clientVersion : LEGACY_CLIENT_VERSION;
    return compareVersions(version, required) < 0 ? required : null;
  }
}
