import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../lib/escape';
import { usePresence } from '../lib/motion';
import { cn } from '../lib/utils';
import { useUi } from '../stores/ui';
import { EmojiPanel } from './EmojiPanel';

const MARGIN = 8;

/** Tepki seçici: mesajın üstündeki düğmeden, tepkilerin yanındaki düğmeden ya da sağ tık menüsünden açılır. */
export function EmojiPicker() {
  const picker = useUi((s) => s.emojiPicker);
  const close = useUi((s) => s.closeEmojiPicker);
  const { value: shown, closing } = usePresence(picker, 100);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; origin: string } | null>(null);

  // Sağ kenarı açıldığı öğeyle hizalı, altında; sığmazsa üstünde
  useLayoutEffect(() => {
    if (!picker || !ref.current) return;
    // Ölçü dönüşümden (açılış animasyonu) etkilenmesin
    const { offsetWidth: width, offsetHeight: height } = ref.current;
    const { anchor } = picker;
    const x = Math.max(MARGIN, Math.min(anchor.right - width, window.innerWidth - width - MARGIN));
    let y = anchor.bottom + 4;
    const below = y + height <= window.innerHeight - MARGIN;
    if (!below) y = Math.max(MARGIN, anchor.top - height - 4);
    // Açıldığı düğmenin köşesinden büyüsün
    const originX = Math.max(0, Math.min(width, anchor.right - x));
    setPos({ x, y, origin: `${originX}px ${below ? '0' : '100%'}` });
  }, [picker]);

  useEffect(() => {
    if (!picker) return;
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', close);
    };
  }, [picker, close]);
  useEscapeLayer(close, Boolean(picker));

  if (!shown) return null;

  return (
    <div
      ref={ref}
      className={cn(
        'fixed z-50 flex w-[348px] flex-col overflow-hidden rounded-lg border border-edge bg-bg-side shadow-[0_8px_24px_rgb(0_0_0/0.45)]',
        closing ? 'anim-pop-out pointer-events-none' : 'anim-pop-in',
      )}
      style={pos ? { left: pos.x, top: pos.y, transformOrigin: pos.origin } : { left: -9999, top: -9999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <EmojiPanel
        className="h-[346px]"
        onPick={(emoji) => {
          close();
          shown.onPick(emoji);
        }}
      />
    </div>
  );
}
