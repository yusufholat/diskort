import { compareVersions, type ClientPlatform } from '@diskort/shared';
import { versionInName, type LatestRelease, type ReleaseService } from './releases.js';

/** Sürümünü göndermeyen masaüstü istemcileri: 0.1.3 öncesi (bu sürümler IDENTIFY'da sürüm bildirmezdi). */
export const LEGACY_CLIENT_VERSION = '0.1.2';

export function parsePlatform(value: unknown): ClientPlatform {
  return value === 'android' || value === 'ios' ? value : 'desktop';
}

/**
 * Zorunlu güncelleme kuralı, platforma göre:
 * - Masaüstü: en son yayınlanan GitHub sürümünden eski istemciler bağlanamaz.
 * - Android ve iOS: en son sürümün telefona ulaşabilen hali. Sürümde kablosuz (OTA) güncelleme varsa o sürüm
 *   (arayüz uygulama açılırken iner), yoksa APK'nın sürümü. Sunucu ayarındaki en düşük sürüm
 *   (MIN_ANDROID_VERSION / MIN_IOS_VERSION) bunun altına inilmesine izin vermez.
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
    const release = await this.releases.latest();
    if (platform === 'desktop') return release?.version ?? null;
    const floor = this.mobileMinimums[platform] ?? null;
    const latest = release ? latestMobile(release, platform).js : null;
    if (!floor) return latest;
    if (!latest) return floor;
    return compareVersions(latest, floor) > 0 ? latest : floor;
  }

  /** İstemci eskiyse kurması gereken sürümü, değilse null döner. */
  async outdated(clientVersion: unknown, platform?: unknown): Promise<string | null> {
    const required = await this.required(parsePlatform(platform));
    if (!required) return null;
    const version = typeof clientVersion === 'string' && clientVersion ? clientVersion : LEGACY_CLIENT_VERSION;
    return compareVersions(version, required) < 0 ? required : null;
  }
}

/**
 * Telefonda en son sürümün iki parçası:
 * - native: indirilecek APK'nın (iOS'ta IPA'nın) sürümü (yerel kısım değişmediyse önceki sürümünki
 *   yeniden kullanılır)
 * - js: telefona ulaşabilen arayüz sürümü (OTA varsa sürümün kendisi, yoksa uygulama paketininki)
 */
export function latestMobile(
  release: LatestRelease,
  platform: 'android' | 'ios',
): { native: string | null; js: string | null } {
  const asset = release.assets[platform];
  const native = asset ? versionInName(asset.name) : null;
  return { native, js: release.ota[platform] ? release.version : native };
}

/** Android için {@link latestMobile}: apk = APK'nın sürümü */
export function latestAndroid(release: LatestRelease): { apk: string | null; js: string | null } {
  const { native, js } = latestMobile(release, 'android');
  return { apk: native, js };
}
