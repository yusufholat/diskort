// Uygulamanın her şeyden önce çalışan kurulumu (index.ts'te ilk içe aktarılır).
import { registerGlobals } from '@livekit/react-native';
import { configureClient, dmTitle, reportClientError, useGuild, useSession } from '@diskort/client-core';
import { GIF_SNIPPET, isGifMessage } from '@diskort/shared';
import * as SecureStore from 'expo-secure-store';
import { AppState, Vibration } from 'react-native';
import { uploadFromDevice } from './attachments';
import { setupSounds } from './sounds';
import { getSettings } from './stores/settings';
import { toast, useUi } from './stores/ui';
import { checkForUpdate } from './update/updater';
import { APP_VERSION } from './version';

// LiveKit'in kullandığı WebRTC ve tarayıcı API'lerini React Native'e tanıtır
registerGlobals();

// Sesli sohbet sesleri: ses kipi sesli sohbete girilmeden önce, açılışta ayarlanmalı (bkz. sounds.ts)
setupSounds();

/** Oturum jetonu Android Keystore ile şifrelenen güvenli depoda tutulur. */
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export { APP_VERSION };

const doNotDisturb = (): boolean => useGuild.getState().selfStatus?.status === 'dnd';

/** Kayıtlı oturum yüklenince çözülür; kök yerleşim o zamana dek açılış ekranını tutar. */
export const clientReady = configureClient({
  platform: 'android',
  version: APP_VERSION,
  storage: secureStorage,
  serverUrl: () => getSettings().serverUrl,
  notifyError: (message) => toast(message, 'error'),
  isViewingChannel: (channelId) =>
    AppState.currentState === 'active' && useUi.getState().viewingChannelId === channelId,
  // Rahatsız Etmeyin: uygulama içi bildirim ve titreşim yok (okunmamış işaretleri yine güncellenir;
  // sunucu da telefona bildirim göndermez)
  onMention: (message) => {
    if (doNotDisturb()) return;
    const guild = useGuild.getState();
    const author = message.authorId ? guild.users[message.authorId]?.displayName : undefined;
    const channel = guild.channels.find((c) => c.id === message.channelId)?.name;
    Vibration.vibrate(60);
    const replied = message.replyMentionUserId != null && message.replyMentionUserId === useSession.getState().user?.id;
    toast(`${author ?? 'Biri'} ${replied ? 'sana yanıt verdi' : 'senden bahsetti'} · #${channel ?? ''}`);
  },
  // Açık olmayan konuşmaya gelen direkt mesaj (uygulama kapalıyken telefon bildirimi gelir)
  onDirectMessage: (message, dm) => {
    if (doNotDisturb()) return;
    const guild = useGuild.getState();
    const author = (message.authorId ? guild.users[message.authorId]?.displayName : undefined) ?? 'Biri';
    const from = dm.group ? `${author} · ${dmTitle(dm, guild.users, useSession.getState().user?.id)}` : author;
    const text = isGifMessage(message) ? GIF_SNIPPET : message.content || (message.attachments.length ? '📎 Dosya gönderdi' : '');
    Vibration.vibrate(60);
    toast(`${from}: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`);
  },
  onUpdateRequired: (version) => useUi.setState({ updateRequired: version }),
  // Yeni sürüm yayınlandı: hemen denetle. Arayüz güncellemesi arka planda iner, uygulamaya dönünce
  // uygulanır; yeni APK gerekiyorsa güncelleme ekranı çıkar (sesteyse sesten çıkınca)
  onUpdateAvailable: () => void checkForUpdate(true),
  upload: uploadFromDevice,
});

// Beklenmedik hatalar sunucu kayıtlarına bildirilir: telefonda hata ayıklama aracı yok, hatayı görmenin
// tek yolu bu. Ekran çizimindeki hatalar ayrıca _layout.tsx'teki ErrorBoundary'de yakalanır.
const previousHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  reportClientError(error, isFatal ? 'ölümcül' : 'genel');
  previousHandler(error, isFatal);
});
