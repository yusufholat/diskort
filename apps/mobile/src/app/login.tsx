import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseInviteCode } from '@diskort/shared';
import {
  api,
  ApiError,
  clearPendingInvite,
  errorMessage,
  keepIfGuildInvite,
  normalizeServerUrl,
  pendingInviteNotice,
  refreshPendingInvitePreview,
  usePendingInvite,
  useSession,
} from '@diskort/client-core';
import { Button, FadeIn, Field, ui } from '../components/ui';
import { animateNextLayout } from '../motion';
import { DEFAULT_SERVER_URL, useSettings } from '../stores/settings';
import { colors, createStyles, font } from '../theme';

type Mode = 'login' | 'register' | 'reset';

const TITLES: Record<Mode, [string, string]> = {
  login: ['Tekrar hoş geldin!', 'Arkadaşların seni bekliyor.'],
  register: ['Hesap oluştur', 'Katılmak için bir davet koduna ihtiyacın var.'],
  reset: ['Şifreni sıfırla', 'Yöneticinin verdiği sıfırlama koduyla yeni şifre belirle.'],
};

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  // Davet bağlantısıyla (diskort://davet/<kod>) açıldıysa: giriş yapınca "Sunucu ekle" bu kodla açılır.
  // Kayda geçilmez: sunucu daveti hesap açtırmaz (hesap yalnızca hesap davetiyle açılır).
  const inviteNotice = usePendingInvite(pendingInviteNotice);
  useEffect(() => {
    // Bağlantı istemci kurulmadan geldiyse sunucunun adı şimdi alınır
    refreshPendingInvitePreview();
  }, [inviteNotice]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const serverUrl = useSettings((s) => s.serverUrl);
  const setSettings = useSettings((s) => s.set);
  // Sunucu adresi gizli: yalnızca test için (logoya art arda 5 dokunuş). Varsayılan dışındaysa uyarı görünür.
  const custom = normalizeServerUrl(serverUrl) !== normalizeServerUrl(DEFAULT_SERVER_URL);
  const [showServer, setShowServer] = useState(false);
  const taps = useRef<number[]>([]);
  const tapLogo = (): void => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      setShowServer(true);
    }
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const user = username.trim().toLowerCase();
      const res =
        mode === 'login'
          ? await api.login({ username: user, password })
          : mode === 'register'
            ? await api.register({
                // Davet bağlantısı yapıştırıldıysa içindeki kod
                inviteCode: parseInviteCode(code) ?? code.trim(),
                username: user,
                password,
                displayName: displayName.trim() || undefined,
              })
            : await api.resetPassword({ username: user, code: code.trim(), newPassword: password });
      useSession.getState().setSession(res.token, res.user);
    } catch (err) {
      setError(errorMessage(err));
      setAttempt((n) => n + 1);
      // Kayda sunucu daveti yazıldıysa kod saklanır: hesabı olan giriş yapınca o sunucuya katılabilir
      if (mode === 'register' && err instanceof ApiError && err.code === 'invite') void keepIfGuildInvite(code);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode): void => {
    // Eklenen/kalkan alanlar yumuşakça belirip kaybolur
    animateNextLayout(200);
    setMode(next);
    setError(null);
    setPassword('');
  };

  const [title, subtitle] = TITLES[mode];

  return (
    <SafeAreaView style={styles.page}>
      <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Pressable style={styles.logo} onPress={tapLogo} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.logoText}>D</Text>
          </Pressable>
          <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            {inviteNotice && (
              <FadeIn style={styles.invite}>
                <Text style={styles.inviteText}>{inviteNotice}</Text>
                <Link text="Vazgeç" onPress={clearPendingInvite} muted />
              </FadeIn>
            )}

            {mode !== 'login' && (
              <Field
                label={mode === 'register' ? 'Davet kodu ya da bağlantısı' : 'Sıfırlama kodu'}
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            )}
            <Field
              label="Kullanıcı adı"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
            />
            {mode === 'register' && (
              <Field label="Görünen ad (isteğe bağlı)" value={displayName} onChangeText={setDisplayName} maxLength={32} />
            )}
            <Field
              label={mode === 'reset' ? 'Yeni şifre' : 'Şifre'}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === 'login' ? 'password' : 'new-password'}
              onSubmitEditing={() => void submit()}
            />

            {error && (
              // Hata kayarak belirir; her başarısız denemede sallanır
              <FadeIn style={ui.errorBox} shakeKey={attempt}>
                <Text style={ui.errorText}>{error}</Text>
              </FadeIn>
            )}

            <Button
              title={mode === 'login' ? 'Giriş Yap' : mode === 'register' ? 'Hesap Oluştur' : 'Şifreyi Değiştir'}
              busy={busy}
              disabled={!username || !password || (mode !== 'login' && !code)}
              onPress={() => void submit()}
            />

            <View style={styles.links}>
              {mode === 'login' ? (
                <>
                  <Link text="Hesabın yok mu? Davet koduyla kayıt ol" onPress={() => switchMode('register')} />
                  <Link text="Şifremi unuttum" onPress={() => switchMode('reset')} />
                </>
              ) : (
                <Link text="Girişe dön" onPress={() => switchMode('login')} />
              )}
            </View>

            {showServer ? (
              <View style={{ marginTop: 20 }}>
                <Field
                  label="Sunucu adresi"
                  value={serverUrl}
                  onChangeText={(v) => setSettings({ serverUrl: v })}
                  onBlur={() => setSettings({ serverUrl: normalizeServerUrl(serverUrl || DEFAULT_SERVER_URL) })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
            ) : custom ? (
              <View style={styles.custom}>
                <Text style={styles.customText}>Test sunucusu: {serverUrl}</Text>
                <Link text="Değiştir" onPress={() => setShowServer(true)} muted />
                <Link text="Varsayılana dön" onPress={() => setSettings({ serverUrl: DEFAULT_SERVER_URL })} muted />
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Link({ text, onPress, muted }: { text: string; onPress: () => void; muted?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ marginTop: 14 }}>
      <Text style={{ color: muted ? colors.faint : colors.link, fontSize: 14.5 }}>{text}</Text>
    </Pressable>
  );
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.rail },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  logo: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  custom: { marginTop: 20, alignItems: 'center' },
  customText: { color: colors.warn, fontSize: font.small, textAlign: 'center' },
  logoText: { color: '#fff', fontSize: 32, fontWeight: '800' },
  card: { backgroundColor: colors.main, borderRadius: 16, padding: 22 },
  title: { color: colors.head, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: 6, marginBottom: 22 },
  links: { marginTop: 4 },
  invite: { backgroundColor: colors.rail, borderRadius: 10, padding: 12, marginTop: -8, marginBottom: 18 },
  inviteText: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
}));
