import { useState, type FormEvent } from 'react';
import { BAN_REASON_MAX_LENGTH } from '@diskort/shared';
import { moderation } from '@diskort/client-core';
import { toast, useUi } from '../../stores/ui';
import { Modal } from '../ui/Modal';
import { Button, Field, TextInput } from '../ui/controls';

/** Üyeyi yasaklama: isteğe bağlı sebeple. Diğer pencerelerin (ör. sunucu ayarları) üstünde açılır. */
export function BanModal() {
  const user = useUi((s) => s.banUser);
  const close = (): void => useUi.getState().setBanUser(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    const ok = await moderation.ban(user.id, reason.trim() || undefined);
    setBusy(false);
    if (!ok) return;
    toast(`${user.displayName} sunucudan yasaklandı.`, 'success');
    setReason('');
    close();
  };

  return (
    <div className="relative z-[60]">
      <Modal title={`${user.displayName} yasaklansın mı?`} onClose={close} className="w-[440px]">
        <form onSubmit={(e) => void submit(e)} noValidate>
          <p className="mb-4 text-center text-[15px] leading-relaxed text-text-normal">
            Oturumu kapanır, rolleri alınır ve yasak kaldırılana kadar giriş yapamaz, yeni bir davetle de geri
            dönemez. Mesajları silinmez.
          </p>
          <Field label="Sebep (isteğe bağlı, yalnızca yetkililer görür)">
            <TextInput
              value={reason}
              maxLength={BAN_REASON_MAX_LENGTH}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ör. kurallara uymadı"
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Vazgeç
            </Button>
            <Button type="submit" variant="danger" disabled={busy}>
              Yasakla
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
