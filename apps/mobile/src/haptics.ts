import { PermissionsAndroid, Platform, Vibration, type Permission } from 'react-native';
import { create } from 'zustand';
import { getSettings } from './stores/settings';

/**
 * Dokunma geri bildirimi: ses düğmelerine (sustur, sağırlaştır, hoparlör, ekran, katıl, ayrıl) ve
 * yönetim işlemlerine basınca kısa titreşim. React Native'in kendi Vibration modülüyle (yeni yerel
 * bağımlılık yok, arayüz güncellemesiyle gelir). Ayarlar → Ses → "Dokunma titreşimi" ile kapatılır.
 *
 * İleride (yeni APK'da yerel ses modülüyle) masaüstündeki gibi kısa sesler de çalınacak: sesi çalan
 * `setFeedbackSound(...)` ile buraya takılır, çağıran yerler (`feedback('mute')`) değişmez.
 */
export type FeedbackEvent =
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'speakerOn'
  | 'speakerOff'
  | 'shareStart'
  | 'shareStop'
  | 'join'
  | 'leave'
  /** Yönetim işlemi yapıldı (sunucuda sustur, taşı, at…) */
  | 'moderate'
  /** İşlem yapılamadı (izin yok gibi) */
  | 'error';

/**
 * Titreşim desenleri (ms; Android: [bekle, titre, bekle, titre…]). Kapatan işlemler çift kısa tık,
 * açanlar tek tık: telefona bakmadan da susturulup susturulmadığı anlaşılır.
 */
const PATTERNS: Record<FeedbackEvent, number[]> = {
  mute: [0, 12, 70, 12],
  unmute: [0, 18],
  deafen: [0, 12, 70, 12],
  undeafen: [0, 18],
  speakerOn: [0, 14],
  speakerOff: [0, 14],
  shareStart: [0, 18],
  shareStop: [0, 12, 70, 12],
  join: [0, 14, 80, 22],
  leave: [0, 26],
  moderate: [0, 16],
  error: [0, 20, 60, 20, 60, 20],
};

// Titreşim izni (VIBRATE) APK'nın bildiriminde yoksa Vibration yerel tarafta hata fırlatır ve uygulama
// kapanabilir: izin açılışta bir kez denetlenir, yoksa titreşim sessizce atlanır.
const VIBRATE = 'android.permission.VIBRATE' as Permission;

/** Bu telefonda titreşim kullanılabilir mi (null: henüz denetlenmedi) */
export const useHapticsAvailable = create<{ available: boolean | null }>()(() => ({ available: null }));

if (Platform.OS === 'android') {
  PermissionsAndroid.check(VIBRATE)
    .then((available) => useHapticsAvailable.setState({ available }))
    .catch(() => useHapticsAvailable.setState({ available: false }));
} else {
  useHapticsAvailable.setState({ available: true });
}

type SoundPlayer = (event: FeedbackEvent) => void;
let playSound: SoundPlayer | null = null;

/** Gelecekteki ses modülü: olay sesini çalan işlev (null: ses yok) */
export function setFeedbackSound(player: SoundPlayer | null): void {
  playSound = player;
}

/** Olayın geri bildirimini ver: ayar açıksa titreşim, ses modülü takılıysa ses */
export function feedback(event: FeedbackEvent): void {
  if (getSettings().haptics && useHapticsAvailable.getState().available) {
    try {
      Vibration.vibrate(PATTERNS[event]);
    } catch {
      // Titreşim desteklenmiyor: sessizce geç
    }
  }
  try {
    playSound?.(event);
  } catch {
    // ses çalınamadı
  }
}
