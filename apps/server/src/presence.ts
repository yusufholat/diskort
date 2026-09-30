import {
  ACTIVITY_ELAPSED_MAX_MS,
  ACTIVITY_ICON_KEY_PATTERN,
  ACTIVITY_NAME_MAX_LENGTH,
  type Activity,
  type CustomStatus,
  type SelfStatus,
  type UserStatus,
} from '@diskort/shared';
import type { StatusRow, Store } from './db.js';

/** Hiç ayarlamamış hesabın durumu */
export const DEFAULT_STATUS: SelfStatus = { status: 'online', expiresAt: null, customStatus: null, customStatusExpiresAt: null };

/** Satır sonları ve görünmez denetim karakterleri tek boşluğa iner */
export const cleanText = (raw: string): string =>
  raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

/** Aynı oyun yeniden bildirildiğinde başlangıç bu kadardan az oynadıysa eski başlangıç korunur */
const ACTIVITY_START_TOLERANCE_MS = 60_000;

/**
 * ACTIVITY_SET gövdesini (güvenilmez) doğrular: null "etkinlik bitti", undefined "geçersiz, yok sayılır".
 * Ad temizlenir (denetim karakterleri, satır sonları), süre sınırlanır, başlangıç sunucu saatiyle hesaplanır;
 * sunucuda olmayan ikon null sayılır (istemci ikonu sonradan yükleyip yeniden bildirebilir).
 */
export function parseActivityReport(
  raw: unknown,
  iconExists: (key: string) => boolean,
  now = Date.now(),
): Activity | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'object' || raw === undefined) return undefined;
  const { type, name, icon, elapsedMs } = raw as Record<string, unknown>;
  if (type !== 'game') return undefined;
  if (typeof name !== 'string' || name.length > ACTIVITY_NAME_MAX_LENGTH * 4) return undefined;
  const clean = cleanText(name);
  if (!clean || [...clean].length > ACTIVITY_NAME_MAX_LENGTH) return undefined;
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) return undefined;
  const elapsed = Math.round(Math.min(ACTIVITY_ELAPSED_MAX_MS, Math.max(0, elapsedMs)));
  const known = typeof icon === 'string' && ACTIVITY_ICON_KEY_PATTERN.test(icon) && iconExists(icon);
  return { type, name: clean, icon: known ? icon : null, startedAt: now - elapsed };
}

/**
 * Oturumun yeni etkinliği: aynı oyun yeniden bildirildiyse (ör. istemci yeniden taradı) ve başlangıç pek
 * oynamadıysa eski başlangıç korunur; böylece boşuna PRESENCE_UPDATE yayınlanmaz ve süre sayacı zıplamaz.
 */
export function mergeActivity(prev: Activity | null, next: Activity | null): Activity | null {
  if (!prev || !next || prev.type !== next.type || prev.name !== next.name) return next;
  if (Math.abs(prev.startedAt - next.startedAt) > ACTIVITY_START_TOLERANCE_MS) return next;
  return { ...next, startedAt: prev.startedAt };
}
