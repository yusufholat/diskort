import type { CustomStatus, SelfStatus, UserStatus } from '@diskort/shared';
import type { StatusRow, Store } from './db.js';

/** Hiç ayarlamamış hesabın durumu */
export const DEFAULT_STATUS: SelfStatus = { status: 'online', expiresAt: null, customStatus: null, customStatusExpiresAt: null };

/** Kaydedilmiş satırın geçerli yorumu: süresi geçmiş değerler yok sayılır */
function toSelfStatus(row: StatusRow | undefined, now: number): SelfStatus {
  if (!row) return DEFAULT_STATUS;
  const statusLive = row.status_expires_at === null || row.status_expires_at > now;
  const customLive =
    (row.custom_text !== null || row.custom_emoji !== null) &&
    (row.custom_expires_at === null || row.custom_expires_at > now);
  return {
    status: statusLive ? row.status : 'online',
    expiresAt: statusLive && row.status !== 'online' ? row.status_expires_at : null,
    customStatus: customLive ? { text: row.custom_text, emoji: row.custom_emoji } : null,
    customStatusExpiresAt: customLive ? row.custom_expires_at : null,
  };
}

export interface StatusChange {
  status?: UserStatus;
  expiresInMs?: number | null;
  customStatus?: (CustomStatus & { expiresInMs?: number | null }) | null;
}

/**
 * Hesabın kendi seçtiği durum (kalıcı; tüm cihazlarda aynı) ve özel durumu. Başkalarına görünen durum
 * (bağlı oturumlar ve otomatik "boşta" ile birleşik hâli) gateway'de hesaplanır.
 */
export class StatusStore {
  constructor(private readonly store: Store) {}

  get(userId: string, now = Date.now()): SelfStatus {
    return toSelfStatus(this.store.getStatusRow(userId), now);
  }

  /** Değişikliği uygular; verilmeyen alanlar olduğu gibi kalır. Yeni durumu döner. */
  set(userId: string, change: StatusChange, now = Date.now()): SelfStatus {
    const current = this.get(userId, now);
    let status = current.status;
    let expiresAt = current.expiresAt;
    if (change.status !== undefined) {
      status = change.status;
      // Çevrim içi süresizdir (zaten varsayılan)
      expiresAt = status !== 'online' && change.expiresInMs ? now + change.expiresInMs : null;
    }
    let custom = current.customStatus;
    let customExpiresAt = current.customStatusExpiresAt;
    if (change.customStatus !== undefined) {
      const c = change.customStatus;
      custom = c && (c.text || c.emoji) ? { text: c.text || null, emoji: c.emoji || null } : null;
      customExpiresAt = custom && c?.expiresInMs ? now + c.expiresInMs : null;
    }
    this.store.saveStatusRow({
      user_id: userId,
      status,
      status_expires_at: expiresAt,
      custom_text: custom?.text ?? null,
      custom_emoji: custom?.emoji ?? null,
      custom_expires_at: customExpiresAt,
    });
    return this.get(userId, now);
  }

  /** Süresi dolanları varsayılana çeker; değişen hesapları döner */
  expire(now = Date.now()): string[] {
    return this.store.expireStatuses(now);
  }

  /** Rahatsız Etmeyin'deki hesaplar hariç (telefon bildirimi gidecekler) */
  withoutDnd(userIds: string[], now = Date.now()): string[] {
    const dnd = this.store.dndUserIds(userIds, now);
    return dnd.size === 0 ? userIds : userIds.filter((id) => !dnd.has(id));
  }
}
