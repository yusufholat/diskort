import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayServerMessage, Message } from '@diskort/shared';
import { configureClient, gateway, sendMessage, useGuild, useMessages, useSession, type KeyValueStorage } from '../src';

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
