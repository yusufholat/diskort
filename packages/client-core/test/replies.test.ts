import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayServerMessage, Message } from '@diskort/shared';
import {
  cancelReply,
  clearJump,
  configureClient,
  gateway,
  insertText,
  isMentioned,
  jumpToMessage,
  mentionInComposer,
  plainText,
  registerComposer,
  retryMessage,
  sendMessage,
  setReplyMention,
  startReply,
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

const me = { id: 'u1', username: 'ayse', displayName: 'Ayşe', avatarColor: '#fff', isAdmin: false, roles: [], removed: false };

const message = (id: string, content: string, authorId = 'u2', extra: Partial<Message> = {}): Message => ({
  id,
  channelId: 'c1',
  authorId,
  content,
  createdAt: Date.now(),
  editedAt: null,
  attachments: [],
  reactions: [],
  mentionEveryone: false,
  ...extra,
});

const receive = (msg: GatewayServerMessage): void =>
  (gateway as unknown as { handle: (m: GatewayServerMessage, t: string) => void }).handle(msg, 'jeton');

const messages = () => useMessages.getState().channels.c1!.messages;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(async () => {
  errors.length = 0;
  mentioned.length = 0;
  await configureClient({
    platform: 'desktop',
    version: '9.9.9',
    storage,
    serverUrl: () => 'http://sunucu.test',
    notifyError: (m) => errors.push(m),
    isViewingChannel: () => false,
    onMention: (m) => mentioned.push(m),
  });
  useSession.getState().setSession('jeton', me);
  useMessages.setState({
    channels: { c1: { messages: [message('5', 'asıl mesaj')], hasMore: false, loading: false, loaded: true } },
    pendingFiles: {},
    replies: {},
    jump: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('yanıt verme', () => {
  it('yanıt yazma kutusuna odaklanır, gönderilen mesaj yanıt olur ve yanıt kutusu kapanır', async () => {
    const focus = vi.fn();
    const unregister = registerComposer('c1', { focus, insert: vi.fn() });
    startReply(messages()[0]!);
    expect(useMessages.getState().replies.c1).toEqual({ messageId: '5', authorId: 'u2', mention: true });
    expect(focus).toHaveBeenCalledOnce();
    unregister();

    let resolve!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    sendMessage('c1', 'katılıyorum');
    expect(useMessages.getState().replies.c1).toBeUndefined();
    // Bekleyen mesaj alıntıyı hemen gösterir
    expect(messages()[1]).toMatchObject({
      status: 'pending',
      replyToId: '5',
      replyMentionUserId: 'u2',
      referencedMessage: { id: '5', authorId: 'u2', content: 'asıl mesaj', hasAttachments: false },
    });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({ content: 'katılıyorum', replyToId: '5', replyMention: true });

    resolve(json(message('6', 'katılıyorum', 'u1', { replyToId: '5', replyMentionUserId: 'u2' }), 201));
    await vi.waitFor(() => expect(messages()[1]!.status).toBeUndefined());
    expect(messages().map((m) => m.id)).toEqual(['5', '6']);
  });

  it('@ KAPALI yanıt bildirimsiz gider; vazgeçilen yanıt gönderilmez', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(message('6', 'x', 'u1'), 201)));
    startReply(messages()[0]!);
    setReplyMention('c1', false);
    sendMessage('c1', 'sessiz');
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({
      content: 'sessiz',
      replyToId: '5',
      replyMention: false,
    });

    startReply(messages()[0]!);
    cancelReply('c1');
    sendMessage('c1', 'normal');
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string)).toEqual({ content: 'normal' });
  });

  it('asıl mesaj bu arada silindiyse yeniden denemede normal mesaj olarak gider', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'invalid_reply', message: 'Yanıt verilen mesaj bulunamadı.' }, 400)),
    );
    startReply(messages()[0]!);
    sendMessage('c1', 'geç kaldım');
    await vi.waitFor(() => expect(messages()[1]!.status).toBe('failed'));
    expect(messages()[1]).toMatchObject({ replyToId: null, referencedMessage: null });

    vi.stubGlobal('fetch', vi.fn(async () => json(message('7', 'geç kaldım', 'u1'), 201)));
    retryMessage('c1', messages()[1]!.nonce!);
    await vi.waitFor(() => expect(messages()[1]!.status).toBeUndefined());
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({ content: 'geç kaldım' });
  });
});

