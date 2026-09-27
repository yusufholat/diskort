import { useRef, useState, type FormEvent } from 'react';
import { Smile, X } from 'lucide-react';
import { CUSTOM_STATUS_CLEAR_OPTIONS, CUSTOM_STATUS_MAX_LENGTH } from '@diskort/shared';
import { setCustomStatus, useSelfStatus, useSession } from '@diskort/client-core';
import { useUi } from '../../stores/ui';
import { FormField } from '../ui/FormField';
import { Modal } from '../ui/Modal';
import { Button, Select, TextInput } from '../ui/controls';

type ClearOption = (typeof CUSTOM_STATUS_CLEAR_OPTIONS)[number]['ms'];
const optionKey = (ms: ClearOption): string => String(ms);

/** "Özel durum ayarla": emoji, kısa metin ve ne zaman temizleneceği */
export function CustomStatusModal() {
  const close = useUi((s) => s.closeModal);
  const openEmojiPicker = useUi((s) => s.openEmojiPicker);
  const user = useSession((s) => s.user);
  const current = useSelfStatus()?.customStatus ?? null;
  const [text, setText] = useState(current?.text ?? '');
  const [emoji, setEmoji] = useState<string | null>(current?.emoji ?? null);
  const [clearAfter, setClearAfter] = useState<string>(optionKey('today'));
  const [busy, setBusy] = useState(false);
  const emojiButton = useRef<HTMLButtonElement>(null);

  const save = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    const option = CUSTOM_STATUS_CLEAR_OPTIONS.find((o) => optionKey(o.ms) === clearAfter)?.ms ?? null;
    const ok = await setCustomStatus(text.trim() || emoji ? { text, emoji } : null, option);
    setBusy(false);
    if (ok) close();
  };

  const pickEmoji = (): void => {
    const rect = emojiButton.current?.getBoundingClientRect();
    if (!rect) return;
    openEmojiPicker({ anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, onPick: setEmoji });
  };

  return (
    <Modal
      title="Özel durum ayarla"
      subtitle={user ? `Hey ${user.displayName}, neler oluyor?` : undefined}
      onClose={close}
    >
      <form onSubmit={save} noValidate>
        <FormField label="Şu an ne yapıyorsun?">
          <div className="relative flex items-center">
            <button
              ref={emojiButton}
              type="button"
              className="press-icon absolute left-1.5 flex h-7 w-7 items-center justify-center rounded text-lg text-text-muted hover:text-text-head"
              aria-label="Emoji seç"
              data-tooltip="Emoji seç"
              onClick={pickEmoji}
            >
              {emoji ?? <Smile size={20} />}
            </button>
            <TextInput
              value={text}
              maxLength={CUSTOM_STATUS_MAX_LENGTH}
              onChange={(e) => setText(e.target.value)}
              placeholder="Şu an canının çektiği bir şey var mı?"
              className="pr-9 pl-10"
              autoFocus
            />
            {(text || emoji) && (
              <button
                type="button"
                className="press-icon absolute right-2 rounded p-0.5 text-text-muted hover:text-text-head"
                aria-label="Temizle"
                onClick={() => {
                  setText('');
                  setEmoji(null);
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </FormField>
        <FormField label="Şundan sonra temizle">
          <Select
            value={clearAfter}
            onChange={setClearAfter}
            options={CUSTOM_STATUS_CLEAR_OPTIONS.map((o) => ({ value: optionKey(o.ms), label: o.label }))}
            aria-label="Şundan sonra temizle"
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy}>
            Kaydet
          </Button>
        </div>
      </form>
    </Modal>
  );
}
