import { useState, type FormEvent } from 'react';
import { Hash, Volume2 } from 'lucide-react';
import type { Channel, ChannelType } from '@diskort/shared';
import { CHANNEL_NAME_MAX_LENGTH } from '@diskort/shared';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useUi } from '../../stores/ui';
import { Modal } from '../ui/Modal';
import { Button, Field, TextInput } from '../ui/controls';

const TYPES: { type: ChannelType; label: string; hint: string; icon: typeof Hash }[] = [
  { type: 'text', label: 'Metin', hint: 'Mesajlar, bağlantılar, fikirler', icon: Hash },
  { type: 'voice', label: 'Ses', hint: 'Sesli sohbet ve ekran paylaşımı', icon: Volume2 },
];

/** Metin kanalı adları Discord'daki gibi küçük harf ve tireli olur. */
const textChannelName = (name: string): string => name.toLocaleLowerCase('tr').replace(/\s+/g, '-');

/** Kanal oluşturma / yeniden adlandırma (yönetici). */
export function ChannelModal({ channel, channelType }: { channel?: Channel; channelType?: ChannelType }) {
  const close = useUi((s) => s.closeModal);
  const setView = useUi((s) => s.setView);
  const [type, setType] = useState<ChannelType>(channel?.type ?? channelType ?? 'text');
  const [name, setName] = useState(channel?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finalName = (type === 'text' ? textChannelName(name) : name).trim();

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (channel) {
        await api.updateChannel(channel.id, { name: finalName });
      } else {
        const created = await api.createChannel({ name: finalName, type });
        if (created.type === 'text') setView({ kind: 'text', channelId: created.id });
      }
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const Icon = type === 'text' ? Hash : Volume2;

  return (
    <Modal title={channel ? 'Kanalı Düzenle' : 'Kanal Oluştur'} onClose={close}>
      <form onSubmit={submit}>
        {!channel && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-bold text-text-muted uppercase">Kanal türü</div>
            <div className="flex flex-col gap-2">
              {TYPES.map((t) => (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => setType(t.type)}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                    type === t.type ? 'bg-bg-active text-text-head' : 'bg-bg-side text-text-normal hover:bg-bg-hover',
                  )}
                >
                  <t.icon size={22} className="shrink-0 text-text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t.label}</div>
                    <div className="text-sm text-text-muted">{t.hint}</div>
                  </div>
                  <span
                    className={cn(
                      'h-5 w-5 shrink-0 rounded-full border-2',
                      type === t.type ? 'border-[6px] border-white' : 'border-text-muted',
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Kanal adı" error={error ?? undefined}>
          <div className="relative">
            <Icon size={18} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-muted" />
            <TextInput
              value={type === 'text' ? textChannelName(name) : name}
              maxLength={CHANNEL_NAME_MAX_LENGTH}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'text' ? 'yeni-kanal' : 'Yeni Kanal'}
              className="pl-9"
              autoFocus
              required
            />
          </div>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy || !finalName}>
            {channel ? 'Kaydet' : 'Kanal Oluştur'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
