import { useState, type FormEvent } from 'react';
import { AudioLines } from 'lucide-react';
import { api, errorMessage, normalizeServerUrl, useSession } from '@diskort/client-core';
import { useSettings } from '../stores/settings';
import { Button, Field, TextInput } from './ui/controls';

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
  const setSession = useSession((s) => s.setSession);

  const switchMode = (next: Mode): void => {
    setMode(next);
    setError(null);
    setCode('');
    setPassword('');
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await api.login({ username, password })
          : mode === 'register'
            ? await api.register({ inviteCode: code, username, password, displayName: displayName.trim() || undefined })
            : await api.resetPassword({ username, code, newPassword: password });
      setSession(res.token, res.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const text = TITLES[mode];

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#404eed] via-[#5865f2] to-[#3b3fb8] p-4">
      <form onSubmit={submit} className="animate-pop w-[480px] max-w-full rounded-md bg-bg-main p-8 shadow-2xl">
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white">
            <AudioLines size={30} />
          </div>
          <h1 className="text-2xl font-bold text-text-head">{text.title}</h1>
          <p className="mt-1 text-text-muted">{text.subtitle}</p>
        </div>

        {mode !== 'login' && (
          <Field label={mode === 'register' ? 'Davet kodu' : 'Sıfırlama kodu'}>
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ÖRN. 4EZZHQMF"
              required
              autoFocus
            />
          </Field>
        )}
        <Field label="Kullanıcı adı">
          <TextInput
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            autoComplete="username"
            required
            autoFocus={mode === 'login'}
          />
        </Field>
        {mode === 'register' && (
          <Field label="Görünen ad">
            <TextInput
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Diğerlerinin göreceği ad"
            />
          </Field>
        )}
        <Field label={mode === 'reset' ? 'Yeni şifre' : 'Şifre'}>
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'login' ? undefined : 8}
            required
          />
        </Field>

        {error && <div className="mb-4 rounded-[3px] bg-danger/15 px-3 py-2 text-sm text-[#fa777c]">{error}</div>}

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
            <span className="text-xs">Sıfırlama kodunu topluluktaki bir yöneticiden iste (Ayarlar → Üyeler).</span>
          )}
        </div>

        <div className="mt-5 border-t border-line pt-4 text-xs text-text-muted">
          {editingServer ? (
            <Field label="Sunucu adresi">
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
            </Field>
          ) : (
            <span>
              Sunucu: <span className="text-text-normal">{serverUrl}</span> ·{' '}
              <LinkButton onClick={() => setEditingServer(true)}>Değiştir</LinkButton>
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" className="text-[#00a8fc] hover:underline" onClick={onClick}>
      {children}
    </button>
  );
}
