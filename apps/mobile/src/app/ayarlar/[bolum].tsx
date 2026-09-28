import { ScrollView, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsSection, type SettingsSectionId } from '@diskort/client-core';
import { AccountSettings } from '../../components/settings/AccountSettings';
import { ProfileSettings } from '../../components/settings/ProfileSettings';
import { ThemePicker } from '../../components/ThemePicker';
import { Card, SectionTitle } from '../../components/ui';
import { SoundSettings, VoiceSettings } from '../../components/VoiceSettings';
import { soundsAvailable } from '../../sounds';
import { colors, createStyles, font, space } from '../../theme';

/** Telefonda kendi sayfası olan ayar bölümleri; diğerleri (geri bildirim, yenilikler…) kendi ekranını açar */
const PAGES: readonly SettingsSectionId[] = ['account', 'profile', 'voice', 'appearance', 'notifications'];

/** Kullanıcı Ayarları'nın bir bölümü (masaüstündeki bölümle aynı ad ve içerik sırası) */
export default function SettingsSectionScreen() {
  const { bolum } = useLocalSearchParams<{ bolum: string }>();
  const insets = useSafeAreaInsets();
  const id = PAGES.find((p) => p === bolum);
  if (!id) return null;
  const info = settingsSection(id);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: info?.label ?? 'Ayarlar' }} />
      {id === 'account' && <AccountSettings />}
      {id === 'profile' && <ProfileSettings />}
      {id === 'voice' && <VoiceSettings />}
      {id === 'appearance' && (
        <>
          <SectionTitle>Tema</SectionTitle>
          <ThemePicker />
        </>
      )}
      {id === 'notifications' && <NotificationsAndSounds />}
    </ScrollView>
  );
}

/**
 * Bildirimler ve Sesler (masaüstündeki Ses Efektleri): sesli sohbet sesleri, bildirim sesi, sesleri dinle.
 * Telefon bildirimleri (bahsetme, direkt mesaj) kendiliğinden açılır; telefonun ayarlarından kapatılabilir.
 */
function NotificationsAndSounds() {
  return (
    <>
      <SectionTitle>Sesler</SectionTitle>
      <Card style={styles.card}>
        {soundsAvailable() ? (
          <SoundSettings />
        ) : (
          <Text style={styles.note}>Bu uygulama sürümünde sesler çalınamıyor; yeni sürümü kurunca açılır.</Text>
        )}
      </Card>
      <Text style={styles.hint}>
        Senden bahsedilince ya da direkt mesaj gelince uygulama kapalıyken de telefon bildirimi gelir. Bildirimleri
        telefonun Ayarlar → Uygulamalar → Diskort → Bildirimler kısmından kapatabilirsin.
      </Text>
    </>
  );
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.main },
  content: { padding: space.lg },
  card: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  note: { color: colors.muted, fontSize: font.small, lineHeight: 19, paddingVertical: space.md },
  hint: { color: colors.muted, fontSize: font.caption + 0.5, lineHeight: 18, marginTop: space.md, marginHorizontal: space.xs },
}));
