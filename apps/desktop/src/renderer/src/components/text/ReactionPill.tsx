import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { loadReactionUsers, reactionSummary, reactionUsersKey, useReactionUsers } from '@diskort/client-core';
import { bump } from '../../lib/motion';
import { cn } from '../../lib/utils';

/**
 * Mesajın altındaki tepki: sonradan eklenince "pıt" diye belirir, sayı ya da benim tepkim
 * değişince hafifçe zıplar. Geçmiş yüklenirken var olan tepkiler animasyonsuz çizilir.
 * Üstüne gelince kimlerin tepki verdiği ipucunda görünür (Discord gibi); sağ tık hepsini gösteren
 * "Tepkiler" penceresini açar.
 */
export function ReactionPill({
  messageId,
  emoji,
  count,
  me,
  animateIn,
  onToggle,
  onShowAll,
}: {
  messageId: string;
  emoji: string;
  count: number;
  me: boolean;
  /** Mesaj ekrandayken eklendi mi (ilk çizimdeki değer kullanılır) */
  animateIn: boolean;
  onToggle: () => void;
  onShowAll: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [popIn] = useState(animateIn);
  const last = useRef({ count, me });
  // Kişiler yalnızca üstüne gelinince istenir (her mesaj için istek atılmaz)
  const [hovered, setHovered] = useState(false);
  const key = reactionUsersKey(messageId, emoji);
  const entry = useReactionUsers((s) => (hovered ? s.entries[key] : undefined));

  useEffect(() => {
    const prev = last.current;
    last.current = { count, me };
    if (prev.count !== count || prev.me !== me) bump(ref.current);
  }, [count, me]);

  useEffect(() => {
    if (hovered && !entry) void loadReactionUsers(messageId, emoji);
  }, [hovered, entry, messageId, emoji]);

  const names = entry?.users.map((u) => u.displayName) ?? [];
  const tooltip = reactionSummary(names, count, emoji);

  const showAll = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    onShowAll();
  };

  return (
    <button
      ref={ref}
      data-tooltip={tooltip}
      aria-label={`${tooltip}. ${me ? 'Tepkini geri almak' : 'Sen de tepki vermek'} için tıkla.`}
      aria-pressed={me}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-lg border px-2 transition-colors duration-150 active:scale-95',
        popIn && 'anim-pill-in',
        me
          ? 'border-brand bg-brand/20 text-text-head'
          : 'border-transparent bg-bg-side text-text-muted hover:border-line hover:text-text-normal',
      )}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onClick={onToggle}
      onContextMenu={showAll}
    >
      <span className="emoji text-[19px] leading-none">{emoji}</span>
      <span className="min-w-2 text-[13px] font-semibold tabular-nums">{count}</span>
    </button>
  );
}
