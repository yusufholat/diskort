import { api, useGuild } from '@diskort/client-core';
import { parsePushTag } from '@diskort/shared';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Telefon bildirimleri: bahsetmeler ve direkt mesajlar. Sunucu, ilgili kullanıcının kayıtlı cihazlarına
 * Android'de Google'ın bildirim servisi (FCM), iOS'ta doğrudan Apple'ınki (APNs) üzerinden gönderir;
 * uygulama kapalıyken bildirimi işletim sistemi kendisi gösterir. Android'de iki ayrı bildirim kanalı
 * vardır: kullanıcı telefon ayarlarından birini kapatabilir.
 *
 * iOS'ta cihaz jetonu APNs jetonudur (Firebase yok). Sunucuda APNs anahtarı yoksa jeton kaydedilir ama
 * bildirim gitmez; uygulama imzasında "aps-environment" yoksa jeton alınamaz (uygulama bildirimsiz çalışır).
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

/**
 * Giriş yapılınca: bildirim izni iste, cihaz jetonunu sunucuya kaydet. Her girişte (jeton öncekiyle aynı olsa
 * da) yeniden gönderilir: zorunlu çıkışta sunucu kaydı silmiş olabilir.
 */
export async function registerForPush(): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  try {
    if (Platform.OS === 'android') await createChannels();
    const permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    if (!permission.granted) {
      // İzin verilmedi: uygulama bildirimsiz çalışır (telefonun ayarlarından sonradan açılabilir)
      return;
    }
    const { data } = await Notifications.getDevicePushTokenAsync();
    await sendToken(String(data));
    tokenSubscription?.remove();
    // Google/Apple jetonu yenilerse sunucuya yenisini bildir
    tokenSubscription = Notifications.addPushTokenListener(({ data: next }) => void sendToken(String(next)).catch(() => undefined));
  } catch (err) {
    // Ör. Google Play Hizmetleri yok, iOS imzasında bildirim yetkisi yok ya da ağ hatası: uygulama bildirimsiz
    // çalışır (bir sonraki açılışta yeniden denenir)
    console.warn('Bildirim kaydı yapılamadı:', err instanceof Error ? err.message : String(err));
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

/**
 * Oturum kapandı (zorunlu çıkış dahil: 401, gateway 4004, INVALID_SESSION): yerel kayıt unutulur. Sunucu jetonu
 * silmiş olabilir; sonraki girişte registerForPush jeton aynı olsa da yeniden kaydeder.
 */
export function forgetPushRegistration(): void {
  tokenSubscription?.remove();
  tokenSubscription = null;
  void SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
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

/**
 * Gösterilen bildirimin kanalı ve mesajı. iOS'ta ve uygulamanın kendi gösterdiklerinde veride (channelId);
 * Android'de uygulama kapalıyken bildirimi sistem gösterir ve veri okunamaz: o zaman sunucunun verdiği
 * mesaja özgü etiketten (pushTag), expo'nun "yabancı bildirim" kimliğindeki tag parametresinden okunur.
 */
function notificationTarget(n: Notifications.Notification): { channelId: string; messageId: string | null } | null {
  const data = n.request.content.data as { channelId?: unknown; messageId?: unknown } | undefined;
  if (typeof data?.channelId === 'string') {
    return { channelId: data.channelId, messageId: typeof data.messageId === 'string' ? data.messageId : null };
  }
  const raw = /[?&]tag=([^&]*)/.exec(n.request.identifier)?.[1];
  if (!raw) return null;
  let tag: string;
  try {
    tag = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return null;
  }
  // Eski sunucunun kanal başına etiketi ("channel-<id>" / "dm-<id>"): mesajı bilinmez
  const legacy = /^(?:channel|dm)-(.+)$/.exec(tag);
  return parsePushTag(tag) ?? (legacy ? { channelId: legacy[1]!, messageId: null } : null);
}

/** Kanal başına kaldırılmayı bekleyen en yüksek okunan mesaj (art arda çağrılar tek taramada birleşir) */
const pendingDismiss = new Map<string, string>();
let dismissScheduled = false;

/**
 * Kanal `lastReadId`'ye kadar okundu (bu telefonda ya da başka bir cihazda): o kanalın o mesaja kadarki
 * bildirimleri bildirim çubuğundan kaldırılır.
 */
export function dismissChannelNotifications(channelId: string, lastReadId: string): void {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  const current = pendingDismiss.get(channelId);
  if (!current || Number(lastReadId) > Number(current)) pendingDismiss.set(channelId, lastReadId);
  if (dismissScheduled) return;
  dismissScheduled = true;
  setTimeout(() => {
    dismissScheduled = false;
    const read = new Map(pendingDismiss);
    pendingDismiss.clear();
    void (async () => {
      try {
        const presented = await Notifications.getPresentedNotificationsAsync();
        for (const n of presented) {
          const target = notificationTarget(n);
          const upTo = target ? read.get(target.channelId) : undefined;
          if (!target || !upTo) continue;
          // Mesajı bilinmeyen (eski etiketli) bildirim yalnızca kanal sonuna kadar okunduysa kalkar
          const newest = target.messageId ?? useGuild.getState().lastMessageIds[target.channelId];
          if (newest && Number(newest) > Number(upTo)) continue;
          await Notifications.dismissNotificationAsync(n.request.identifier);
        }
      } catch {
        // önemli değil: bildirim çubuğu kendiliğinden temizlenmemiş olur
      }
    })();
  }, 300);
}

/** Bildirime dokunulunca açılacak kanal ya da direkt mesaj konuşması (ikisi de aynı ekranda açılır) */
export function channelFromResponse(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as { channelId?: unknown } | undefined;
  return typeof data?.channelId === 'string' ? data.channelId : null;
}
