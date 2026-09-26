import { compareVersions } from '@diskort/shared';
import type { ReleaseService } from './releases.js';

/** Sürümünü göndermeyen istemciler: 0.1.3 öncesi (bu sürümler IDENTIFY'da sürüm bildirmezdi). */
export const LEGACY_CLIENT_VERSION = '0.1.2';

/**
 * Zorunlu güncelleme kuralı: en son yayınlanan masaüstü sürümünden eski istemciler gateway'e
 * bağlanamaz. En son sürüm bilinmiyorsa (GitHub'a hiç ulaşılamadıysa) kimse engellenmez.
 */
export class ClientVersionPolicy {
  constructor(
    private readonly releases: ReleaseService,
    private readonly enforce: boolean,
  ) {}

  /** Bağlanabilmek için gereken en düşük sürüm; kural kapalıysa veya bilinmiyorsa null. */
  async required(): Promise<string | null> {
    if (!this.enforce) return null;
    return (await this.releases.latest())?.version ?? null;
  }

  /** İstemci eskiyse kurması gereken sürümü, değilse null döner. */
  async outdated(clientVersion: string | undefined): Promise<string | null> {
    const required = await this.required();
    if (!required) return null;
    const version = typeof clientVersion === 'string' && clientVersion ? clientVersion : LEGACY_CLIENT_VERSION;
    return compareVersions(version, required) < 0 ? required : null;
  }
}
