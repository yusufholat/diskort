import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayServerMessage, GifResult, Message, ReadyPayload } from '@diskort/shared';
import {
  closeGifPicker,
  configureClient,
  fitBox,
  gateway,
  gifEmbed,
  gifOf,
  sendMessage,
  startReply,
  loadMoreGifs,
  openGifPicker,
  sendGif,
  searchGifs,
  setGifQuery,
  useFeatures,
  useGifPicker,
  useMessages,
  useSession,
  type LocalFile,
} from '../src';

const memory = new Map<string, string>();
const me = { id: 'u1', username: 'ayse', displayName: 'Ayşe', avatarColor: '#fff', isAdmin: false, roles: [], removed: false };

const receive = (msg: GatewayServerMessage): void =>
  (gateway as unknown as { handle: (m: GatewayServerMessage, t: string) => void }).handle(msg, 'jeton');

const gif: GifResult = {
  id: 'kedi1',
  url: 'https://giphy.com/gifs/komik-kedi-kedi1',
  title: 'Komik kedi',
  width: 480,
  height: 270,
  gif: 'https://media2.giphy.com/media/kedi1/giphy-downsized.gif',
  mp4: 'https://media2.giphy.com/media/kedi1/giphy.mp4',
  webp: null,
  still: null,
  preview: { gif: 'https://media2.giphy.com/media/kedi1/200w.gif', webp: null, mp4: null, width: 200, height: 113 },
};

beforeEach(async () => {
  memory.clear();
  await configureClient({
    platform: 'desktop',
    version: '9.9.9',
    storage: {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    },
    serverUrl: () => 'http://sunucu.test',
    notifyError: () => undefined,
  });
  useSession.getState().setSession('jeton', me);
  useMessages.setState({
    channels: { c1: { messages: [], hasMore: false, loading: false, loaded: true } },
    pendingFiles: {},
  });
});

