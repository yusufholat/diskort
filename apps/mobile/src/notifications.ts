import { api } from '@diskort/client-core';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Telefon bildirimleri (bahsetmeler). Sunucu, bahsedilen kullanıcının kayıtlı cihazlarına Google'ın
 * bildirim servisi (FCM) üzerinden gönderir; uygulama kapalıyken bildirimi Android kendisi gösterir.
 */
const CHANNEL_ID = 'diskort-mentions';
const TOKEN_KEY = 'diskort-push-token';

// Uygulama açıkken bildirim çubuğuna düşürme: aynı bahsetme uygulama içinde zaten gösteriliyor
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let tokenSubscription: { remove: () => void } | null = null;

async function sendToken(token: string): Promise<void> {
  await api.registerPushToken({ token, platform: 'android' });
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/** Giriş yapılınca: bildirim izni iste, cihaz jetonunu sunucuya kaydet. */
export async function registerForPush(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Bahsetmeler',
      description: 'Biri senden bahsettiğinde',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 120, 180],
      lightColor: '#5865f2',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return;
    const { data } = await Notifications.getDevicePushTokenAsync();
    await sendToken(String(data));
    tokenSubscription?.remove();
    // Google jetonu yenilerse sunucuya yenisini bildir
    tokenSubscription = Notifications.addPushTokenListener(({ data: next }) => void sendToken(String(next)).catch(() => undefined));
  } catch {
    // Firebase yapılandırılmamış ya da Google Play Hizmetleri yok: uygulama bildirimsiz çalışır
  }
}

/** Çıkış yapmadan önce: bu cihaza artık bu hesabın bildirimleri gitmesin. */
export async function unregisterPush(): Promise<void> {
  tokenSubscription?.remove();
  tokenSubscription = null;
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token) await api.unregisterPushToken(token);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // önemli değil
  }
}

/** Bildirime dokunulunca açılacak kanal */
export function channelFromResponse(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as { channelId?: unknown } | undefined;
  return typeof data?.channelId === 'string' ? data.channelId : null;
}
