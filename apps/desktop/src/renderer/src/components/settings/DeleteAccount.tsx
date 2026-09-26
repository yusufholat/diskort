import { useState, type FormEvent } from 'react';
import { api, errorMessage, useSession } from '@diskort/client-core';
import { useUi } from '../../stores/ui';
import { Button, Field, SectionTitle, TextInput } from '../ui/controls';

/** Kullanıcının kendi hesabını silmesi (şifre onayıyla). Mesajlar kalır, yazarı "Silinmiş Kullanıcı" olur. */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.deleteAccount({ password });
      useUi.getState().closeModal();
      useSession.getState().logout();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionTitle>Hesabı Sil</SectionTitle>
      <p className="mb-3 text-sm text-text-muted">
        Hesabın kalıcı olarak silinir ve geri alınamaz. Gönderdiğin mesajlar kalır, yazarı “Silinmiş Kullanıcı”
        olarak görünür. Yeniden katılmak için yeni bir davet kodu gerekir.
      </p>
      {open ? (
        <form onSubmit={submit}>
          <Field label="Onaylamak için şifren">
            <TextInput
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          </Field>
          {error && <div className="mb-3 rounded-[3px] bg-danger/15 px-3 py-2 text-sm text-[#fa777c]">{error}</div>}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={busy || !password}>
              {busy ? 'Siliniyor…' : 'Hesabımı Kalıcı Olarak Sil'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="danger" onClick={() => setOpen(true)}>
          Hesabımı Sil
        </Button>
      )}
    </div>
  );
}
