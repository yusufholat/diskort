import { useRef, useState, type FormEvent } from 'react';
import { Hash, Volume2 } from 'lucide-react';
import type { Channel, ChannelType } from '@diskort/shared';
import { CHANNEL_NAME_MAX_LENGTH } from '@diskort/shared';
import { api, errorMessage } from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { useUi } from '../../stores/ui';
import { Modal } from '../ui/Modal';
import { Button, TextInput } from '../ui/controls';
import { FormField, REQUIRED, focusFirstInvalid, useFormErrors } from '../ui/FormField';

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
  const [busy, setBusy] = useState(false);
  const form = useFormErrors<'name'>();
  const formRef = useRef<HTMLFormElement>(null);

  const finalName = (type === 'text' ? textChannelName(name) : name).trim();

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!form.validate({ name: !finalName && REQUIRED })) {
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      if (channel) {
        await api.updateChannel(channel.id, { name: finalName });
      } else {
        const created = await api.createChannel({ name: finalName, type });
        if (created.type === 'text') setView({ kind: 'text', channelId: created.id });
      }
      close();
    } catch (err) {
      // Sunucunun reddi (ör. geçersiz ad) alanın altında gösterilir
      form.validate({ name: errorMessage(err) });
      focusFirstInvalid(formRef.current);
    } finally {
      setBusy(false);
    }
  };

  const Icon = type === 'text' ? Hash : Volume2;

  return (
    <Modal title={channel ? 'Kanalı Düzenle' : 'Kanal Oluştur'} onClose={close}>
      <form ref={formRef} onSubmit={submit} noValidate>
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
                    'press flex items-center gap-3 rounded-md px-3 py-2.5 text-left',
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
                      'h-5 w-5 shrink-0 rounded-full border-2 transition-[border-width,border-color] duration-150',
                      type === t.type ? 'border-[6px] border-white' : 'border-text-muted',
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
        )}
        <FormField label="Kanal adı" error={form.errors.name} shakeKey={form.attempt}>
          <div className="relative">
            <Icon size={18} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-muted" />
            <TextInput
              value={type === 'text' ? textChannelName(name) : name}
              maxLength={CHANNEL_NAME_MAX_LENGTH}
              onChange={(e) => {
                setName(e.target.value);
                form.clear('name');
              }}
              placeholder={type === 'text' ? 'yeni-kanal' : 'Yeni Kanal'}
              className="pl-9"
              autoFocus
            />
          </div>
        </FormField>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy}>
            {channel ? 'Kaydet' : 'Kanal Oluştur'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
