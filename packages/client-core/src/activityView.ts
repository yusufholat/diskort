import { ACTIVITY_TYPE_LABELS, type Activity, type CustomStatus } from '@diskort/shared';

// Etkinliğin (oynanan oyun) gösterimi: masaüstü ve telefon aynı kuralları kullanır.

/** Geçen süre: 28 sn → "0:28", 4 dk 15 sn → "4:15", 1 sa 2 dk 5 sn → "1:02:05" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Etkinlik türünün başlığı ("Oynuyor") */
export const activityTitle = (activity: Pick<Activity, 'type'>): string => ACTIVITY_TYPE_LABELS[activity.type];

/** Tek satırlık okunuşu (ipucu ve ekran okuyucu): "Oynuyor: Oyunun Adı" */
export const activityLabel = (activity: Pick<Activity, 'type' | 'name'>): string =>
  `${activityTitle(activity)}: ${activity.name}`;

/**
 * Adın altındaki satırda gösterilecek etkinlik: özel durum önceliklidir (o varken etkinlik satırda
 * gösterilmez; profil kartında ikisi de görünür).
 */
export const sublineActivity = (
  custom: CustomStatus | null | undefined,
  activity: Activity | null | undefined,
): Activity | null => (custom ? null : (activity ?? null));
