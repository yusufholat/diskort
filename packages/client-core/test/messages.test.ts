import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayServerMessage, Message } from '@diskort/shared';
import {
  configureClient,
  EMOJI_CATEGORIES,
  gateway,
  sendMessage,
  toggleReaction,
  useGuild,
  useMessages,
  useSession,
  type KeyValueStorage,
} from '../src';

const memory = new Map<string, string>();
const storage: KeyValueStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

const errors: string[] = [];
const mentioned: Message[] = [];
let viewing: string | null = null;

const me = { id: 'u1', username: 'ayse', displayName: 'Ayşe', avatarColor: '#fff', isAdmin: false };

const message = (id: string, content: string, authorId = 'u2'): Message => ({
  id,
  channelId: 'c1',
  authorId,
  content,
  createdAt: Date.now(),
  editedAt: null,
  attachments: [],
  reactions: [],
});

/** Gateway'den mesaj gelmiş gibi yap */
const receive = (msg: GatewayServerMessage): void =>
  (gateway as unknown as { handle: (m: GatewayServerMessage, t: string) => void }).handle(msg, 'jeton');

beforeEach(async () => {
  memory.clear();
  errors.length = 0;
  mentioned.length = 0;
  viewing = null;
  await configureClient({
    platform: 'desktop',
    version: '9.9.9',
    storage,
    serverUrl: () => 'http://sunucu.test',
    notifyError: (m) => errors.push(m),
    isViewingChannel: (id) => id === viewing,
    onMention: (m) => mentioned.push(m),
  });
  useSession.getState().setSession('jeton', me);
  useMessages.setState({ channels: { c1: { messages: [], hasMore: false, loading: false, loaded: true } } });
});

describe('oturum', () => {
  it('platform deposuna yazılır ve yeniden yüklenir', async () => {
    expect(JSON.parse(memory.get('diskort-session')!).state.token).toBe('jeton');
    // Uygulama yeniden açılmış gibi: depodaki oturum okunur
    memory.set('diskort-session', JSON.stringify({ state: { token: 'yeni', user: { ...me, displayName: 'A' } }, version: 0 }));
    await useSession.persist.rehydrate();
    expect(useSession.getState()).toMatchObject({ token: 'yeni', user: { displayName: 'A' } });
  });
});

describe('mesaj gönderme', () => {
  it('bekleyen mesaj sunucu onayıyla yer değiştirir ve okundu sayılır', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    sendMessage('c1', 'selam');
    expect(useMessages.getState().channels.c1!.messages).toMatchObject([{ content: 'selam', status: 'pending' }]);

    resolve(new Response(JSON.stringify(message('7', 'selam', 'u1')), { status: 201 }));
    await vi.waitFor(() => expect(useMessages.getState().channels.c1!.messages[0]!.status).toBeUndefined());
    expect(useMessages.getState().channels.c1!.messages).toMatchObject([{ id: '7', content: 'selam' }]);
    expect(useGuild.getState().readStates.c1).toBe('7');
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('http://sunucu.test/api/channels/c1/messages');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer jeton');
  });

  it('gönderilemeyen mesaj başarısız işaretlenir ve hata platforma bildirilir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'rate_limited', message: 'Yavaşla.' }), { status: 429 })));
    sendMessage('c1', 'çok hızlı');
    await vi.waitFor(() => expect(useMessages.getState().channels.c1!.messages[0]!.status).toBe('failed'));
    expect(errors).toEqual(['Yavaşla.']);
  });
});

