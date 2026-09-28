import { useState } from 'react';
import { Text, View } from 'react-native';
import { DISPLAY_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@diskort/shared';
import { api, ApiError, errorMessage, gateway, useSession } from '@diskort/client-core';
import { animateNextLayout } from '../../motion';
import { unregisterPush } from '../../notifications';
import { toast } from '../../stores/ui';
import { colors, createStyles, font, space } from '../../theme';
import { voice } from '../../voice/voice';
import { PresenceAvatar } from '../Avatar';
import { confirmDialog } from '../Dialog';
import { Button, Card, FadeIn, Field, NavRow, SectionTitle, ui } from '../ui';

/** Oturumu kapatır: bildirim kaydı silinir, sesten çıkılır, bağlantı kapanır */
export async function logout(): Promise<void> {
  await unregisterPush();
  void voice.leave();
  gateway.disconnect();
  useSession.getState().logout();
}

/** Onay sorup oturumu kapatır */
export async function confirmLogout(): Promise<void> {
  const ok = await confirmDialog({
    title: 'Çıkış yapılsın mı?',
    message: 'Bu telefonda yeniden giriş yapana kadar bildirim gelmez.',
    icon: 'log-out-outline',
    confirmLabel: 'Çıkış yap',
    danger: true,
  });
  if (ok) await logout();
}

/** Ayarlar → Hesabım (masaüstündeki Hesabım): görünen ad, kullanıcı adı, şifre değiştirme, hesabı silme */
export function AccountSettings() {
  const user = useSession((s) => s.user);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);

  const saveName = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await api.updateMe({ displayName: displayName.trim() });
      useSession.getState().setUser(updated);
      toast('Görünen ad kaydedildi.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;
  return (
    <View>
      <View style={styles.header}>
        <PresenceAvatar userId={user.id} user={user} size={64} surface={colors.side} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {user.displayName}
          </Text>
          <Text style={styles.username} numberOfLines={1}>
            @{user.username}
          </Text>
        </View>
      </View>

      <SectionTitle>Hesap bilgileri</SectionTitle>
      <Card style={styles.pad}>
        <Field label="Görünen ad" value={displayName} onChangeText={setDisplayName} maxLength={DISPLAY_NAME_MAX_LENGTH} />
        <Button
          title="Kaydet"
          busy={saving}
          disabled={!displayName.trim() || displayName.trim() === user.displayName}
          onPress={() => void saveName()}
        />
      </Card>
      <Card style={{ marginTop: space.md }}>
        <NavRow first icon="at" iconColor={colors.control} label="Kullanıcı adı" value={user.username} />
      </Card>

      <ChangePassword />
      <DeleteAccount />
    </View>
  );
}

/** Şifre değiştirme; diğer cihazlardaki oturumlar kapanır, bu telefon açık kalır (masaüstündekiyle aynı) */
function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; repeat?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const found = {
      current: current ? undefined : 'Bu alan gerekli.',
      next: !next ? 'Bu alan gerekli.' : next.length < PASSWORD_MIN_LENGTH ? `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.` : undefined,
      repeat: !repeat ? 'Bu alan gerekli.' : repeat !== next ? 'Yeni şifreler eşleşmiyor.' : undefined,
    };
    setErrors(found);
    if (found.current || found.next || found.repeat) return;
    setBusy(true);
    try {
      const res = await api.changePassword({ currentPassword: current, newPassword: next });
      useSession.getState().setSession(res.token, res.user);
      setCurrent('');
      setNext('');
      setRepeat('');
      toast('Şifren değiştirildi. Diğer cihazlardaki oturumların kapatıldı.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_password') setErrors({ current: errorMessage(err) });
      else toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <SectionTitle>Şifre değiştir</SectionTitle>
      <Card style={styles.pad}>
        <Field
          label="Mevcut şifre"
          value={current}
          onChangeText={(v) => {
            setCurrent(v);
            setErrors((e) => ({ ...e, current: undefined }));
          }}
          secureTextEntry
          autoComplete="current-password"
          error={errors.current}
        />
        <Field
          label="Yeni şifre"
          value={next}
          onChangeText={(v) => {
            setNext(v);
            setErrors((e) => ({ ...e, next: undefined }));
          }}
          secureTextEntry
          autoComplete="new-password"
          error={errors.next}
        />
        <Field
          label="Yeni şifre (tekrar)"
          value={repeat}
          onChangeText={(v) => {
            setRepeat(v);
            setErrors((e) => ({ ...e, repeat: undefined }));
          }}
          secureTextEntry
          autoComplete="new-password"
          error={errors.repeat}
        />
        <Button title="Şifreyi değiştir" variant="secondary" busy={busy} onPress={() => void submit()} />
      </Card>
    </View>
  );
}

/** Hesabı silmek: şifreyle onaylanır */
function DeleteAccount() {
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
      await logout();
    } catch (err) {
      setError(errorMessage(err));
      setAttempt((n) => n + 1);
      setBusy(false);
    }
  };

  return (
    <View>
      <SectionTitle>Tehlikeli bölge</SectionTitle>
      <Card style={[styles.pad, styles.dangerCard]}>
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

const styles = createStyles(() => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: colors.side,
    borderRadius: 16,
    padding: space.lg,
  },
  name: { color: colors.head, fontSize: font.heading, fontWeight: '800' },
  username: { color: colors.muted, fontSize: font.body - 1, marginTop: 2 },
  pad: { padding: space.lg },
  dangerCard: { borderWidth: 1, borderColor: 'rgba(242,63,67,0.35)' },
  warning: { color: colors.muted, fontSize: font.small, lineHeight: 20, marginBottom: space.md },
}));
