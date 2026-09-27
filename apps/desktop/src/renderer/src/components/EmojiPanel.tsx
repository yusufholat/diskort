import { useRef, useState, type MouseEvent } from 'react';
import { EMOJI_CATEGORIES } from '@diskort/client-core';
import { cn } from '../lib/utils';

/**
 * Kategorili emoji ızgarası (üstte kategori sekmeleri, kaydırdıkça işaretlenir). Tepki seçici ve
 * mesaj kutusundaki emoji paneli ortak kullanır. `onPick`'in ikinci bağımsızlığı: Shift basılı (panel
 * açık kalsın). Düğmeler odak almaz; yazma kutusundaki imleç yerinde kalır.
 */
export function EmojiPanel({
  onPick,
  className,
}: {
  onPick: (emoji: string, keepOpen: boolean) => void;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sections = useRef<Record<string, HTMLDivElement | null>>({});
  const [active, setActive] = useState(EMOJI_CATEGORIES[0]!.id);

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

  const keepFocus = (e: MouseEvent): void => e.preventDefault();

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex gap-0.5 border-b border-black/30 bg-bg-panel px-2 py-1.5">
        {EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.id}
            data-tooltip={c.label}
            data-tooltip-side="bottom"
            aria-label={c.label}
            className={cn(
              'emoji press-icon flex h-8 w-9 items-center justify-center rounded text-lg',
              active === c.id ? 'bg-bg-active' : 'opacity-60 grayscale hover:bg-bg-hover hover:opacity-100 hover:grayscale-0',
            )}
            onMouseDown={keepFocus}
            onClick={() => jump(c.id)}
          >
            {c.emojis[0]}
          </button>
        ))}
      </div>
      <div ref={scrollRef} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto px-2 pb-2" onScroll={onScroll}>
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
                  className="emoji flex h-10 w-10 items-center justify-center rounded text-[24px] transition-[background-color,transform] duration-100 hover:scale-110 hover:bg-bg-hover active:scale-95"
                  onMouseDown={keepFocus}
                  onClick={(e) => onPick(emoji, e.shiftKey)}
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