describe('ekrandaki yanıtların özeti', () => {
  beforeEach(() => {
    receive({
      t: 'MESSAGE_CREATE',
      d: message('6', 'cevap', 'u3', {
        replyToId: '5',
        referencedMessage: { id: '5', authorId: 'u2', content: 'asıl mesaj', hasAttachments: false },
      }),
    });
  });

  it('asıl mesaj düzenlenince yanıtların alıntısı da güncellenir', () => {
    const { reactions: _r, ...update } = message('5', 'düzeltilmiş asıl', 'u2', { editedAt: 1 });
    receive({ t: 'MESSAGE_UPDATE', d: update });
    expect(messages()[1]!.referencedMessage).toEqual({
      id: '5',
      authorId: 'u2',
      content: 'düzeltilmiş asıl',
      hasAttachments: false,
    });
  });

  it('asıl mesaj silinince yanıt kalır, alıntısı "silindi" olur; ona yazılan yanıt iptal olur', () => {
    startReply(messages()[0]!);
    receive({ t: 'MESSAGE_DELETE', d: { id: '5', channelId: 'c1' } });
    expect(messages()).toMatchObject([{ id: '6', replyToId: '5', referencedMessage: null }]);
    expect(useMessages.getState().replies.c1).toBeUndefined();
  });
});

describe('yanıt bildirimi', () => {
  it('bildirimli yanıt asıl yazar için bahsetmedir', () => {
    receive({ t: 'MESSAGE_CREATE', d: message('8', 'cevap', 'u2', { replyToId: '5', replyMentionUserId: 'u1' }) });
    receive({ t: 'MESSAGE_CREATE', d: message('9', 'cevap', 'u2', { replyToId: '5', replyMentionUserId: null }) });
    expect(mentioned.map((m) => m.id)).toEqual(['8']);
    expect(useMessages.getState().mentionCounts.c1).toBe(1);
    expect(isMentioned(message('10', 'x', 'u1', { replyMentionUserId: 'u1' }), me)).toBe(false);
  });
});

describe('asıl mesaja atlama', () => {
  const page = (from: number, to: number): Message[] => {
    const list: Message[] = [];
    for (let id = from; id <= to; id++) list.push(message(String(id), `m${id}`));
    return list;
  };

  it('yüklü mesaja hemen atlanır', async () => {
    expect(await jumpToMessage('c1', '5')).toBe(true);
    const jump = useMessages.getState().jump!;
    expect(jump).toMatchObject({ channelId: 'c1', messageId: '5' });
    clearJump(jump.seq);
    expect(useMessages.getState().jump).toBeNull();
  });

  it('yüklü değilse geçmiş, mesaj gelene kadar geriye doğru yüklenir', async () => {
    useMessages.setState({
      channels: { c1: { messages: page(300, 349), hasMore: true, loading: false, loaded: true } },
    });
    const fetchMock = vi.fn(async (url: string) => {
      const before = Number(new URL(url).searchParams.get('before'));
      expect(new URL(url).searchParams.get('limit')).toBe('100');
      return json(page(Math.max(1, before - 100), before - 1));
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await jumpToMessage('c1', '150')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(messages()[0]!.id).toBe('100');
    expect(useMessages.getState().jump).toMatchObject({ messageId: '150' });
  });

  it('silinmiş mesaj bulunamaz, hata gösterilir', async () => {
    useMessages.setState({
      channels: { c1: { messages: [message('3', 'a'), message('7', 'b')], hasMore: false, loading: false, loaded: true } },
    });
    expect(await jumpToMessage('c1', '5')).toBe(false);
    expect(errors).toHaveLength(1);
    expect(useMessages.getState().jump).toBeNull();
  });
});

describe('yazma kutusu', () => {
  it('bahsetme imlecin olduğu yere, önceki sözcüğe yapışmadan eklenir', () => {
    expect(insertText('', 0, 0, '@ali ')).toEqual({ value: '@ali ', caret: 5 });
    expect(insertText('selam', 5, 5, '@ali ')).toEqual({ value: 'selam @ali ', caret: 11 });
    expect(insertText('selam dünya', 6, 6, '@ali ')).toEqual({ value: 'selam @ali dünya', caret: 11 });
    expect(insertText('a b', 1, 1, '@ali ')).toEqual({ value: 'a @ali b', caret: 7 });
    expect(insertText('seçili metin', 0, 6, '@ali ')).toEqual({ value: '@ali metin', caret: 5 });
  });

  it('bahsetme ekranda açık olan kanalın yazma kutusuna gider', () => {
    const insert = vi.fn();
    expect(mentionInComposer('c1', 'ali')).toBe(false);
    const unregister = registerComposer('c1', { focus: vi.fn(), insert });
    expect(mentionInComposer('c2', 'ali')).toBe(false);
    expect(mentionInComposer('c1', 'ali')).toBe(true);
    expect(insert).toHaveBeenCalledWith('@ali ');
    unregister();
  });

  it('alıntı özeti tek satırlık düz metindir', () => {
    const names: Record<string, string> = { ali: 'Ali Veli' };
    expect(plainText('**selam** @ali\n> alıntı ||gizli|| `kod`', (u) => names[u])).toBe(
      'selam @Ali Veli alıntı ▒▒▒▒ kod',
    );
    expect(plainText('@yok burada\n```js\nx = 1\n```', (u) => names[u])).toBe('@yok burada x = 1');
  });
});
