import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { gateway, useSession } from '@diskort/client-core';
import { UpdateScreen } from '../components/UpdateScreen';
import { channelFromResponse, registerForPush } from '../notifications';
import { clientReady } from '../setup';
import { checkForUpdate, cleanupDownloads, useAppUpdate } from '../update/updater';
import { useUi } from '../stores/ui';
import { colors } from '../theme';
import { useVoice, voice } from '../voice/voice';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const token = useSession((s) => s.token);
  const updateRequired = useUi((s) => s.updateRequired);
  const updatePending = useAppUpdate((s) => s.status.kind !== 'idle');
  const inVoice = useVoice((s) => s.status !== 'idle');
  // Yeni sürüm zorunludur; ama süren sesli sohbet bölünmez, sesten çıkınca gösterilir
  const showUpdate = Boolean(updateRequired) || (updatePending && !inVoice);

  useEffect(() => {
    void clientReady.finally(() => setReady(true));
    void cleanupDownloads();
    void checkForUpdate(true);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkForUpdate();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // Oturum açılınca bu telefonu bildirimler için kaydet
  useEffect(() => {
    if (ready && token) void registerForPush();
  }, [ready, token]);

  // Bildirime dokunulunca o kanalı aç (uygulama kapalıyken açıldıysa da)
  const router = useRouter();
  useEffect(() => {
    if (!ready || !token) return;
    const open = (response: Notifications.NotificationResponse | null): void => {
      const channelId = channelFromResponse(response);
      if (channelId) router.push(`/channel/${channelId}`);
    };
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [ready, token, router]);

  // Oturum açıkken gateway'e bağlan; uygulama öne gelince beklemeden yeniden bağlan
  useEffect(() => {
    if (!ready || !token || updateRequired) return;
    gateway.connect();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') gateway.resume();
    });
    return () => {
      sub.remove();
      void voice.leave();
      gateway.disconnect();
    };
  }, [ready, token, updateRequired]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {showUpdate ? (
        <UpdateScreen requiredVersion={updateRequired} />
      ) : (
        <>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.side },
              headerTintColor: colors.head,
              headerTitleStyle: { fontWeight: '600' },
              contentStyle: { backgroundColor: colors.main },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Protected guard={Boolean(token)}>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="channel/[id]" />
              <Stack.Screen name="voice" options={{ title: 'Ses' }} />
              <Stack.Screen name="settings" options={{ title: 'Ayarlar' }} />
            </Stack.Protected>
            <Stack.Protected guard={!token}>
              <Stack.Screen name="login" options={{ headerShown: false }} />
            </Stack.Protected>
          </Stack>
          <Toast />
        </>
      )}
    </SafeAreaProvider>
  );
}

function Toast() {
  const toast = useUi((s) => s.toast);
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + 90 }]}>
      <Text style={[styles.toastText, toast.kind === 'error' && { color: '#fa777c' }]}>{toast.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: colors.deep,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    elevation: 6,
  },
  toastText: { color: colors.text, fontSize: 14.5 },
});
