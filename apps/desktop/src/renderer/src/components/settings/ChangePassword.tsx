import { useState, type FormEvent } from 'react';
import { api, errorMessage, useSession } from '@diskort/client-core';
import { toast } from '../../stores/ui';
import { Button, Field, SectionTitle, TextInput } from '../ui/controls';

/** Hesap ayarlarında şifre değiştirme; diğer cihazlardaki oturumlar kapanır, bu cihaz açık kalır. */
export function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (next !== repeat) {
      setError('Yeni şifreler eşleşmiyor.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.changePassword({ currentPassword: current, newPassword: next });
      useSession.getState().setSession(res.token, res.user);
      setCurrent('');
      setNext('');
      setRepeat('');
      toast('Şifren değiştirildi. Diğer cihazlardaki oturumların kapatıldı.', 'success');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <SectionTitle>Şifre Değiştir</SectionTitle>
      <Field label="Mevcut şifre">
        <TextInput type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Yeni şifre">
          <TextInput type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Yeni şifre (tekrar)">
          <TextInput type="password" autoComplete="new-password" minLength={8} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </Field>
      </div>
      {error && <div className="mb-3 rounded-[3px] bg-danger/15 px-3 py-2 text-sm text-[#fa777c]">{error}</div>}
      <Button type="submit" disabled={busy || !current || !next || !repeat}>
        {busy ? 'Bekle…' : 'Şifreyi Değiştir'}
      </Button>
    </form>
  );
}
