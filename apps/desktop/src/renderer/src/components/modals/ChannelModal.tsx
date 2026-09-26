import { useState, type FormEvent } from 'react';
import type { Channel } from '@diskurt/shared';
import { CHANNEL_NAME_MAX_LENGTH } from '@diskurt/shared';
import { api, errorMessage } from '../../lib/api';
import { useUi } from '../../stores/ui';
import { Modal } from '../ui/Modal';
import { Button, Field, TextInput } from '../ui/controls';

/** Ses kanalı oluşturma / yeniden adlandırma (yönetici). */
export function ChannelModal({ channel }: { channel?: Channel }) {
  const close = useUi((s) => s.closeModal);
  const [name, setName] = useState(channel?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (channel) await api.updateChannel(channel.id, { name });
      else await api.createChannel({ name, type: 'voice' });
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={channel ? 'Kanalı Düzenle' : 'Ses Kanalı Oluştur'} onClose={close}>
      <form onSubmit={submit}>
        <Field label="Kanal adı" error={error ?? undefined}>
          <TextInput
            value={name}
            maxLength={CHANNEL_NAME_MAX_LENGTH}
            onChange={(e) => setName(e.target.value)}
            placeholder="yeni-kanal"
            autoFocus
            required
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {channel ? 'Kaydet' : 'Kanal Oluştur'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