describe('gateway olayları', () => {
  it('bakılmayan kanaldaki bahsetme sayılır ve platforma iletilir; bakılan kanalda sayılmaz', () => {
    receive({ t: 'MESSAGE_CREATE', d: message('10', '@ayse bak') });
    expect(useMessages.getState().mentionCounts.c1).toBe(1);
    expect(mentioned.map((m) => m.id)).toEqual(['10']);

    viewing = 'c1';
    receive({ t: 'MESSAGE_CREATE', d: message('11', '@ayse tekrar') });
    expect(useMessages.getState().mentionCounts.c1).toBe(1);
    expect(useMessages.getState().channels.c1!.messages.map((m) => m.id)).toEqual(['10', '11']);
  });

  it('silinen ve düzenlenen mesajlar listeye yansır', () => {
    receive({ t: 'MESSAGE_CREATE', d: message('20', 'ilk') });
    receive({ t: 'MESSAGE_UPDATE', d: { ...message('20', 'düzeltildi'), editedAt: 1 } });
    expect(useMessages.getState().channels.c1!.messages[0]!.content).toBe('düzeltildi');
    receive({ t: 'MESSAGE_DELETE', d: { id: '20', channelId: 'c1' } });
    expect(useMessages.getState().channels.c1!.messages).toEqual([]);
  });
});

describe('tepkiler', () => {
  const reactions = () => useMessages.getState().channels.c1!.messages[0]!.reactions;
  const event = (t: 'MESSAGE_REACTION_ADD' | 'MESSAGE_REACTION_REMOVE', userId: string, emoji = '👍') =>
    receive({ t, d: { messageId: '30', channelId: 'c1', userId, emoji } });

  beforeEach(() => receive({ t: 'MESSAGE_CREATE', d: message('30', 'tepki ver') }));

  it('başkalarının tepkileri sayılır; sayı sıfıra inince tepki kalkar', () => {
    event('MESSAGE_REACTION_ADD', 'u2');
    event('MESSAGE_REACTION_ADD', 'u3');
    event('MESSAGE_REACTION_ADD', 'u2', '🔥');
    expect(reactions()).toEqual([
      { emoji: '👍', count: 2, me: false },
      { emoji: '🔥', count: 1, me: false },
    ]);
    event('MESSAGE_REACTION_REMOVE', 'u2');
    event('MESSAGE_REACTION_REMOVE', 'u3');
    expect(reactions()).toEqual([{ emoji: '🔥', count: 1, me: false }]);
  });

  it('kendi tepkimiz hemen görünür, gateway onayı iki kez saymaz; düzenleme tepkileri silmez', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    event('MESSAGE_REACTION_ADD', 'u2');
    await toggleReaction('c1', '30', '👍');
    expect(reactions()).toEqual([{ emoji: '👍', count: 2, me: true }]);
    event('MESSAGE_REACTION_ADD', 'u1'); // kendi olayımız
    expect(reactions()).toEqual([{ emoji: '👍', count: 2, me: true }]);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`http://sunucu.test/api/messages/30/reactions/${encodeURIComponent('👍')}`);
    expect(init!.method).toBe('PUT');

    const { reactions: _omit, ...update } = { ...message('30', 'düzeltildi'), editedAt: 2 };
    receive({ t: 'MESSAGE_UPDATE', d: update });
    expect(reactions()).toEqual([{ emoji: '👍', count: 2, me: true }]);

    await toggleReaction('c1', '30', '👍');
    expect(reactions()).toEqual([{ emoji: '👍', count: 1, me: false }]);
    expect(vi.mocked(fetch).mock.calls[1]![1]!.method).toBe('DELETE');
  });

  it('sunucu reddederse tepki geri alınır ve hata gösterilir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'rate_limited', message: 'Yavaşla.' }), { status: 429 })),
    );
    await toggleReaction('c1', '30', '🎉');
    expect(reactions()).toEqual([]);
    expect(errors).toEqual(['Yavaşla.']);
  });
});

describe('emoji listesi', () => {
  it('her emoji sunucunun kabul ettiği tek bir tam emojidir; kategori içinde tekrar yoktur', () => {
    const rgi = new RegExp('^\\p{RGI_Emoji}$', 'v');
    for (const category of EMOJI_CATEGORIES) {
      expect(category.emojis.filter((e) => !rgi.test(e))).toEqual([]);
      expect(new Set(category.emojis).size).toBe(category.emojis.length);
    }
  });
});
