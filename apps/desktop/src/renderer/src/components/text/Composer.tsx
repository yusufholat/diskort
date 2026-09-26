import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { MESSAGE_MAX_LENGTH, type Channel, type User } from '@diskort/shared';
import { notifyTyping, sendMessage, setEditing, useMessages } from '../../features/messages/messages';
import { cn } from '../../lib/utils';
import { useGuild } from '../../stores/guild';
import { toast } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';

/** Kanal değiştirince yarım kalan mesaj kaybolmasın */
const drafts = new Map<string, string>();

const MENTION_QUERY = /(?:^|[\s(])@([a-z0-9_.]{0,32})$/i;
const MAX_SUGGESTIONS = 8;

export interface ComposerHandle {
  focus: () => void;
}

interface Props {
  channel: Channel;
  self: User;
  onSend: () => void;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ channel, self, onSend }, handle) {
  const [value, setValue] = useState(() => drafts.get(channel.id) ?? '');
  const [caret, setCaret] = useState(0);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const users = useGuild((s) => s.users);
  const online = useGuild((s) => s.online);

  useImperativeHandle(handle, () => ({ focus: () => ref.current?.focus() }), []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.5)}px`;
  }, [value]);

  // ---------- @bahsetme önerileri ----------
  const query = MENTION_QUERY.exec(value.slice(0, caret))?.[1];
  const suggestions = useMemo(() => {
    if (query === undefined || query === dismissed) return [];
    const q = query.toLocaleLowerCase('tr');
    return Object.values(users)
      .filter((u) => u.username.startsWith(q) || u.displayName.toLocaleLowerCase('tr').includes(q))
      .sort((a, b) => Number(!!online[b.id]) - Number(!!online[a.id]) || a.username.localeCompare(b.username))
      .slice(0, MAX_SUGGESTIONS);
  }, [query, dismissed, users, online]);
  const active = Math.min(selected, Math.max(0, suggestions.length - 1));

  const update = (next: string, nextCaret: number): void => {
    setValue(next);
    setCaret(nextCaret);
    setSelected(0);
    if (next) drafts.set(channel.id, next);
    else drafts.delete(channel.id);
  };

  const pick = (user: User): void => {
    const before = value.slice(0, caret).replace(/@[a-z0-9_.]*$/i, `@${user.username} `);
    const next = before + value.slice(caret);
    update(next, before.length);
    requestAnimationFrame(() => ref.current?.setSelectionRange(before.length, before.length));
  };

  const send = (): void => {
    const content = value.trim();
    if (!content) return;
    if (content.length > MESSAGE_MAX_LENGTH) {
      toast(`Mesaj en fazla ${MESSAGE_MAX_LENGTH} karakter olabilir.`, 'error');
      return;
    }
    sendMessage(channel.id, content);
    update('', 0);
    onSend();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing) return;
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setSelected((active + delta + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(suggestions[active]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(query ?? null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'ArrowUp' && !value) {
      // Discord gibi: boş kutuda yukarı ok son mesajını düzenler
      const own = useMessages
        .getState()
        .channels[channel.id]?.messages.findLast((m) => m.authorId === self.id && !m.status);
      if (own) {
        e.preventDefault();
        setEditing(own.id);
      }
    }
  };

  const remaining = MESSAGE_MAX_LENGTH - value.trim().length;

  return (
    <div className="relative px-4">
      {suggestions.length > 0 && (
        <div className="absolute right-4 bottom-full left-4 mb-2 overflow-hidden rounded-lg bg-bg-side py-2 shadow-xl">
          <div className="px-3 pb-1 text-xs font-bold text-text-muted uppercase">Üyeler</div>
          {suggestions.map((u, i) => (
            <button
              key={u.id}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left',
                i === active ? 'bg-bg-active text-text-head' : 'text-text-normal',
              )}
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(u);
              }}
            >
              <Avatar user={u} size={24} online={!!online[u.id]} />
              <span className="font-medium">{u.displayName}</span>
              <span className="text-sm text-text-muted">{u.username}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end rounded-lg bg-bg-hover">
        <textarea
          ref={ref}
          value={value}
          rows={1}
          autoFocus
          maxLength={MESSAGE_MAX_LENGTH * 2}
          placeholder={`#${channel.name} kanalına mesaj gönder`}
          onChange={(e) => {
            update(e.target.value, e.target.selectionStart);
            if (e.target.value.trim()) notifyTyping(channel.id);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          className="block max-h-[50vh] min-h-11 w-full resize-none bg-transparent px-4 py-[11px] leading-[1.375rem] text-text-normal outline-none placeholder:text-text-faint"
        />
        {remaining < 200 && (
          <span className={cn('shrink-0 px-3 py-3 text-xs', remaining < 0 ? 'text-danger' : 'text-text-muted')}>
            {remaining}
          </span>
        )}
      </div>
    </div>
  );
});
