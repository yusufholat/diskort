import { useRef, useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@diskort/shared';
import { api, ApiError, errorMessage, useSession } from '@diskort/client-core';
import { toast } from '../../stores/ui';
import { Button, SectionTitle, TextInput } from '../ui/controls';
import { FormAlert, FormField, REQUIRED, focusFirstInvalid, useFormErrors } from '../ui/FormField';

/** Hesap ayarlarında şifre değiştirme; diğer cihazlardaki oturumlar kapanır, bu cihaz açık kalır. */
export function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useFormErrors<'current' | 'next' | 'repeat'>();
  const ref = useRef<HTMLFormElement>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const ok = form.validate({
      current: !current && REQUIRED,
      next: !next ? REQUIRED : next.length < PASSWORD_MIN_LENGTH && `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`,
      repeat: !repeat ? REQUIRED : repeat !== next && 'Yeni şifreler eşleşmiyor.',
    });
    if (!ok) {
      focusFirstInvalid(ref.current);
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
      if (err instanceof ApiError && err.code === 'invalid_password') {
        form.validate({ current: errorMessage(err) });
        focusFirstInvalid(ref.current);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={ref} onSubmit={submit} noValidate>
      <SectionTitle>Şifre Değiştir</SectionTitle>
      <FormField label="Mevcut şifre" error={form.errors.current} shakeKey={form.attempt}>
        <TextInput
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            form.clear('current');
          }}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Yeni şifre" error={form.errors.next} shakeKey={form.attempt}>
          <TextInput
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              form.clear('next');
            }}
          />
        </FormField>
        <FormField label="Yeni şifre (tekrar)" error={form.errors.repeat} shakeKey={form.attempt}>
          <TextInput
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => {
              setRepeat(e.target.value);
              form.clear('repeat');
            }}
          />
        </FormField>
      </div>
      <FormAlert message={error} />
      <Button type="submit" disabled={busy}>
        {busy ? 'Bekle…' : 'Şifreyi Değiştir'}
      </Button>
    </form>
  );
}
