import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api, errorMessage, gateway, removeAvatar, uploadAvatar, useSession } from '@diskort/client-core';
import { pickAvatar } from '../attachments';
import { Avatar } from '../components/Avatar';
import { PressableScale } from '../components/PressableScale';
import { Button, Card, FadeIn, Field, NavRow, SectionTitle, ui } from '../components/ui';
import { VoiceSettings } from '../components/VoiceSettings';
import { animateNextLayout } from '../motion';
import { registerForPush, unregisterPush, usePushState } from '../notifications';
import { APP_VERSION, NATIVE_VERSION } from '../version';
import { DEFAULT_SERVER_URL, useSettings } from '../stores/settings';
import { toast } from '../stores/ui';
import { colors, font, radius, space } from '../theme';
import { voice } from '../voice/voice';

export default function SettingsScreen() {
  const user = useSession((s) => s.user);
  const serverUrl = useSettings((s) => s.serverUrl);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const photo = useProfilePhoto();
  const router = useRouter();

  const saveName = async (): Promise<void> => {
    setSavingName(true);
    try {
      const updated = await api.updateMe({ displayName: displayName.trim() });
      useSession.getState().setUser(updated);
      toast('Görünen ad kaydedildi.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSavingName(false);
    }
  };

  const logout = async (): Promise<void> => {
    await unregisterPush();
    void voice.leave();
    gateway.disconnect();
    useSession.getState().logout();
  };

  if (!user) return null;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.profile}>
        <View style={styles.banner} />
        <View style={styles.profileBody}>
          <PressableScale
            scaleTo={0.94}
            onPress={() => void photo.change()}
            disabled={photo.busy !== null}
            accessibilityLabel="Profil fotoğrafını değiştir"
            style={styles.avatarWrap}
          >
            <Avatar user={user} size={80} online surface={colors.side} />
            <View style={styles.cameraBadge}>
              {photo.busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="camera" size={15} color="#fff" />
              )}
            </View>
          </PressableScale>
          <Text style={styles.name}>{user.displayName}</Text>
          <Text style={styles.username}>@{user.username}</Text>
          {user.avatarUrl ? (
            <Pressable
              onPress={() => void photo.remove()}
              disabled={photo.busy !== null}
              hitSlop={8}
              style={styles.removePhoto}
              accessibilityRole="button"
            >
              <Text style={[styles.removePhotoText, photo.confirmRemove && { color: colors.dangerText }]}>
                {photo.confirmRemove ? 'Emin misin? Fotoğrafı kaldır' : 'Fotoğrafı kaldır'}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.photoHint}>Fotoğraf eklemek için avatara dokun</Text>
          )}
        </View>
      </View>

      <SectionTitle>Hesap</SectionTitle>
      <Card style={styles.cardPad}>
        <Field label="Görünen ad" value={displayName} onChangeText={setDisplayName} maxLength={32} />
        <Button
          title="Kaydet"
          busy={savingName}
          disabled={!displayName.trim() || displayName.trim() === user.displayName}
          onPress={() => void saveName()}
        />
      </Card>

      <NotificationSettings />

      <VoiceSettings />

      <SectionTitle>Destek</SectionTitle>
      <Card>
        <NavRow
          first
          icon="chatbubble-ellipses"
          iconColor={colors.ok}
          label="Geri bildirim gönder"
          detail="Hata mı buldun, bir fikrin mi var? Durumunu da orada görürsün."
          onPress={() => router.push('/feedback')}
        />
        <NavRow
          icon="sparkles"
          label="Yenilikler"
          detail="Sürüm notları: her sürümde neler değişti"
          onPress={() => router.push('/whats-new')}
        />
      </Card>

      <SectionTitle>Uygulama</SectionTitle>
      <Card>
        <NavRow
          first
          icon="information-circle"
          iconColor={colors.control}
          label="Sürüm"
          value={APP_VERSION === NATIVE_VERSION ? APP_VERSION : `${APP_VERSION} (APK ${NATIVE_VERSION})`}
        />
        {serverUrl !== DEFAULT_SERVER_URL && (
          <NavRow icon="server" iconColor={colors.control} label="Sunucu" value={serverUrl} />
        )}
        <NavRow
          icon="shield-checkmark"
          iconColor={colors.control}
          label="Gizlilik"
          onPress={() => void Linking.openURL(`${DEFAULT_SERVER_URL}/privacy`)}
        />
      </Card>

      <View style={{ marginTop: 24 }}>
        <Button title="Çıkış Yap" variant="secondary" onPress={() => void logout()} />
      </View>

      <DeleteAccount onDeleted={() => void logout()} />
    </ScrollView>
  );
}

