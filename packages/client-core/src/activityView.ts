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

/** Adın altındaki satırın yazısı: özel durum, oyunun adı, "Sesli sohbette" ya da hiçbiri (yerin kendi yazısı) */
export type SublineText = 'custom' | 'activity' | 'voice' | null;

export interface PresenceSubline {
  /** Oyun simgesi: oynuyor (yazı özel durumsa oyunun adı simgenin ipucundadır) */
  showGame: boolean;
  /** Ses simgesi: bir ses kanalında */
  showVoice: boolean;
  text: SublineText;
}

/**
 * Adın altındaki satır (üye listesi, DM'ler): önce küçük durum simgeleri (oyun, ses), sonra tek bir yazı.
 * Yazıda özel durum önceliklidir; yoksa oyunun adı, o da yoksa "Sesli sohbette". Ses bilgisi sunucuya
 * aittir: DM'lerde `inVoice` verilmez.
 */
export function presenceSubline(state: {
  custom: CustomStatus | null | undefined;
  activity: Activity | null | undefined;
  inVoice?: boolean;
}): PresenceSubline {
  const showGame = Boolean(state.activity);
  const showVoice = Boolean(state.inVoice);
  return { showGame, showVoice, text: state.custom ? 'custom' : showGame ? 'activity' : showVoice ? 'voice' : null };
}

/** Özel durumun tek satırlık yazısı: emoji ve metin */
export const customStatusText = (custom: CustomStatus): string =>
  [custom.emoji, custom.text].filter(Boolean).join(' ');

/** Ses simgesinin ipucu: "Sesli sohbette: Kanal" (kanalın adı bilinmiyorsa yalnızca "Sesli sohbette") */
export const voiceLabel = (channelName?: string | null): string =>
  channelName ? `Sesli sohbette: ${channelName}` : 'Sesli sohbette';
