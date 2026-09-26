import { useEffect, useRef, useState } from 'react';
import { Hash } from 'lucide-react';
import type { Channel } from '@diskort/shared';
import { ackChannel, loadInitial, useMessages } from '../../features/messages/messages';
import { useGuild } from '../../stores/guild';
import { useSession } from '../../stores/session';
import { useUi } from '../../stores/ui';
import { Composer, type ComposerHandle } from './Composer';
import { MessageList } from './MessageList';

/** Metin kanalı: başlık, mesaj listesi, yazma kutusu ve "yazıyor" göstergesi. */
export function TextChannelView({ channel }: { channel: Channel }) {
  const self = useSession((s) => s.user)!;
  const loaded = useMessages((s) => s.channels[channel.id]?.loaded ?? false);
  const lastId = useGuild((s) => s.lastMessageIds[channel.id]);
  const readId = useGuild((s) => s.readStates[channel.id]);
  const [atBottom, setAtBottom] = useState(true);
  const [focused, setFocused] = useState(() => document.hasFocus());
  const [scrollSignal, setScrollSignal] = useState(0);
  const composer = useRef<ComposerHandle>(null);

  // Kanal açıldığında okunmamış ilk mesajın üstüne "YENİ" ayracı konur.
  const readAtOpen = useRef(readId);
  const [dividerId, setDividerId] = useState<string | null>(null);
  const dividerDecided = useRef(false);
  const messages = useMessages((s) => s.channels[channel.id]?.messages);

  useEffect(() => {
    void loadInitial(channel.id);
  }, [channel.id]);

  useEffect(() => {
    const onFocus = (): void => setFocused(true);
    const onBlur = (): void => setFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const watching = focused && atBottom;

  useEffect(() => {
    if (!loaded || !messages) return;
    if (!dividerDecided.current) {
      dividerDecided.current = true;
      const first = messages.find(
        (m) => !m.status && m.authorId !== self.id && Number(m.id) > Number(readAtOpen.current ?? 0),
      );
      setDividerId(first?.id ?? null);
      return;
    }
    // Bakmıyorken gelen ilk mesaj için ayraç
    if (!watching && dividerId === null && lastId && Number(lastId) > Number(readId ?? 0)) {
      const first = messages.find((m) => !m.status && m.authorId !== self.id && Number(m.id) > Number(readId ?? 0));
      if (first) setDividerId(first.id);
    }
  }, [loaded, messages, watching, dividerId, lastId, readId, self.id]);

  // Kanal görünür, pencere odakta ve en alttaysa okundu say
  useEffect(() => {
    if (loaded && watching && lastId && Number(lastId) > Number(readId ?? 0)) ackChannel(channel.id);
  }, [loaded, watching, lastId, readId, channel.id]);

  // Herhangi bir yere yazmaya başlayınca yazma kutusuna odaklan
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || useUi.getState().modal)) return;
      composer.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const unreadBelow = !atBottom && lastId !== undefined && Number(lastId) > Number(readId ?? 0);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-bg-main">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/30 px-4 shadow-sm">
        <Hash size={22} className="text-text-muted" />
        <span className="font-semibold text-text-head">{channel.name}</span>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {unreadBelow && (
          <button
            className="absolute top-0 right-4 left-4 z-10 flex items-center justify-between rounded-b-lg bg-brand px-3 py-1 text-sm font-medium text-white shadow"
            onClick={() => setScrollSignal((n) => n + 1)}
          >
            <span>Yeni mesajların var</span>
            <span>Şimdiye atla ↓</span>
          </button>
        )}
        <MessageList
          channel={channel}
          self={self}
          dividerId={dividerId}
          onAtBottomChange={setAtBottom}
          scrollToBottomSignal={scrollSignal}
        />
      </div>

      <Composer
        ref={composer}
        channel={channel}
        self={self}
        onSend={() => {
          setDividerId(null);
          setScrollSignal((n) => n + 1);
        }}
      />
      <TypingIndicator channelId={channel.id} selfId={self.id} />
    </div>
  );
}

function TypingIndicator({ channelId, selfId }: { channelId: string; selfId: string }) {
  const typing = useMessages((s) => s.typing[channelId]);
  const users = useGuild((s) => s.users);
  const names = Object.keys(typing ?? {})
    .filter((id) => id !== selfId)
    .map((id) => users[id]?.displayName)
    .filter((n): n is string => Boolean(n));

  let text = '';
  if (names.length === 1) text = `${names[0]} yazıyor…`;
  else if (names.length === 2) text = `${names[0]} ve ${names[1]} yazıyor…`;
  else if (names.length === 3) text = `${names[0]}, ${names[1]} ve ${names[2]} yazıyor…`;
  else if (names.length > 3) text = 'Birkaç kişi yazıyor…';

  return (
    <div className="flex h-6 shrink-0 items-center gap-1.5 px-4 text-xs text-text-normal">
      {text && (
        <>
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-normal"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
          <span className="truncate">
            <strong>{text.replace(/ yazıyor…$/, '')}</strong> yazıyor…
          </span>
        </>
      )}
    </div>
  );
}