/** Profil fotoğrafı: galeriden seçilip kare kırpılır, sunucu küçültür. Kaldırmak iki dokunuş ister. */
function useProfilePhoto() {
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const change = async (): Promise<void> => {
    setConfirmRemove(false);
    const file = await pickAvatar().catch((err: unknown) => {
      toast(errorMessage(err), 'error');
      return null;
    });
    if (!file) return;
    setBusy('upload');
    try {
      await uploadAvatar(file);
      toast('Profil fotoğrafı güncellendi.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setConfirmRemove(false);
    setBusy('remove');
    try {
      await removeAvatar();
      toast('Profil fotoğrafı kaldırıldı.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return { busy, confirmRemove, change, remove };
}

function NotificationSettings() {
  const state = usePushState((s) => s.state);
  const [busy, setBusy] = useState(false);
  const text =
    state.kind === 'registered'
      ? 'Açık: biri senden bahsedince uygulama kapalıyken de bildirim gelir.'
      : state.kind === 'denied'
        ? 'Kapalı: bildirim izni verilmedi. Telefonun Ayarlar → Uygulamalar → Diskort → Bildirimler kısmından açabilirsin.'
        : state.kind === 'error'
          ? `Çalışmıyor: ${state.message}`
          : 'Denetleniyor…';

  const test = async (): Promise<void> => {
    setBusy(true);
    try {
      const { devices } = await api.sendTestPush();
      toast(devices ? 'Test bildirimi gönderildi; birkaç saniye içinde gelmeli.' : 'Bu hesaba kayıtlı cihaz yok.', devices ? 'info' : 'error');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <SectionTitle>Bildirimler</SectionTitle>
      <Card style={styles.cardPad}>
        <View style={styles.pushRow}>
          <View
            style={[
              styles.pushDot,
              {
                backgroundColor:
                  state.kind === 'registered' ? colors.ok : state.kind === 'denied' || state.kind === 'error' ? colors.danger : colors.warn,
              },
            ]}
          />
          <Text style={[styles.warning, { flex: 1, marginBottom: 0 }, state.kind === 'error' && { color: colors.dangerText }]} selectable>
            {text}
          </Text>
        </View>
        {state.kind === 'registered' ? (
          <Button title="Test bildirimi gönder" variant="secondary" busy={busy} onPress={() => void test()} />
        ) : (
          <Button title="Yeniden dene" variant="secondary" onPress={() => void registerForPush()} />
        )}
      </Card>
    </View>
  );
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount({ password });
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
      setAttempt((n) => n + 1);
      setBusy(false);
    }
  };

  return (
    <View>
      <SectionTitle>Tehlikeli bölge</SectionTitle>
      <Card style={[styles.cardPad, styles.dangerCard]}>
        <Text style={styles.warning}>
          Hesabın kalıcı olarak silinir ve geri alınamaz. Mesajların kalır, yazarı “Silinmiş Kullanıcı” görünür.
        </Text>
        {open ? (
          <>
            <Field label="Onaylamak için şifren" value={password} onChangeText={setPassword} secureTextEntry autoFocus />
            {error && (
              <FadeIn style={ui.errorBox} shakeKey={attempt}>
                <Text style={ui.errorText}>{error}</Text>
              </FadeIn>
            )}
            <Button title="Hesabımı Kalıcı Olarak Sil" variant="danger" busy={busy} disabled={!password} onPress={() => void submit()} />
            <View style={{ marginTop: 8 }}>
              <Button
                title="Vazgeç"
                variant="ghost"
                onPress={() => {
                  animateNextLayout(180);
                  setOpen(false);
                }}
              />
            </View>
          </>
        ) : (
          <Button
            title="Hesabımı Sil"
            variant="danger"
            onPress={() => {
              // Şifre alanı yumuşakça açılır
              animateNextLayout(200);
              setOpen(true);
            }}
          />
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.main },
  content: { padding: space.lg, paddingBottom: 48 },
  profile: { backgroundColor: colors.side, borderRadius: radius.lg, overflow: 'hidden' },
  banner: { height: 64, backgroundColor: colors.brand },
  profileBody: { alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.lg, marginTop: -44 },
  avatarWrap: { padding: 4, borderRadius: 48, backgroundColor: colors.side },
  cameraBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brand,
    borderWidth: 3,
    borderColor: colors.side,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: colors.head, fontSize: font.heading + 2, fontWeight: '800', marginTop: space.sm },
  username: { color: colors.muted, fontSize: font.body - 1, marginTop: 2 },
  removePhoto: { marginTop: space.md },
  removePhotoText: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
  photoHint: { color: colors.faint, fontSize: font.caption, marginTop: space.md },
  cardPad: { padding: space.lg },
  dangerCard: { borderWidth: 1, borderColor: 'rgba(242,63,67,0.35)' },
  pushRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm + 2, marginBottom: space.md },
  pushDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  warning: { color: colors.muted, fontSize: font.small, lineHeight: 20, marginBottom: space.md },
});