describe('GIF', () => {
  it('READY sunucunun GIF desteğini bildirir; eski sunucuda kapalı', () => {
    const ready = { user: me, guild: { id: 'g', name: 'G', ownerId: null }, channels: [], users: [], roles: [], voiceStates: [], online: [], lastMessageIds: {}, readStates: {}, mentionCounts: {}, attachmentMaxBytes: 1 } as ReadyPayload;
    receive({ t: 'READY', d: { ...ready, features: { gifs: true } } });
    expect(useFeatures.getState().gifs).toBe(true);
    receive({ t: 'READY', d: ready });
    expect(useFeatures.getState().gifs).toBe(false);
  });

  it('seçilen GIF hemen gösterilir, metin ve dosyalar yazma kutusunda kalır; sunucu onayıyla yer değiştirir', async () => {
    const file: LocalFile = { name: 'a.txt', size: 1, type: 'text/plain' };
    useMessages.setState({ pendingFiles: { c1: [file] } });
    let resolve!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (resolve = r))));

    sendGif('c1', gif);
    const pending = useMessages.getState().channels.c1!.messages[0]!;
    expect(pending).toMatchObject({ content: gif.url, status: 'pending', embeds: [{ type: 'gif', id: 'kedi1', width: 480 }] });
    expect(gifOf(pending)?.mp4).toBe(gif.mp4);
    expect(useMessages.getState().pendingFiles.c1).toEqual([file]);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({ content: gif.url });

    const confirmed: Message = {
      id: '5',
      channelId: 'c1',
      authorId: 'u1',
      content: gif.url,
      createdAt: 1,
      editedAt: null,
      attachments: [],
      reactions: [],
      mentionEveryone: false,
      embeds: pending.embeds,
    };
    resolve(new Response(JSON.stringify(confirmed), { status: 201 }));
    await vi.waitFor(() => expect(useMessages.getState().channels.c1!.messages[0]!.id).toBe('5'));
    expect(useMessages.getState().channels.c1!.messages).toHaveLength(1);
  });

  it('GIF mesajına yanıt: bekleyen yanıtın özeti bağlantı değil "GIF"', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    const original: Message = {
      id: '9',
      channelId: 'c1',
      authorId: 'u2',
      content: gif.url,
      createdAt: 1,
      editedAt: null,
      attachments: [],
      reactions: [],
      mentionEveryone: false,
      embeds: [gifEmbed(gif)],
    };
    useMessages.setState({ channels: { c1: { messages: [original], hasMore: false, loading: false, loaded: true } } });
    startReply(original);
    sendMessage('c1', 'çok iyi');
    expect(useMessages.getState().channels.c1!.messages.at(-1)!.referencedMessage).toMatchObject({ id: '9', content: 'GIF' });
  });

  it('yalnızca GIPHY medyası gösterilir; arama adresi kodlanır', async () => {
    const embed = { ...gif, type: 'gif' as const, provider: 'giphy' as const };
    expect(gifOf({ embeds: [embed] })).not.toBeNull();
    expect(gifOf({ embeds: [{ ...embed, gif: 'https://evil.example/x.gif' }] })).toBeNull();
    expect(gifOf({ embeds: [{ ...embed, gif: 'http://media.giphy.com/x.gif' }] })).toBeNull();
    expect(gifOf({})).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ results: [], next: null })));
    await searchGifs('kedi & köpek', 24);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('http://sunucu.test/api/gifs/search?q=kedi%20%26%20k%C3%B6pek&offset=24');
  });

  it('seçici: açılınca popüler, yazınca gecikmeli arama (eski yanıt yok sayılır), sonraki sayfa eklenir', async () => {
    const page = (ids: string[], next: number | null) => ({ results: ids.map((id) => ({ ...gif, id })), next });
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url.replace('http://sunucu.test', ''));
        if (url.includes('trending')) return Response.json(page(['p1', 'p2'], 2));
        if (url.includes('offset=2')) return Response.json(page(['k2', 'k3'], null));
        return Response.json(page(['k1', 'k2'], 2));
      }),
    );
    openGifPicker();
    await vi.waitFor(() => expect(useGifPicker.getState().results.map((r) => r.id)).toEqual(['p1', 'p2']));
    expect(urls).toEqual(['/api/gifs/trending']);

    setGifQuery('k');
    setGifQuery('ke');
    setGifQuery('kedi ');
    expect(useGifPicker.getState()).toMatchObject({ query: 'kedi ', loading: true });
    await vi.waitFor(() => expect(useGifPicker.getState().results.map((r) => r.id)).toEqual(['k1', 'k2']));
    // Yazarken her tuşta değil, durunca bir kez aranır
    expect(urls).toEqual(['/api/gifs/trending', '/api/gifs/search?q=kedi']);

    loadMoreGifs();
    await vi.waitFor(() => expect(useGifPicker.getState().loadingMore).toBe(false));
    expect(useGifPicker.getState()).toMatchObject({ next: null });
    expect(useGifPicker.getState().results.map((r) => r.id)).toEqual(['k1', 'k2', 'k3']);
    loadMoreGifs(); // son sayfa: istek yok
    expect(urls).toHaveLength(3);

    // Yeniden açılınca popüler GIF'ler önbellekten, istek yok
    closeGifPicker();
    openGifPicker();
    expect(useGifPicker.getState()).toMatchObject({ query: '', loading: false });
    expect(useGifPicker.getState().results.map((r) => r.id)).toEqual(['p1', 'p2']);
    expect(urls).toHaveLength(3);
  });

  it('kutu boyutu en-boy oranını korur', () => {
    expect(fitBox(480, 270, { width: 400, height: 300 })).toEqual({ width: 400, height: 225 });
    expect(fitBox(100, 1000, { width: 400, height: 300 })).toEqual({ width: 30, height: 300 });
    expect(fitBox(100, 50, { width: 400, height: 300 })).toEqual({ width: 100, height: 50 });
    expect(fitBox(null, 50, { width: 400, height: 300 })).toBeNull();
  });
});
