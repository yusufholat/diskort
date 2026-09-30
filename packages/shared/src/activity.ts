// Etkinlik: kişinin o an yaptığı şey (şimdilik yalnızca oynadığı oyun). Kalıcı değildir; bildiren
// oturum kapanınca ya da kişi görünmez olunca kaybolur.

/** Etkinlik türü; ileride 'listening' (müzik) gibi türler eklenebilir: bilinmeyen tür gösterilmez */
export type ActivityType = 'game';

/** Başkalarının gördüğü etkinlik */
export interface Activity {
  type: ActivityType;
  /** Oyunun adı */
  name: string;
  /** İkon anahtarı (bkz. ACTIVITY_ICON_KEY_PATTERN); ikon yoksa null */
  icon: string | null;
  /** Başladığı an (ms, sunucu saati) */
  startedAt: number;
}

/**
 * ACTIVITY_SET gövdesi. Başlangıç istemcinin saatinden bağımsız olsun diye "şu ana dek geçen süre"
 * olarak gönderilir; sunucu `startedAt`'i kendi saatiyle hesaplar.
 */
export interface ActivityReport {
  type: ActivityType;
  name: string;
  icon: string | null;
  elapsedMs: number;
}

export const ACTIVITY_NAME_MAX_LENGTH = 64;
/** Bildirilebilecek en uzun geçmiş süre (saat hatası ya da kötü niyetli değerlere karşı) */
export const ACTIVITY_ELAPSED_MAX_MS = 7 * 24 * 60 * 60_000;

/** İkon: PNG, kare, en fazla bu kenar ve bu boyut. Anahtarı dosyanın SHA-256'sı (küçük harf onaltılık) */
export const ACTIVITY_ICON_MAX_SIZE_PX = 128;
export const ACTIVITY_ICON_MAX_BYTES = 64 * 1024;
export const ACTIVITY_ICON_KEY_PATTERN = /^[0-9a-f]{64}$/;

/** İkonun yolu: PUT ile yüklenir (gövde PNG), GET ile okunur */
export const activityIconPath = (key: string): string => `/api/activity-icons/${key}`;

/** Etkinlik türünün başlığı (kartta: "Oynuyor") */
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  game: 'Oynuyor',
};

export const sameActivity = (a: Activity | null | undefined, b: Activity | null | undefined): boolean =>
  (a ?? null) === (b ?? null) ||
  (!!a && !!b && a.type === b.type && a.name === b.name && a.icon === b.icon && a.startedAt === b.startedAt);
