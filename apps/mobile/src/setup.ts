// Uygulamanın her şeyden önce çalışan kurulumu (index.ts'te ilk içe aktarılır).
import { registerGlobals } from '@livekit/react-native';
import { configureClient, useGuild } from '@diskort/client-core';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { AppState, Vibration } from 'react-native';
import { getSettings } from './stores/settings';
import { toast, useUi } from './stores/ui';

// LiveKit'in kullandığı WebRTC ve tarayıcı API'lerini React Native'e tanıtır
registerGlobals();

/** Oturum jetonu Android Keystore ile şifrelenen güvenli depoda tutulur. */
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const APP_VERSION = Application.nativeApplicationVersion ?? '0.0.0';

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
  onUpdateRequired: (version) => useUi.setState({ updateRequired: version }),
});
