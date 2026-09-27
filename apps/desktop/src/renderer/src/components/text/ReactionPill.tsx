import { useEffect, useRef, useState } from 'react';
import { bump } from '../../lib/motion';
import { cn } from '../../lib/utils';

/**
 * Mesajın altındaki tepki: sonradan eklenince "pıt" diye belirir, sayı ya da benim tepkim
 * değişince hafifçe zıplar. Geçmiş yüklenirken var olan tepkiler animasyonsuz çizilir.
 */
export function ReactionPill({
  emoji,
  count,
  me,
  animateIn,
  onToggle,
}: {
  emoji: string;
  count: number;
  me: boolean;
  /** Mesaj ekrandayken eklendi mi (ilk çizimdeki değer kullanılır) */
  animateIn: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [popIn] = useState(animateIn);
  const last = useRef({ count, me });

  useEffect(() => {
    const prev = last.current;
    last.current = { count, me };
    if (prev.count !== count || prev.me !== me) bump(ref.current);
  }, [count, me]);

  return (
    <button
      ref={ref}
      data-tooltip={me ? 'Tepkini geri al' : 'Sen de tepki ver'}
      aria-pressed={me}
      className={cn(
        'flex h-6 items-center gap-1.5 rounded-lg border px-1.5 transition-colors duration-150 active:scale-95',
        popIn && 'anim-pill-in',
        me
          ? 'border-brand bg-brand/20 text-text-head'
          : 'border-transparent bg-bg-side text-text-muted hover:border-line hover:text-text-normal',
      )}
      onClick={onToggle}
    >
      <span className="emoji text-base leading-none">{emoji}</span>
      <span className="min-w-2 text-xs font-semibold tabular-nums">{count}</span>
    </button>
  );
}
