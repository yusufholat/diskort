import { api } from '@diskort/client-core';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

export type PushState =
  | { kind: 'unknown' }
  | { kind: 'registered' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

/** Ayarlar ekranında gösterilir (sorun olunca nedenini görmek için) */
export const usePushState = create<{ state: PushState }>()(() => ({ state: { kind: 'unknown' } }));
const setPushState = (state: PushState): void => usePushState.setState({ state });

/**
 * Telefon bildirimleri: bahsetmeler ve direkt mesajlar. Sunucu, ilgili kullanıcının kayıtlı cihazlarına
 * Android'de Google'ın bildirim servisi (FCM), iOS'ta doğrudan Apple'ınki (APNs) üzerinden gönderir;
 * uygulama kapalıyken bildirimi işletim sistemi kendisi gösterir. Android'de iki ayrı bildirim kanalı
 * vardır: kullanıcı telefon ayarlarından birini kapatabilir.
 *
 * iOS'ta cihaz jetonu APNs jetonudur (Firebase yok). Sunucuda APNs anahtarı yoksa jeton kaydedilir ama
 * bildirim gitmez; uygulama imzasında "aps-environment" yoksa jeton alınamaz ve nedeni ayarlarda görünür.
 */
const CHANNEL_ID = 'diskort-mentions';
/** Direkt mesajlar (sunucu bu kanalı kullanır; bkz. push.ts notifyDm) */
const DM_CHANNEL_ID = 'diskort-dm';
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

const PLATFORM = Platform.OS === 'ios' ? 'ios' : 'android';

async function sendToken(token: string): Promise<void> {
  await api.registerPushToken({ token, platform: PLATFORM });
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/** Giriş yapılınca: bildirim izni iste, cihaz jetonunu sunucuya kaydet. */
export async function registerForPush(): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  try {
    if (Platform.OS === 'android') await createChannels();
    const permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    if (!permission.granted) {
      setPushState({ kind: 'denied' });
      return;
    }
    const { data } = await Notifications.getDevicePushTokenAsync();
    await sendToken(String(data));
    setPushState({ kind: 'registered' });
    tokenSubscription?.remove();
    // Google/Apple jetonu yenilerse sunucuya yenisini bildir
    tokenSubscription = Notifications.addPushTokenListener(({ data: next }) => void sendToken(String(next)).catch(() => undefined));
  } catch (err) {
    // Ör. Google Play Hizmetleri yok, iOS imzasında bildirim yetkisi yok ya da ağ hatası: uygulama bildirimsiz
    // çalışır, nedeni ayarlarda görünür
    setPushState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

async function createChannels(): Promise<void> {
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Bahsetmeler',
    description: 'Biri senden bahsettiğinde',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 180, 120, 180],
    lightColor: '#5865f2',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync(DM_CHANNEL_ID, {
    name: 'Direkt mesajlar',
    description: 'Biri sana direkt mesaj gönderdiğinde',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 180, 120, 180],
    lightColor: '#5865f2',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
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

/** Bildirime dokunulunca açılacak kanal ya da direkt mesaj konuşması (ikisi de aynı ekranda açılır) */
export function channelFromResponse(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as { channelId?: unknown } | undefined;
  return typeof data?.channelId === 'string' ? data.channelId : null;
}
