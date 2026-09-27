import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, type ErrorBoundaryProps } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { gateway, reportClientError, useGuild, useSession } from '@diskort/client-core';
import { Toast } from '../components/Toast';
import { Button } from '../components/ui';
import { UpdateScreen } from '../components/UpdateScreen';
import { channelFromResponse, registerForPush } from '../notifications';
import { clientReady } from '../setup';
import { applyOta, checkForUpdate, cleanupDownloads, updateOnLaunch, useAppUpdate } from '../update/updater';
import { useUi } from '../stores/ui';
import { colors } from '../theme';
import { useVoice, voice } from '../voice/voice';

void SplashScreen.preventAutoHideAsync();

/**
 * Ekran çizilirken bir hata olursa (ör. bir ekranın kodunda hata) uygulama kapanmak yerine bunu gösterir
 * ve hatayı sunucu kayıtlarına bildirir.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => reportClientError(error, 'ekran'), [error]);
  return (
    <View style={errorStyles.page}>
      <Text style={errorStyles.title}>Bir şeyler ters gitti</Text>
      <Text style={errorStyles.text}>Hata bildirildi, en kısa sürede düzeltilecek.</Text>
      <Text style={errorStyles.detail} selectable numberOfLines={4}>
        {error.message}
      </Text>
      <View style={{ alignSelf: 'stretch', marginTop: 24 }}>
        <Button title="Tekrar dene" onPress={() => void retry()} />
      </View>
    </View>
  );
}

const errorStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.rail, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: colors.head, fontSize: 21, fontWeight: '700', textAlign: 'center' },
  text: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: 10 },
  detail: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 14 },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const token = useSession((s) => s.token);
  const updateRequired = useUi((s) => s.updateRequired);
  const apkPending = useAppUpdate((s) => s.status.kind !== 'idle');
  const launchUpdating = useAppUpdate((s) => s.ota.kind === 'downloading' || s.ota.kind === 'downloaded');
  const inVoice = useVoice((s) => s.status !== 'idle');
  // Yeni sürüm zorunludur; ama süren sesli sohbet bölünmez, sesten çıkınca gösterilir
  const showUpdate = Boolean(updateRequired) || (apkPending && !inVoice);

  useEffect(() => {
    // Açılış güncelleyicisi: yeni arayüz varsa uygulama açılmadan iner ve uygulama yeniden başlar.
    // Sesli sohbet sürüyorsa bu gerçek bir açılış değil, Android ekranı yeniden kurmuştur: yeniden
    // başlatmak sesi keser; güncelleme sesten çıkınca uygulanır.
    void clientReady
      .catch(() => undefined)
      .then(() => (useVoice.getState().status === 'idle' ? updateOnLaunch() : undefined))
      .finally(() => setReady(true));
    void cleanupDownloads();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // Arka planda inen arayüz güncellemesi uygulamaya dönünce uygulanır (sesli sohbet bölünmez)
      if (useAppUpdate.getState().ota.kind === 'downloaded' && useVoice.getState().status === 'idle') void applyOta();
      else void checkForUpdate();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (ready || launchUpdating) void SplashScreen.hideAsync();
  }, [ready, launchUpdating]);

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
      if (!channelId) return;
      // Kanal başka bir sunucudaysa o sunucuya geçilir (üyeler, başlık o sunucunun olsun)
      const guild = useGuild.getState();
      const guildId = guild.channelGuild[channelId];
      if (guildId) guild.selectGuild(guildId);
      router.push(`/channel/${channelId}`);
    };
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [ready, token, router]);

  // Oturum açıkken gateway'e bağlan; uygulama öne gelince beklemeden yeniden bağlan.
  // Ses ve gateway bu bileşenden uzun yaşar: Android ekranı (Activity) kapatıp yeniden kurunca
  // (geri tuşu, arka planda bellek için kapatma) bu bileşen kaldırılıp baştan çizilir ama JavaScript
  // ve ön plan servisi çalışmaya devam eder. Bu yüzden sesten çıkma ve bağlantıyı kapatma bileşen
  // kaldırılırken değil, yalnızca oturum kapanınca ya da zorunlu güncellemede yapılır.
  useEffect(() => {
    if (!ready) return;
    if (!token || updateRequired) {
      if (useVoice.getState().status !== 'idle') void voice.leave();
      gateway.disconnect();
      return;
    }
    gateway.connect(); // zaten bağlıysa bir şey yapmaz
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') gateway.resume();
    });
    return () => sub.remove();
  }, [ready, token, updateRequired]);

  if (!ready) {
    return launchUpdating ? (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <UpdateScreen />
      </SafeAreaProvider>
    ) : null;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {showUpdate ? (
        <UpdateScreen requiredVersion={updateRequired} />
      ) : (
        <>
          <Stack
            screenOptions={{
              // Başlık çubuğu içerikle aynı renkte, altında ince gölge (masaüstündeki kanal başlığı gibi)
              headerStyle: { backgroundColor: colors.main },
              headerTintColor: colors.head,
              headerTitleStyle: { fontWeight: '700', fontSize: 18 },
              headerShadowVisible: true,
              contentStyle: { backgroundColor: colors.main },
              // Önceki ekranın hafifçe geride kaldığı yumuşak kayma (react-native-screens'in kendi geçişi,
              // yerel iş parçacığında oynar). Android'in geri hareketi de aynı animasyonla geri döner.
              animation: 'ios_from_right',
              // Arkada kalan ekranlar (ör. sohbet açıkken kanal listesi) donar: ses/okunmamış
              // güncellemeleri görünmeyen ekranı yeniden çizmez, geri dönünce güncel hâliyle açılır.
              freezeOnBlur: true,
            }}
          >
            <Stack.Protected guard={Boolean(token)}>
              <Stack.Screen name="index" options={{ headerShown: false, contentStyle: { backgroundColor: colors.side } }} />
              <Stack.Screen name="channel/[id]" />
              {/* Ses ekranı alttan yükselir; yeni mesaj seçimi alttan belirir */}
              <Stack.Screen
                name="voice"
                options={{
                  title: 'Ses',
                  animation: 'slide_from_bottom',
                  headerStyle: { backgroundColor: colors.deep },
                  contentStyle: { backgroundColor: colors.deep },
                }}
              />
              <Stack.Screen name="members" options={{ title: 'Üyeler' }} />
              <Stack.Screen name="dms" options={{ title: 'Direkt Mesajlar' }} />
              <Stack.Screen name="dm-new" options={{ title: 'Yeni mesaj', animation: 'fade_from_bottom' }} />
              <Stack.Screen name="dm-rename" options={{ title: 'Grubun adı', animation: 'fade_from_bottom' }} />
              <Stack.Screen name="settings" options={{ title: 'Ayarlar' }} />
              <Stack.Screen name="feedback" options={{ title: 'Geri bildirim' }} />
              <Stack.Screen name="whats-new" options={{ title: 'Yenilikler' }} />
              <Stack.Screen name="sunucu-ekle" options={{ title: 'Sunucu ekle', animation: 'fade_from_bottom' }} />
            </Stack.Protected>
            <Stack.Protected guard={!token}>
              <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.rail } }} />
            </Stack.Protected>
          </Stack>
          <Toast />
        </>
      )}
    </SafeAreaProvider>
  );
}
