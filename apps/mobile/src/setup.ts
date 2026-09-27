// Uygulamanın her şeyden önce çalışan kurulumu (index.ts'te ilk içe aktarılır).
import { registerGlobals } from '@livekit/react-native';
import { configureClient, dmTitle, reportClientError, useGuild, useSession } from '@diskort/client-core';
import * as SecureStore from 'expo-secure-store';
import { AppState, Vibration } from 'react-native';
import { uploadFromDevice } from './attachments';
import { getSettings } from './stores/settings';
import { toast, useUi } from './stores/ui';
import { checkForUpdate } from './update/updater';
import { APP_VERSION } from './version';

// LiveKit'in kullandığı WebRTC ve tarayıcı API'lerini React Native'e tanıtır
registerGlobals();

/** Oturum jetonu Android Keystore ile şifrelenen güvenli depoda tutulur. */
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export { APP_VERSION };

/** Kayıtlı oturum yüklenince çözülür; kök yerleşim o zamana dek açılış ekranını tutar. */
export const clientReady = configureClient({
  platform: 'android',
  version: APP_VERSION,
  storage: secureStorage,
  serverUrl: () => getSettings().serverUrl,
  notifyError: (message) => toast(message, 'error'),
  isViewingChannel: (channelId) =>
    AppState.currentState === 'active' && useUi.getState().viewingChannelId === channelId,
  onMention: (message) => {
    const guild = useGuild.getState();
    const author = message.authorId ? guild.users[message.authorId]?.displayName : undefined;
    const channel = guild.channels.find((c) => c.id === message.channelId)?.name;
    Vibration.vibrate(60);
    toast(`${author ?? 'Biri'} senden bahsetti · #${channel ?? ''}`);
  },
  // Açık olmayan konuşmaya gelen direkt mesaj (uygulama kapalıyken telefon bildirimi gelir)
  onDirectMessage: (message, dm) => {
    const guild = useGuild.getState();
    const author = (message.authorId ? guild.users[message.authorId]?.displayName : undefined) ?? 'Biri';
    const from = dm.group ? `${author} · ${dmTitle(dm, guild.users, useSession.getState().user?.id)}` : author;
    const text = message.content || (message.attachments.length ? '📎 Dosya gönderdi' : '');
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
