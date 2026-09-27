import { useEffect, useState, type UIEvent } from 'react';
import { loadReactionUsers, reactionUsersKey, useMessages, useReactionUsers } from '@diskort/client-core';
import { useUi } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../../lib/utils';

/**
 * "Tepkiler" penceresi (Discord gibi): solda mesajdaki emojiler, sağda seçili emojiyle tepki verenler.
 * Liste kaydırdıkça sayfa sayfa yüklenir; tepkiler değişince kendini günceller.
 */
export function ReactionsModal({ channelId, messageId, emoji }: { channelId: string; messageId: string; emoji?: string }) {
  const close = useUi((s) => s.closeModal);
  const reactions = useMessages((s) => s.channels[channelId]?.messages.find((m) => m.id === messageId)?.reactions);
  const [selected, setSelected] = useState(emoji);
  // Seçili emojinin tepkileri kalmadıysa ilk emojiye geçilir; hiç tepki kalmadıysa pencere kapanır
  const current = reactions?.find((r) => r.emoji === selected) ?? reactions?.[0];
  const entry = useReactionUsers((s) => (current ? s.entries[reactionUsersKey(messageId, current.emoji)] : undefined));

  useEffect(() => {
    if (!reactions || reactions.length === 0) close();
  }, [reactions, close]);

  useEffect(() => {
    if (current && !entry) void loadReactionUsers(messageId, current.emoji);
  }, [current, entry, messageId]);

  const onScroll = (e: UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    if (current && entry?.next && !entry.loading && el.scrollTop + el.clientHeight > el.scrollHeight - 120) {
      void loadReactionUsers(messageId, current.emoji, true);
    }
  };

  if (!reactions || !current) return null;
  const users = entry?.users ?? [];

  return (
    <Modal title="Tepkiler" onClose={close} className="w-[560px]">
      <div className="flex h-[min(420px,60vh)] overflow-hidden rounded-md border border-edge">
        <div role="tablist" aria-orientation="vertical" className="scroll-thin w-28 shrink-0 overflow-y-auto bg-bg-side p-1.5">
          {reactions.map((r) => (
            <button
              key={r.emoji}
              role="tab"
              aria-selected={r.emoji === current.emoji}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-semibold transition-colors',
                r.emoji === current.emoji
                  ? 'bg-bg-active text-text-head'
                  : 'text-text-muted hover:bg-bg-hover hover:text-text-normal',
              )}
              onClick={() => setSelected(r.emoji)}
            >
              <span className="emoji text-xl leading-none">{r.emoji}</span>
              <span className="tabular-nums">{r.count}</span>
            </button>
          ))}
        </div>
        <div role="tabpanel" className="scroll-thin min-w-0 flex-1 overflow-y-auto p-2" onScroll={onScroll}>
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-bg-hover">
              <Avatar user={u} size={32} />
              <span className="truncate font-medium text-text-head">{u.displayName}</span>
              <span className="truncate text-sm text-text-muted">{u.username}</span>
            </div>
          ))}
          {entry?.loading &&
            Array.from({ length: users.length ? 2 : Math.min(current.count, 6) }, (_, i) => (
              <div key={`s${i}`} className="flex items-center gap-3 px-2 py-1.5">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <Skeleton className="h-3.5 w-32" />
              </div>
            ))}
          {entry?.error && (
            <div className="px-2 py-3 text-sm text-text-muted">
              Liste yüklenemedi.{' '}
              <button
                className="font-medium text-brand hover:underline"
                onClick={() => void loadReactionUsers(messageId, current.emoji, users.length > 0)}
              >
                Tekrar dene
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
