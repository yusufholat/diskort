import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage, useSession } from '@diskort/client-core';
import { useUi } from '../../stores/ui';
import { Button, SectionTitle, TextInput } from '../ui/controls';
import { FormAlert, FormField, REQUIRED, focusFirstInvalid, useFormErrors } from '../ui/FormField';

/** Kullanıcının kendi hesabını silmesi (şifre onayıyla). Mesajlar kalır, yazarı "Silinmiş Kullanıcı" olur. */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const form = useFormErrors<'password'>();
  const ref = useRef<HTMLFormElement>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!form.validate({ password: !password && REQUIRED })) {
      focusFirstInvalid(ref.current);
      return;
    }
    setBusy(true);
    try {
      await api.deleteAccount({ password });
      useUi.getState().closeModal();
      useSession.getState().logout();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_password') {
        form.validate({ password: errorMessage(err) });
        focusFirstInvalid(ref.current);
      } else {
        setError(errorMessage(err));
        setAttempt((n) => n + 1);
      }
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
        <form ref={ref} onSubmit={submit} noValidate className="anim-rise-in">
          <FormField label="Onaylamak için şifren" error={form.errors.password} shakeKey={form.attempt}>
            <TextInput
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                form.clear('password');
              }}
              autoFocus
            />
          </FormField>
          <FormAlert message={error} shakeKey={attempt} />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={busy}>
              {busy ? 'Siliniyor…' : 'Hesabımı Kalıcı Olarak Sil'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setError(null);
                form.reset();
              }}
            >
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
