import { useRef, useState, type FormEvent } from 'react';
import { AudioLines } from 'lucide-react';
import { parseInviteCode, PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from '@diskort/shared';
import { api, errorMessage, normalizeServerUrl, useSession } from '@diskort/client-core';
import { DEFAULT_SERVER_URL, useSettings } from '../stores/settings';
import { Button, TextInput } from './ui/controls';
import { FormAlert, FormField, REQUIRED, focusFirstInvalid, useFormErrors } from './ui/FormField';

type Mode = 'login' | 'register' | 'reset';

const TITLES: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  login: { title: 'Tekrar hoş geldin!', subtitle: 'Arkadaşların seni bekliyor.', submit: 'Giriş Yap' },
  register: { title: 'Hesap oluştur', subtitle: 'Aldığın davet koduyla topluluğa katıl.', submit: 'Kayıt Ol' },
  reset: {
    title: 'Şifreni sıfırla',
    subtitle: 'Bir yöneticiden aldığın sıfırlama koduyla yeni şifre belirle.',
    submit: 'Şifreyi Sıfırla',
  },
};

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const serverUrl = useSettings((s) => s.serverUrl);
  const setSettings = useSettings((s) => s.set);
  const [editingServer, setEditingServer] = useState(false);
  // Sunucu adresi gizli: yalnızca test için (logoya art arda 5 tıklama). Varsayılan dışındaysa uyarı görünür.
  const custom = normalizeServerUrl(serverUrl) !== normalizeServerUrl(DEFAULT_SERVER_URL);
  const taps = useRef<number[]>([]);
  const tapLogo = (): void => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      setEditingServer(true);
    }
  };
  const setSession = useSession((s) => s.setSession);
  const form = useFormErrors<'code' | 'username' | 'password'>();
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const switchMode = (next: Mode): void => {
    setMode(next);
    setError(null);
    setCode('');
    setPassword('');
    form.reset();
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const newAccount = mode !== 'login';
    const ok = form.validate({
      code: newAccount && !code.trim() && REQUIRED,
      username: !username.trim()
        ? REQUIRED
        : mode === 'register' &&
          !USERNAME_PATTERN.test(username) &&
          'Kullanıcı adı 3–32 karakter olmalı; yalnızca küçük harf, rakam, nokta ve alt çizgi.',
      password: !password
        ? REQUIRED
        : newAccount && password.length < PASSWORD_MIN_LENGTH && `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`,
    });
    if (!ok) {
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      const res =
        mode === 'login'
          ? await api.login({ username, password })
          : mode === 'register'
            ? await api.register({
                // Davet bağlantısı yapıştırıldıysa içindeki kod
                inviteCode: parseInviteCode(code) ?? code,
                username,
                password,
                displayName: displayName.trim() || undefined,
              })
            : await api.resetPassword({ username, code, newPassword: password });
      setSession(res.token, res.user);
    } catch (err) {
      setError(errorMessage(err));
      setAttempt((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const text = TITLES[mode];

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#404eed] via-[#5865f2] to-[#3b3fb8] p-4">
      <form
        ref={formRef}
        onSubmit={submit}
        noValidate
        className="anim-modal-in w-[480px] max-w-full rounded-md border border-frame bg-bg-main p-8 shadow-2xl"
      >
        <div className="mb-5 flex flex-col items-center text-center">
          <div
            className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white select-none"
            onClick={tapLogo}
          >
            <AudioLines size={30} />
          </div>
          <h1 className="text-2xl font-bold text-text-head">{text.title}</h1>
          <p className="mt-1 text-text-muted">{text.subtitle}</p>
        </div>

        {/* Mod değişince alanlar hafifçe yeniden belirir */}
        <div key={mode} className="anim-fade-in">
          {mode !== 'login' && (
            <FormField
              label={mode === 'register' ? 'Davet kodu ya da bağlantısı' : 'Sıfırlama kodu'}
              error={form.errors.code}
              shakeKey={form.attempt}
            >
              <TextInput
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  form.clear('code');
                }}
                placeholder="ÖRN. 4EZZHQMF"
                autoFocus
              />
            </FormField>
          )}
          <FormField label="Kullanıcı adı" error={form.errors.username} shakeKey={form.attempt}>
            <TextInput
              value={username}
              onChange={(e) => {
                setUsername(e.target.value.toLowerCase());
                form.clear('username');
              }}
              autoComplete="username"
              autoFocus={mode === 'login'}
            />
          </FormField>
          {mode === 'register' && (
            <FormField label="Görünen ad">
              <TextInput
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Diğerlerinin göreceği ad"
              />
            </FormField>
          )}
          <FormField
            label={mode === 'reset' ? 'Yeni şifre' : 'Şifre'}
            error={form.errors.password}
            shakeKey={form.attempt}
            hint={mode !== 'login' && !form.errors.password ? `En az ${PASSWORD_MIN_LENGTH} karakter.` : undefined}
          >
            <TextInput
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                form.clear('password');
              }}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </FormField>
        </div>

        <FormAlert message={error} shakeKey={attempt} />

        <Button type="submit" className="w-full text-base" disabled={busy}>
          {busy ? 'Bekle…' : text.submit}
        </Button>

        <div className="mt-3 flex flex-col gap-1 text-sm text-text-muted">
          {mode === 'login' ? (
            <>
              <span>
                Hesabın yok mu?{' '}
                <LinkButton onClick={() => switchMode('register')}>Davet koduyla kaydol</LinkButton>
              </span>
              <span>
                Şifreni mi unuttun? <LinkButton onClick={() => switchMode('reset')}>Sıfırlama koduyla yenile</LinkButton>
              </span>
            </>
          ) : (
            <span>
              {mode === 'register' ? 'Zaten hesabın var mı? ' : 'Şifreni hatırladın mı? '}
              <LinkButton onClick={() => switchMode('login')}>Giriş yap</LinkButton>
            </span>
          )}
          {mode === 'reset' && (
            <span className="text-xs">Sıfırlama kodunu bir hesap yöneticisinden iste.</span>
          )}
        </div>

        {(editingServer || custom) && (
        <div className="mt-5 border-t border-line pt-4 text-xs text-text-muted">
          {editingServer ? (
            <FormField label="Sunucu adresi" className="anim-slide-down">
              <TextInput
                value={serverUrl}
                onChange={(e) => setSettings({ serverUrl: e.target.value })}
                onBlur={() => {
                  setSettings({ serverUrl: normalizeServerUrl(serverUrl) });
                  setEditingServer(false);
                }}
                placeholder="https://diskort.ornek.com"
                autoFocus
              />
            </FormField>
          ) : (
            <span className="text-warn">
              Test sunucusu: <span className="text-text-normal">{serverUrl}</span> ·{' '}
              <LinkButton onClick={() => setEditingServer(true)}>Değiştir</LinkButton> ·{' '}
              <LinkButton onClick={() => setSettings({ serverUrl: DEFAULT_SERVER_URL })}>Varsayılana dön</LinkButton>
            </span>
          )}
        </div>
        )}
      </form>
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" className="text-link hover:underline" onClick={onClick}>
      {children}
    </button>
  );
}
