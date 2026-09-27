import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage, gateway, removeAvatar, uploadAvatar, useSession } from '@diskort/client-core';
import { pickAvatar } from '../attachments';
import { Avatar } from '../components/Avatar';
import { PressableScale } from '../components/PressableScale';
import { Button, FadeIn, Field, SectionTitle, ui } from '../components/ui';
import { animateNextLayout } from '../motion';
import { registerForPush, unregisterPush, usePushState } from '../notifications';
import { APP_VERSION, NATIVE_VERSION } from '../version';
import { DEFAULT_SERVER_URL, useSettings } from '../stores/settings';
import { toast } from '../stores/ui';
import { colors } from '../theme';
import { voice } from '../voice/voice';

export default function SettingsScreen() {
  const user = useSession((s) => s.user);
  const serverUrl = useSettings((s) => s.serverUrl);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const photo = useProfilePhoto();

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
        <PressableScale scaleTo={0.92} onPress={() => void photo.change()} disabled={photo.busy !== null} accessibilityLabel="Profil fotoğrafını değiştir">
          <Avatar user={user} size={64} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{user.displayName}</Text>
          <Text style={styles.username}>@{user.username}</Text>
        </View>
      </View>

      <SectionTitle>Hesap</SectionTitle>
      <Field label="Görünen ad" value={displayName} onChangeText={setDisplayName} maxLength={32} />
      <Button
        title="Kaydet"
        busy={savingName}
        disabled={!displayName.trim() || displayName.trim() === user.displayName}
        onPress={() => void saveName()}
      />

      <SectionTitle>Profil Fotoğrafı</SectionTitle>
      <Button
        title={user.avatarUrl ? 'Fotoğrafı Değiştir' : 'Fotoğraf Seç'}
        variant="secondary"
        busy={photo.busy === 'upload'}
        disabled={photo.busy !== null}
        onPress={() => void photo.change()}
      />
      {user.avatarUrl ? (
        <View style={{ marginTop: 8 }}>
          <Button
            title={photo.confirmRemove ? 'Emin misin? Fotoğrafı kaldır' : 'Fotoğrafı Kaldır'}
            variant={photo.confirmRemove ? 'danger' : 'ghost'}
            busy={photo.busy === 'remove'}
            disabled={photo.busy !== null}
            onPress={() => void photo.remove()}
          />
        </View>
      ) : null}

      <NotificationSettings />

      <SectionTitle>Uygulama</SectionTitle>
      <Info label="Sürüm" value={APP_VERSION === NATIVE_VERSION ? APP_VERSION : `${APP_VERSION} (APK ${NATIVE_VERSION})`} />
      {serverUrl !== DEFAULT_SERVER_URL && <Info label="Sunucu" value={serverUrl} />}
      <Pressable onPress={() => void Linking.openURL(`${DEFAULT_SERVER_URL}/privacy`)} style={styles.link}>
        <Text style={styles.linkText}>Gizlilik</Text>
      </Pressable>

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
      <Text style={[styles.warning, state.kind === 'error' && { color: '#fa777c' }]} selectable>
        {text}
      </Text>
      {state.kind === 'registered' ? (
        <Button title="Test bildirimi gönder" variant="secondary" busy={busy} onPress={() => void test()} />
      ) : (
        <Button title="Yeniden dene" variant="secondary" onPress={() => void registerForPush()} />
      )}
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
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
      <SectionTitle>Hesabı Sil</SectionTitle>
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
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.main },
  content: { padding: 16, paddingBottom: 48 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.rail, borderRadius: 10, padding: 16 },
  name: { color: colors.head, fontSize: 19, fontWeight: '700' },
  username: { color: colors.muted, fontSize: 14, marginTop: 2 },
  info: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  infoLabel: { color: colors.muted, fontSize: 15 },
  infoValue: { color: colors.text, fontSize: 15 },
  link: { paddingVertical: 10 },
  linkText: { color: colors.link, fontSize: 15 },
  warning: { color: colors.muted, fontSize: 14, lineHeight: 20, marginBottom: 12 },
});
