import { useState, type FormEvent } from 'react';
import { AudioLines } from 'lucide-react';
import { api, errorMessage, normalizeServerUrl } from '../lib/api';
import { useSession } from '../stores/session';
import { useSettings } from '../stores/settings';
import { Button, Field, TextInput } from './ui/controls';

type Mode = 'login' | 'register';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const serverUrl = useSettings((s) => s.serverUrl);
  const setSettings = useSettings((s) => s.set);
  const [editingServer, setEditingServer] = useState(false);
  const setSession = useSession((s) => s.setSession);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await api.login({ username, password })
          : await api.register({
              inviteCode,
              username,
              password,
              displayName: displayName.trim() || undefined,
            });
      setSession(res.token, res.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#404eed] via-[#5865f2] to-[#3b3fb8] p-4">
      <form onSubmit={submit} className="animate-pop w-[480px] max-w-full rounded-md bg-bg-main p-8 shadow-2xl">
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white">
            <AudioLines size={30} />
          </div>
          <h1 className="text-2xl font-bold text-text-head">
            {mode === 'login' ? 'Tekrar hoş geldin!' : 'Hesap oluştur'}
          </h1>
          <p className="mt-1 text-text-muted">
            {mode === 'login' ? 'Arkadaşların seni bekliyor.' : 'Aldığın davet koduyla topluluğa katıl.'}
          </p>
        </div>

        {mode === 'register' && (
          <Field label="Davet kodu">
            <TextInput
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
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
        <Field label="Şifre">
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />
        </Field>

        {error && <div className="mb-4 rounded-[3px] bg-danger/15 px-3 py-2 text-sm text-[#fa777c]">{error}</div>}

        <Button type="submit" className="w-full text-base" disabled={busy}>
          {busy ? 'Bekle…' : mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}
        </Button>

        <div className="mt-3 text-sm text-text-muted">
          {mode === 'login' ? 'Hesabın yok mu? ' : 'Zaten hesabın var mı? '}
          <button
            type="button"
            className="text-[#00a8fc] hover:underline"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Davet koduyla kaydol' : 'Giriş yap'}
          </button>
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
                placeholder="https://diskurt.ornek.com"
                autoFocus
              />
            </Field>
          ) : (
            <span>
              Sunucu: <span className="text-text-normal">{serverUrl}</span> ·{' '}
              <button type="button" className="text-[#00a8fc] hover:underline" onClick={() => setEditingServer(true)}>
                Değiştir
              </button>
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
