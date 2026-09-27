import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EMOJI_CATEGORIES } from '@diskort/client-core';
import { cn } from '../lib/utils';
import { useUi } from '../stores/ui';

const MARGIN = 8;

/** Tepki seçici: mesajın üstündeki düğmeden, tepkilerin yanındaki düğmeden ya da sağ tık menüsünden açılır. */
export function EmojiPicker() {
  const picker = useUi((s) => s.emojiPicker);
  const close = useUi((s) => s.closeEmojiPicker);
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sections = useRef<Record<string, HTMLDivElement | null>>({});
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(EMOJI_CATEGORIES[0]!.id);

  // Sağ kenarı açıldığı öğeyle hizalı, altında; sığmazsa üstünde
  useLayoutEffect(() => {
    if (!picker || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const { anchor } = picker;
    const x = Math.max(MARGIN, Math.min(anchor.right - width, window.innerWidth - width - MARGIN));
    let y = anchor.bottom + 4;
    if (y + height > window.innerHeight - MARGIN) y = Math.max(MARGIN, anchor.top - height - 4);
    setPos({ x, y });
    setActive(EMOJI_CATEGORIES[0]!.id);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [picker]);

  useEffect(() => {
    if (!picker) return;
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [picker, close]);

  if (!picker) return null;

  const jump = (id: string): void => {
    const section = sections.current[id];
    if (section && scrollRef.current) scrollRef.current.scrollTop = section.offsetTop;
    setActive(id);
  };

  // Kaydırdıkça üstteki sekme işaretlenir
  const onScroll = (): void => {
    const top = scrollRef.current?.scrollTop ?? 0;
    let current = EMOJI_CATEGORIES[0]!.id;
    for (const c of EMOJI_CATEGORIES) {
      const section = sections.current[c.id];
      if (section && section.offsetTop <= top + 4) current = c.id;
    }
    setActive(current);
  };

  return (
    <div
      ref={ref}
      className="animate-pop fixed z-50 flex w-[348px] flex-col overflow-hidden rounded-lg bg-bg-side shadow-2xl"
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex gap-0.5 border-b border-black/30 bg-bg-panel px-2 py-1.5">
        {EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.id}
            title={c.label}
            className={cn(
              'emoji flex h-8 w-9 items-center justify-center rounded text-lg',
              active === c.id ? 'bg-bg-active' : 'opacity-60 grayscale hover:bg-bg-hover hover:opacity-100 hover:grayscale-0',
            )}
            onClick={() => jump(c.id)}
          >
            {c.emojis[0]}
          </button>
        ))}
      </div>
      <div ref={scrollRef} className="relative h-[300px] overflow-y-auto px-2 pb-2" onScroll={onScroll}>
        {EMOJI_CATEGORIES.map((c) => (
          <div
            key={c.id}
            ref={(el) => {
              sections.current[c.id] = el;
            }}
          >
            <div className="sticky top-0 bg-bg-side pt-2 pb-1 text-xs font-bold text-text-muted uppercase">{c.label}</div>
            <div className="grid grid-cols-8">
              {c.emojis.map((emoji) => (
                <button
                  key={emoji}
                  className="emoji flex h-10 w-10 items-center justify-center rounded text-[24px] hover:bg-bg-hover"
                  onClick={() => {
                    close();
                    picker.onPick(emoji);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
