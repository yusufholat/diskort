import { useCallback, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import { sendGif, useFeatures } from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { ExpressionPicker, type ExpressionTab } from './ExpressionPicker';

interface Props {
  channelId: string;
  /** Seçilen emojiyi yazma kutusuna imlecin olduğu yere ekler */
  onEmoji: (emoji: string) => void;
  /** Panel kapanınca (yazma kutusuna odak döner) */
  onClosed: () => void;
  /** GIF gönderildi (liste en alta kaysın) */
  onSent: () => void;
}

/**
 * Mesaj kutusunun sağındaki düğmeler: GIF (sunucuda açıksa) ve emoji. İkisi de aynı paneli açar;
 * açık sekmenin düğmesine yeniden tıklamak paneli kapatır.
 */
export function ComposerToolbar({ channelId, onEmoji, onClosed, onSent }: Props) {
  const gifs = useFeatures((s) => s.gifs);
  const [tab, setTab] = useState<ExpressionTab | null>(null);
  const buttons = useRef<HTMLDivElement>(null);

  const close = useCallback((): void => {
    setTab(null);
    onClosed();
  }, [onClosed]);

  const toggle = (next: ExpressionTab): void => {
    if (tab === next) close();
    else setTab(next);
  };

  return (
    <>
      <div ref={buttons} className="flex h-11 shrink-0 items-center gap-0.5 pr-2">
        {gifs && (
          <button
            className={cn(
              'press-icon flex h-8 items-center rounded px-1.5 transition-colors',
              tab === 'gif' ? 'text-text-head' : 'text-text-muted hover:text-text-head',
            )}
            data-tooltip="GIF gönder"
            aria-label="GIF gönder"
            aria-expanded={tab === 'gif'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle('gif')}
          >
            <span className="rounded-[4px] border-2 border-current px-[3px] text-[10px] leading-[13px] font-extrabold">GIF</span>
          </button>
        )}
        <button
          className={cn(
            'press-icon flex h-8 items-center rounded px-1.5 transition-colors',
            tab === 'emoji' ? 'text-text-head' : 'text-text-muted hover:text-text-head',
          )}
          data-tooltip="Emoji seç"
          aria-label="Emoji seç"
          aria-expanded={tab === 'emoji'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggle('emoji')}
        >
          <Smile size={22} />
        </button>
      </div>
      <ExpressionPicker
        tab={tab}
        gifs={gifs}
        onTab={setTab}
        onClose={close}
        onEmoji={onEmoji}
        onGif={(gif) => {
          sendGif(channelId, gif);
          close();
          onSent();
        }}
        toggleRef={buttons}
      />
    </>
  );
}
