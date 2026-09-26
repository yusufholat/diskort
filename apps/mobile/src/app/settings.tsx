import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage, gateway, useSession } from '@diskort/client-core';
import { Avatar } from '../components/Avatar';
import { Button, Field, SectionTitle, ui } from '../components/ui';
import { APP_VERSION } from '../setup';
import { DEFAULT_SERVER_URL, useSettings } from '../stores/settings';
import { toast } from '../stores/ui';
import { colors } from '../theme';
import { voice } from '../voice/voice';

export default function SettingsScreen() {
  const user = useSession((s) => s.user);
  const serverUrl = useSettings((s) => s.serverUrl);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);

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

  const logout = (): void => {
    void voice.leave();
    gateway.disconnect();
    useSession.getState().logout();
  };

  if (!user) return null;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.profile}>
        <Avatar user={user} size={64} />
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

      <SectionTitle>Uygulama</SectionTitle>
      <Info label="Sürüm" value={APP_VERSION} />
      {serverUrl !== DEFAULT_SERVER_URL && <Info label="Sunucu" value={serverUrl} />}
      <Pressable onPress={() => void Linking.openURL(`${DEFAULT_SERVER_URL}/privacy`)} style={styles.link}>
        <Text style={styles.linkText}>Gizlilik</Text>
      </Pressable>

      <View style={{ marginTop: 24 }}>
        <Button title="Çıkış Yap" variant="secondary" onPress={logout} />
      </View>

      <DeleteAccount onDeleted={logout} />
    </ScrollView>
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
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount({ password });
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
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
            <View style={ui.errorBox}>
              <Text style={ui.errorText}>{error}</Text>
            </View>
          )}
          <Button title="Hesabımı Kalıcı Olarak Sil" variant="danger" busy={busy} disabled={!password} onPress={() => void submit()} />
          <View style={{ marginTop: 8 }}>
            <Button title="Vazgeç" variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </>
      ) : (
        <Button title="Hesabımı Sil" variant="danger" onPress={() => setOpen(true)} />
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
