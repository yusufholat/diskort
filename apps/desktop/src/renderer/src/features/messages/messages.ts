import { create } from 'zustand';
import {
  extractMentions,
  MESSAGE_PAGE_SIZE,
  TYPING_TIMEOUT_MS,
  type GatewayServerMessage,
  type Message,
} from '@diskort/shared';
import { api, errorMessage } from '../../lib/api';
import { bridge } from '../../lib/bridge';
import { currentView } from '../../lib/mainView';
import { playSound } from '../../lib/sfx';
import { useGuild } from '../../stores/guild';
import { useSession } from '../../stores/session';
import { toast, useUi } from '../../stores/ui';
import { gateway } from '../gateway/gateway';

/** Sunucuya henüz ulaşmamış (pending) veya gönderilemeyen (failed) yerel mesajlar da listede tutulur. */
export type LocalMessage = Message & { status?: 'pending' | 'failed'; nonce?: string };

export interface ChannelMessages {
  messages: LocalMessage[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
}

interface MessagesStore {
  channels: Record<string, ChannelMessages>;
  /** Kanal → kullanıcı → "yazıyor" göstergesinin bitiş zamanı */
  typing: Record<string, Record<string, number>>;
  /** Kanal → okunmamış bahsetme sayısı (bu oturumda gelenler) */
  mentionCounts: Record<string, number>;
  /** Düzenlenmekte olan mesaj */
  editingId: string | null;
}

const initialState = (): MessagesStore => ({ channels: {}, typing: {}, mentionCounts: {}, editingId: null });

export const useMessages = create<MessagesStore>()(initialState);

export const setEditing = (editingId: string | null): void => useMessages.setState({ editingId });

// Oturum değişince (çıkış / başka hesap) tüm mesaj önbelleği temizlenir.
useSession.subscribe((s, prev) => {
  if (s.token !== prev.token) useMessages.setState(initialState());
});

const EMPTY: ChannelMessages = { messages: [], hasMore: true, loading: false, loaded: false };

function patch(channelId: string, fn: (c: ChannelMessages) => Partial<ChannelMessages>): void {
  useMessages.setState((s) => {
    const current = s.channels[channelId] ?? EMPTY;
    return { channels: { ...s.channels, [channelId]: { ...current, ...fn(current) } } };
  });
}

/** Onaylı mesajlar kimliğe göre sıralı; bekleyen/başarısız yerel mesajlar sonda. */
function merge(existing: LocalMessage[], incoming: Message[]): LocalMessage[] {
  const byId = new Map<string, LocalMessage>();
  for (const m of existing) if (!m.status) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  const confirmed = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
  return [...confirmed, ...existing.filter((m) => m.status)];
}

const selfId = (): string | undefined => useSession.getState().user?.id;

// ---------- Yükleme ----------

export async function loadInitial(channelId: string): Promise<void> {
  const current = useMessages.getState().channels[channelId];
  if (current?.loaded || current?.loading) return;
  patch(channelId, () => ({ loading: true }));
  try {
    const page = await api.listMessages(channelId);
    patch(channelId, (c) => ({
      messages: merge(c.messages, page),
      hasMore: page.length >= MESSAGE_PAGE_SIZE,
      loading: false,
      loaded: true,
    }));
  } catch (err) {
    patch(channelId, () => ({ loading: false }));
    toast(errorMessage(err), 'error');
  }
}

export async function loadOlder(channelId: string): Promise<void> {
  const current = useMessages.getState().channels[channelId];
  if (!current || current.loading || !current.hasMore) return;
  const oldest = current.messages.find((m) => !m.status);
  if (!oldest) return;
  patch(channelId, () => ({ loading: true }));
  try {
    const page = await api.listMessages(channelId, oldest.id);
    patch(channelId, (c) => ({
      messages: merge(c.messages, page),
      hasMore: page.length >= MESSAGE_PAGE_SIZE,
      loading: false,
    }));
  } catch (err) {
    patch(channelId, () => ({ loading: false }));
    toast(errorMessage(err), 'error');
  }
}

// ---------- Gönderme / düzenleme / silme ----------

let nonceCounter = 0;

export function sendMessage(channelId: string, content: string): void {
  const authorId = selfId();
  if (!authorId) return;
  const nonce = `yerel-${Date.now()}-${++nonceCounter}`;
  const pending: LocalMessage = {
    id: nonce,
    channelId,
    authorId,
    content,
    createdAt: Date.now(),
    editedAt: null,
    status: 'pending',
    nonce,
  };
  patch(channelId, (c) => ({ messages: [...c.messages, pending] }));
  // Gönderilen mesaj karşı tarafta "yazıyor"u kapatır; hemen yeniden yazmaya başlanırsa tekrar bildirilsin
  lastTypingSent.delete(channelId);
  void deliver(channelId, pending);
}

async function deliver(channelId: string, pending: LocalMessage): Promise<void> {
  try {
    const message = await api.sendMessage(channelId, pending.content);
    patch(channelId, (c) => ({
      messages: merge(
        c.messages.filter((m) => m.nonce !== pending.nonce),
        [message],
      ),
    }));
    useGuild.getState().markRead(channelId, message.id);
  } catch (err) {
    patch(channelId, (c) => ({
      messages: c.messages.map((m) => (m.nonce === pending.nonce ? { ...m, status: 'failed' as const } : m)),
    }));
    toast(errorMessage(err), 'error');
  }
}

export function retryMessage(channelId: string, nonce: string): void {
  const failed = useMessages.getState().channels[channelId]?.messages.find((m) => m.nonce === nonce);
  if (!failed) return;
  patch(channelId, (c) => ({
    messages: c.messages.map((m) => (m.nonce === nonce ? { ...m, status: 'pending' as const } : m)),
  }));
  void deliver(channelId, { ...failed, status: 'pending' });
}

export function discardMessage(channelId: string, nonce: string): void {
  patch(channelId, (c) => ({ messages: c.messages.filter((m) => m.nonce !== nonce) }));
}

export async function editMessage(message: Message, content: string): Promise<void> {
  try {
    const updated = await api.updateMessage(message.id, content);
    patch(message.channelId, (c) => ({ messages: c.messages.map((m) => (m.id === updated.id ? updated : m)) }));
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

export async function deleteMessage(message: Message): Promise<void> {
  try {
    await api.deleteMessage(message.id);
    removeLocal(message.channelId, message.id);
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

function removeLocal(channelId: string, id: string): void {
  patch(channelId, (c) => ({ messages: c.messages.filter((m) => m.id !== id) }));
  // Silinen mesaj kanalın son mesajıysa okunmamış göstergesini yüklü listeye göre düzelt
  const guild = useGuild.getState();
  const channel = useMessages.getState().channels[channelId];
  if (guild.lastMessageIds[channelId] === id && channel?.loaded) {
    const last = [...channel.messages].reverse().find((m) => !m.status);
    guild.setLastMessageId(channelId, last?.id ?? null);
  }
}

// ---------- Okundu bilgisi ----------

const ackTimers = new Map<string, number>();

/** Kanaldaki en son mesajı okundu olarak işaretler (sunucuya kısa bir gecikmeyle bildirir). */
export function ackChannel(channelId: string): void {
  if (useMessages.getState().mentionCounts[channelId]) {
    useMessages.setState((s) => {
      const { [channelId]: _cleared, ...mentionCounts } = s.mentionCounts;
      return { mentionCounts };
    });
  }
  const guild = useGuild.getState();
  const last = guild.lastMessageIds[channelId];
  if (!last || Number(last) <= Number(guild.readStates[channelId] ?? 0)) return;
  guild.markRead(channelId, last);
  window.clearTimeout(ackTimers.get(channelId));
  ackTimers.set(
    channelId,
    window.setTimeout(() => {
      ackTimers.delete(channelId);
      api.ack(channelId, last).catch(() => undefined);
    }, 500),
  );
}

// ---------- "Yazıyor…" ----------

const lastTypingSent = new Map<string, number>();

export function notifyTyping(channelId: string): void {
  const now = Date.now();
  if (now - (lastTypingSent.get(channelId) ?? 0) < TYPING_TIMEOUT_MS * 0.6) return;
  lastTypingSent.set(channelId, now);
  gateway.send({ t: 'TYPING_START', d: { channelId } });
}

function setTyping(channelId: string, userId: string, until: number | null): void {
  useMessages.setState((s) => {
    const channel = { ...(s.typing[channelId] ?? {}) };
    if (until) channel[userId] = until;
    else delete channel[userId];
    return { typing: { ...s.typing, [channelId]: channel } };
  });
}

// ---------- Bahsetmeler ----------

/** İçerikte bu kullanıcıdan bahsediliyor mu (sunucudaki sayımla aynı kural) */
export const mentions = (content: string, username: string): boolean => extractMentions(content).includes(username);

function notifyMention(message: Message): void {
  const guild = useGuild.getState();
  const view = currentView();
  const watching = view.kind === 'text' && view.channelId === message.channelId && document.hasFocus();
  if (watching) return;
  useMessages.setState((s) => ({
    mentionCounts: { ...s.mentionCounts, [message.channelId]: (s.mentionCounts[message.channelId] ?? 0) + 1 },
  }));
  playSound('mention');
  bridge?.requestAttention();
  const author = message.authorId ? guild.users[message.authorId]?.displayName : undefined;
  const channel = guild.channels.find((c) => c.id === message.channelId)?.name;
  try {
    const notification = new Notification(`${author ?? 'Biri'} senden bahsetti · #${channel ?? ''}`, {
      body: message.content.length > 140 ? `${message.content.slice(0, 140)}…` : message.content,
      silent: true,
    });
    notification.onclick = () => {
      bridge?.showWindow();
      useUi.getState().setView({ kind: 'text', channelId: message.channelId });
    };
  } catch {
    // bildirim izni yoksa yalnızca ses
  }
}

// ---------- Gateway olayları ----------

gateway.on((msg: GatewayServerMessage) => {
  switch (msg.t) {
    case 'MESSAGE_CREATE': {
      const m = msg.d;
      const me = useSession.getState().user;
      if (m.authorId) setTyping(m.channelId, m.authorId, null);
      if (useMessages.getState().channels[m.channelId]?.loaded) {
        patch(m.channelId, (c) => {
          // Kendi bekleyen mesajımızın onayı gateway'den önce geldiyse onu yerine koy
          const pendingIndex =
            m.authorId === me?.id ? c.messages.findIndex((x) => x.status === 'pending' && x.content === m.content) : -1;
          const rest = pendingIndex >= 0 ? c.messages.filter((_, i) => i !== pendingIndex) : c.messages;
          return { messages: merge(rest, [m]) };
        });
      }
      if (me && m.authorId !== me.id && mentions(m.content, me.username)) notifyMention(m);
      break;
    }
    case 'MESSAGE_UPDATE':
      patch(msg.d.channelId, (c) => ({ messages: c.messages.map((m) => (m.id === msg.d.id ? msg.d : m)) }));
      break;
    case 'MESSAGE_DELETE':
      removeLocal(msg.d.channelId, msg.d.id);
      break;
    case 'TYPING_START': {
      const { channelId, userId } = msg.d;
      const until = Date.now() + TYPING_TIMEOUT_MS;
      setTyping(channelId, userId, until);
      window.setTimeout(() => {
        if ((useMessages.getState().typing[channelId]?.[userId] ?? 0) <= Date.now()) setTyping(channelId, userId, null);
      }, TYPING_TIMEOUT_MS + 50);
      break;
    }
    case 'READY':
      useMessages.setState({ mentionCounts: msg.d.mentionCounts });
      // Yeniden bağlanınca yüklü kanalları tazele (kopukken gelen mesajlar kaçmasın)
      for (const channelId of Object.keys(useMessages.getState().channels)) {
        patch(channelId, () => ({ loaded: false }));
        void loadInitial(channelId);
      }
      break;
    case 'CHANNEL_DELETE':
      useMessages.setState((s) => {
        const { [msg.d.id]: _removed, ...channels } = s.channels;
        const { [msg.d.id]: _count, ...mentionCounts } = s.mentionCounts;
        return { channels, mentionCounts };
      });
      break;
  }
});
