import { useEffect, useRef, type RefObject } from 'react';
import type { GifResult } from '@diskort/shared';
import { closeGifPicker, openGifPicker } from '@diskort/client-core';
import { useEscapeLayer } from '../../lib/escape';
import { usePresence } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { EmojiPanel } from '../EmojiPanel';
import { GifPanel } from './GifPanel';

export type ExpressionTab = 'gif' | 'emoji';

interface Props {
  /** Açık sekme; null: kapalı */
  tab: ExpressionTab | null;
  /** GIF sekmesi gösterilsin mi (sunucuda GIF araması açık) */
  gifs: boolean;
  onTab: (tab: ExpressionTab) => void;
  onClose: () => void;
  onEmoji: (emoji: string) => void;
  onGif: (gif: GifResult) => void;
  /** Açma düğmeleri: onlara tıklamak "dışarı tıklama" sayılmaz (düğme kendisi açar/kapatır) */
  toggleRef: RefObject<HTMLElement | null>;
}

/**
 * Mesaj kutusunun sağındaki düğmelerden açılan panel (Discord'daki gibi): GIF ve Emoji sekmeleri.
 * Yazma kutusunun hemen üstünde, sağa hizalı açılır; Esc ya da dışarı tıklama kapatır.
 */
export function ExpressionPicker({ tab, gifs, onTab, onClose, onEmoji, onGif, toggleRef }: Props) {
  const { value: shown, closing } = usePresence(tab, 100);
  const ref = useRef<HTMLDivElement>(null);
  const open = tab !== null;
  const current = shown === 'gif' && !gifs ? 'emoji' : shown;

  useEscapeLayer(onClose, open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || toggleRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onClose);
    };
  }, [open, onClose, toggleRef]);

  // GIF sekmesi açılınca popüler GIF'ler; kapanınca bekleyen arama bırakılır
  const gifOpen = open && current === 'gif';
  useEffect(() => {
    if (!gifOpen) return;
    openGifPicker();
    return closeGifPicker;
  }, [gifOpen]);

  if (!current) return null;

  const tabs: { id: ExpressionTab; label: string }[] = [
    ...(gifs ? [{ id: 'gif' as const, label: "GIF'ler" }] : []),
    { id: 'emoji', label: 'Emoji' },
  ];

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={current === 'gif' ? 'GIF seçici' : 'Emoji seçici'}
      className={cn(
        'absolute right-4 bottom-full z-30 mb-2 flex h-[min(460px,calc(100vh-140px))] w-[424px] origin-bottom-right flex-col overflow-hidden rounded-lg border border-edge bg-bg-side shadow-[0_8px_24px_rgb(0_0_0/0.45)]',
        closing ? 'anim-pop-out pointer-events-none' : 'anim-pop-in',
      )}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex shrink-0 gap-1 px-3 pt-3 pb-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={current === t.id}
            className={cn(
              'press rounded px-2 py-0.5 text-sm font-medium transition-colors',
              current === t.id ? 'bg-bg-active text-text-head' : 'text-text-muted hover:bg-bg-hover hover:text-text-normal',
            )}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current === 'gif' ? (
        <GifPanel onSend={onGif} />
      ) : (
        <EmojiPanel
          className="flex-1"
          onPick={(emoji, keepOpen) => {
            onEmoji(emoji);
            if (!keepOpen) onClose();
          }}
        />
      )}
    </div>
  );
}
