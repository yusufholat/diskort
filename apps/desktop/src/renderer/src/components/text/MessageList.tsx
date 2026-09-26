import { Fragment, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Hash } from 'lucide-react';
import type { Channel, User } from '@diskort/shared';
import { loadOlder, useMessages, type LocalMessage, useGuild } from '@diskort/client-core';
import type { MarkdownContext } from '../../features/messages/markdown';
import { MessageItem } from './MessageItem';
import { formatDay, sameDay } from './format';

const GROUP_WINDOW_MS = 7 * 60_000;
const STICK_THRESHOLD_PX = 24;
const LOAD_OLDER_THRESHOLD_PX = 600;

const EMPTY: LocalMessage[] = [];

interface Props {
  channel: Channel;
  self: User;
  /** "YENİ" ayracının üstünde duracağı mesaj */
  dividerId: string | null;
  onAtBottomChange: (atBottom: boolean) => void;
  /** Dışarıdan "en alta kaydır" isteği (sayaç arttıkça) */
  scrollToBottomSignal: number;
}

export function MessageList({ channel, self, dividerId, onAtBottomChange, scrollToBottomSignal }: Props) {
  const messages = useMessages((s) => s.channels[channel.id]?.messages ?? EMPTY);
  const hasMore = useMessages((s) => s.channels[channel.id]?.hasMore ?? true);
  const loaded = useMessages((s) => s.channels[channel.id]?.loaded ?? false);
  const editingId = useMessages((s) => s.editingId);
  const users = useGuild((s) => s.users);

  const md: MarkdownContext = useMemo(
    () => ({ usersByName: Object.fromEntries(Object.values(users).map((u) => [u.username, u])), selfId: self.id }),
    [users, self.id],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const snapshot = useRef<{ firstId: string | undefined; height: number; top: number }>({
    firstId: undefined,
    height: 0,
    top: 0,
  });

  // Yeni mesajda en altta kal; eski mesajlar yukarı eklenince görünen konumu koru.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstId = messages[0]?.id;
    const prev = snapshot.current;
    if (stick.current) el.scrollTop = el.scrollHeight;
    else if (prev.firstId !== firstId) el.scrollTop = prev.top + (el.scrollHeight - prev.height);
    snapshot.current = { firstId, height: el.scrollHeight, top: el.scrollTop };
  }, [messages, hasMore]);

  // Pencere/yazma kutusu boyutu değişince de altta kal
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
      snapshot.current.height = el.scrollHeight;
      snapshot.current.top = el.scrollTop;
    });
    observer.observe(el);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (scrollToBottomSignal === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    stick.current = true;
    el.scrollTop = el.scrollHeight;
  }, [scrollToBottomSignal]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    if (atBottom !== stick.current) onAtBottomChange(atBottom);
    stick.current = atBottom;
    snapshot.current.top = el.scrollTop;
    snapshot.current.height = el.scrollHeight;
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX && loaded) void loadOlder(channel.id);
  };

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-scroll" onScroll={onScroll}>
      <div ref={contentRef} className="flex min-h-full flex-col justify-end pb-6">
        {hasMore || !loaded ? (
          <div className="flex h-24 shrink-0 items-center justify-center text-sm text-text-faint">
            {loaded || messages.length ? 'Eski mesajlar yükleniyor…' : 'Mesajlar yükleniyor…'}
          </div>
        ) : (
          <div className="mx-4 mt-4 mb-2">
            <div className="mb-2 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-bg-active">
              <Hash size={42} className="text-text-head" />
            </div>
            <h2 className="text-[32px] leading-tight font-bold text-text-head">#{channel.name} kanalına hoş geldin!</h2>
            <p className="text-text-muted">Bu, #{channel.name} kanalının başlangıcı.</p>
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
          const divider = m.id === dividerId;
          const compact =
            !!prev &&
            !newDay &&
            !divider &&
            prev.authorId === m.authorId &&
            prev.status !== 'failed' &&
            m.createdAt - prev.createdAt < GROUP_WINDOW_MS;
          return (
            <Fragment key={m.nonce ?? m.id}>
              {(newDay || divider) && <Separator day={newDay ? m.createdAt : null} unread={divider} />}
              <MessageItem
                message={m}
                author={m.authorId ? users[m.authorId] : undefined}
                compact={compact}
                editing={editingId === m.id}
                self={self}
                md={md}
              />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Separator({ day, unread }: { day: number | null; unread: boolean }) {
  const color = unread ? 'bg-danger' : 'bg-line';
  return (
    <div className="relative mx-4 mt-6 mb-2 flex h-0 items-center">
      <div className={`h-px flex-1 ${color}`} />
      {day !== null && (
        <span className="bg-bg-main px-1 text-xs font-semibold text-text-muted">{formatDay(day)}</span>
      )}
      {day !== null && <div className={`h-px flex-1 ${color}`} />}
      {unread && (
        <span className="absolute right-0 rounded-sm bg-danger px-1 text-[10px] leading-4 font-bold text-white">
          YENİ
        </span>
      )}
    </div>
  );
}
