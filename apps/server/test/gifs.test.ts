import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CLIENT_FEATURE_DM, type GifPage, type Message } from '@diskort/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { giphyIdFromLink, GifService, normalizeGif } from '../src/gifs.js';
import { auth, connectGateway, FakeLiveKit } from './helpers.js';

/** GIPHY yanıtındaki bir GIF (alanlar gerçek API'deki gibi; boyutlar metin) */
function giphyGif(id: string, overrides: Record<string, unknown> = {}) {
  const base = `https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/${id}`;
  return {
    type: 'gif',
    id,
    url: `https://giphy.com/gifs/komik-kedi-${id}`,
    title: `Komik kedi ${id}`,
    images: {
      original: {
        url: `${base}/giphy.gif?cid=abc&rid=giphy.gif&ct=g`,
        width: '480',
        height: '270',
        mp4: `${base}/giphy.mp4?cid=abc&rid=giphy.mp4&ct=g`,
        webp: `${base}/giphy.webp?cid=abc&rid=giphy.webp&ct=g`,
      },
      downsized: { url: `${base}/giphy-downsized.gif?cid=abc`, width: '480', height: '270' },
      fixed_width: {
        url: `${base}/200w.gif?cid=abc`,
        width: '200',
        height: '113',
        webp: `${base}/200w.webp?cid=abc`,
        mp4: `${base}/200w.mp4?cid=abc`,
      },
      original_still: { url: `${base}/giphy_s.gif?cid=abc` },
    },
    ...overrides,
  };
}

interface FakeGiphy {
  fetch: typeof fetch;
  calls: URL[];
  /** Sıradaki yanıtın durum kodu (verilmezse 200) */
  status: number;
  data: Record<string, unknown>[];
  total: number;
  byId: Record<string, Record<string, unknown>>;
}

function fakeGiphy(): FakeGiphy {
  const fake: FakeGiphy = {
    calls: [],
    status: 200,
    data: [giphyGif('kedi1'), giphyGif('kedi2')],
    total: 100,
    byId: {},
    fetch: (async (input: string | URL) => {
      const url = new URL(String(input));
      fake.calls.push(url);
      if (fake.status !== 200) {
        return new Response(JSON.stringify({ data: [], meta: { status: fake.status, msg: 'hata' } }), { status: fake.status });
      }
      const single = /^\/v1\/gifs\/([A-Za-z0-9]+)$/.exec(url.pathname)?.[1];
      if (single && single !== 'search' && single !== 'trending') {
        const gif = fake.byId[single];
        return gif
          ? Response.json({ data: gif, meta: { status: 200 } })
          : new Response(JSON.stringify({ data: {}, meta: { status: 404 } }), { status: 404 });
      }
      const offset = Number(url.searchParams.get('offset'));
      return Response.json({
        data: fake.data,
        pagination: { total_count: fake.total, count: fake.data.length, offset },
        meta: { status: 200, msg: 'OK' },
      });
    }) as typeof fetch,
  };
  return fake;
}

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function setup(env: Record<string, string> = { GIPHY_API_KEY: 'deneme-anahtari' }) {
  const giphy = fakeGiphy();
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: '.', ...env });
  const built = await buildApp(config, { dbFile: ':memory:', logger: false, livekit: new FakeLiveKit(), gifFetch: giphy.fetch });
  app = built.app;
  const ctx: AppContext = built.ctx;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { inviteCode: ctx.store.ensureBootstrapInvite()!.code, username: 'sahip', password: 'sifre12345' },
  });
  const token = (res.json() as { token: string }).token;
  const text = ctx.store.listChannels(ctx.guild.id).find((c) => c.type === 'text')!;
  const get = (url: string) => app!.inject({ method: 'GET', url, headers: auth(token) });
  const send = (content: string) =>
    app!.inject({ method: 'POST', url: `/api/channels/${text.id}/messages`, headers: auth(token), payload: { content } });
  return { giphy, ctx, token, text, get, send };
}

describe('GIF araması (GIPHY vekili)', () => {
  it('anahtar yoksa kapalıdır: READY bildirir, uç noktalar 404, bağlantı düz metin kalır', async () => {
    const { get, send, giphy, token } = await setup({});
    for (const url of ['/api/gifs/trending', '/api/gifs/search?q=kedi']) {
      const res = await get(url);
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('gifs_disabled');
    }
    const message = (await send('https://giphy.com/gifs/komik-kedi-kedi1')).json() as Message;
    expect(message.embeds).toEqual([]);
    expect(giphy.calls).toHaveLength(0);

    await app!.listen({ port: 0, host: '127.0.0.1' });
    const client = await connectGateway(app!, token);
    expect(client.ready.features).toEqual({ gifs: false });
    client.ws.close();
  });

  it('oturum ister; READY açık olduğunu bildirir', async () => {
    const { token } = await setup();
    expect((await app!.inject({ method: 'GET', url: '/api/gifs/trending' })).statusCode).toBe(401);
    await app!.listen({ port: 0, host: '127.0.0.1' });
    const client = await connectGateway(app!, token);
    expect(client.ready.features).toEqual({ gifs: true });
    client.ws.close();
  });

  it('popüler ve arama: GIPHY parametreleri, sadeleştirilmiş sonuçlar, sonraki sayfa', async () => {
    const { get, giphy } = await setup();
    const trending = await get('/api/gifs/trending');
    expect(trending.statusCode).toBe(200);
    const page = trending.json() as GifPage;
    expect(page.next).toBe(2);
    expect(page.results).toHaveLength(2);
    expect(page.results[0]).toEqual({
      id: 'kedi1',
      url: 'https://giphy.com/gifs/komik-kedi-kedi1',
      title: 'Komik kedi kedi1',
      width: 480,
      height: 270,
      gif: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/kedi1/giphy-downsized.gif?cid=abc',
      mp4: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/kedi1/giphy.mp4?cid=abc&rid=giphy.mp4&ct=g',
      webp: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/kedi1/giphy.webp?cid=abc&rid=giphy.webp&ct=g',
      still: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/kedi1/giphy_s.gif?cid=abc',
      preview: {
        gif: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/kedi1/200w.gif?cid=abc',
        webp: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/kedi1/200w.webp?cid=abc',
        mp4: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/kedi1/200w.mp4?cid=abc',
        width: 200,
        height: 113,
      },
    });
    const call = giphy.calls[0]!;
    expect(call.origin + call.pathname).toBe('https://api.giphy.com/v1/gifs/trending');
    expect(Object.fromEntries(call.searchParams)).toEqual({ api_key: 'deneme-anahtari', limit: '24', offset: '0', rating: 'pg-13' });

    const search = await get(`/api/gifs/search?q=${encodeURIComponent('  Komik   KEDİ ')}&offset=24`);
    expect(search.statusCode).toBe(200);
    const params = giphy.calls[1]!.searchParams;
    expect(giphy.calls[1]!.pathname).toBe('/v1/gifs/search');
    expect(params.get('q')).toBe('komik kedi');
    expect(params.get('lang')).toBe('tr');
    expect(params.get('rating')).toBe('pg-13');
    expect(params.get('offset')).toBe('24');
    // Son sayfa
    giphy.total = 26;
    expect(((await get('/api/gifs/search?q=son&offset=24')).json() as GifPage).next).toBeNull();

    expect((await get('/api/gifs/search?q=%20%20')).statusCode).toBe(400);
    expect((await get('/api/gifs/search')).statusCode).toBe(400);
    expect((await get('/api/gifs/trending?offset=-1')).statusCode).toBe(400);
    expect((await get('/api/gifs/trending?offset=99999')).statusCode).toBe(400);
  });

  it('GIPHY dışındaki ya da https olmayan medya adresleri ve eksik GIF\'ler ayıklanır', async () => {
    const { get, giphy } = await setup();
    const evil = giphyGif('kotu1');
    evil.images.downsized.url = 'https://evil.example.com/x.gif';
    evil.images.original.url = 'http://media.giphy.com/media/kotu1/giphy.gif';
    const noSize = giphyGif('boyutsuz');
    noSize.images.original.width = '0';
    const sneaky = giphyGif('sinsi1');
    sneaky.images.original.mp4 = 'https://media.giphy.com.evil.example/x.mp4';
    sneaky.url = 'javascript:alert(1)';
    giphy.data = [evil, noSize, sneaky, { id: '../../x', images: {} }, giphyGif('kedi1'), giphyGif('kedi1')];
    const page = (await get('/api/gifs/trending')).json() as GifPage;
    expect(page.results.map((r) => r.id)).toEqual(['sinsi1', 'kedi1']);
    expect(page.results[0]!.mp4).toBeNull();
    expect(page.results[0]!.url).toBe('https://giphy.com/gifs/sinsi1');
  });

  it('yanıtlar önbellekte tutulur: aynı arama GIPHY\'ye bir kez gider', async () => {
    const { get, giphy } = await setup();
    await Promise.all([get('/api/gifs/search?q=kedi'), get('/api/gifs/search?q=kedi')]);
    await get('/api/gifs/search?q=KEDİ');
    await get('/api/gifs/search?q=%20kedi%20');
    expect(giphy.calls).toHaveLength(1);
    await get('/api/gifs/search?q=kedi&offset=24');
    await get('/api/gifs/search?q=köpek');
    await get('/api/gifs/trending');
    await get('/api/gifs/trending');
    expect(giphy.calls).toHaveLength(4);

    // Hatalı yanıt önbelleğe girmez
    giphy.status = 500;
    expect((await get('/api/gifs/search?q=kus')).statusCode).toBe(502);
    giphy.status = 200;
    expect((await get('/api/gifs/search?q=kus')).statusCode).toBe(200);
  });

  it('önbellek süresi dolunca yeniden sorulur', async () => {
    const giphy = fakeGiphy();
    let now = 1_000_000;
    const service = new GifService({ apiKey: 'k', rating: 'g', lang: 'tr' }, giphy.fetch, undefined, () => now);
    await service.search('kedi');
    await service.search('kedi');
    expect(giphy.calls).toHaveLength(1);
    expect(giphy.calls[0]!.searchParams.get('rating')).toBe('g');
    now += 5 * 60_000;
    await service.search('kedi');
    expect(giphy.calls).toHaveLength(2);
  });

  it('kullanıcı başına istek sınırı; GIPHY sınırı aşılınca bir süre yalnızca önbellek', async () => {
    const { get, giphy } = await setup();
    for (let i = 0; i < 30; i++) expect((await get(`/api/gifs/search?q=a${i}`)).statusCode).toBe(200);
    const limited = await get('/api/gifs/search?q=son');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe('rate_limited');

    const service = new GifService({ apiKey: 'k', rating: 'pg-13', lang: 'tr' }, giphy.fetch);
    await service.trending();
    giphy.status = 429;
    await expect(service.search('x')).rejects.toMatchObject({ status: 503, code: 'gifs_busy' });
    giphy.status = 200;
    const before = giphy.calls.length;
    // Bekleme süresinde GIPHY'ye gidilmez, önbellekteki sayfa yine verilir
    await expect(service.search('y')).rejects.toMatchObject({ code: 'gifs_busy' });
    await expect(service.trending()).resolves.toMatchObject({ next: 2 });
    expect(giphy.calls.length).toBe(before);
  });

  it('reddedilen anahtar: 503, kullanıcıya anlaşılır mesaj', async () => {
    const { get, giphy } = await setup();
    giphy.status = 401;
    const res = await get('/api/gifs/trending');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'gifs_unavailable', message: 'GIF araması şu an kullanılamıyor.' });
  });
});

describe('mesajdaki GIF', () => {
  it('seçiciden gönderilen GIF: metin GIPHY bağlantısı, gömülü bilgiler önbellekten (GIPHY\'ye sorulmaz)', async () => {
    const { get, send, giphy, token, text } = await setup();
    await app!.listen({ port: 0, host: '127.0.0.1' });
    const client = await connectGateway(app!, token);
    const picked = ((await get('/api/gifs/trending')).json() as GifPage).results[0]!;
    const calls = giphy.calls.length;

    const res = await send(picked.url);
    expect(res.statusCode).toBe(201);
    const message = res.json() as Message;
    const { preview: _preview, ...shown } = picked;
    expect(message.content).toBe('https://giphy.com/gifs/komik-kedi-kedi1');
    expect(message.embeds).toEqual([{ type: 'gif', provider: 'giphy', ...shown }]);
    expect(giphy.calls.length).toBe(calls);

    await client.settle();
    expect(client.of('MESSAGE_CREATE')[0]!.embeds).toEqual(message.embeds);
    const listed = (await get(`/api/channels/${text.id}/messages`)).json() as Message[];
    expect(listed.at(-1)!.embeds).toEqual(message.embeds);
    client.ws.close();
  });

  it('yapıştırılan bağlantı GIPHY\'den sorulur; metinli ya da tanınmayan bağlantıya GIF eklenmez', async () => {
    const { send, giphy } = await setup();
    giphy.byId.yapis1 = giphyGif('yapis1');
    const pasted = (await send('https://media3.giphy.com/media/v1.Y2lk/yapis1/giphy.gif')).json() as Message;
    expect(pasted.embeds).toMatchObject([{ id: 'yapis1', width: 480, height: 270 }]);
    expect(giphy.calls.map((c) => c.pathname)).toEqual(['/v1/gifs/yapis1']);

    // İkinci kez sorulmaz; bulunamayan kimlik de bir süre yeniden sorulmaz
    await send('https://giphy.com/gifs/yapis1');
    expect(((await send('https://giphy.com/gifs/yok123')).json() as Message).embeds).toEqual([]);
    await send('https://giphy.com/gifs/baska-yok123');
    expect(giphy.calls.map((c) => c.pathname)).toEqual(['/v1/gifs/yapis1', '/v1/gifs/yok123']);

    for (const content of [
      'bak https://giphy.com/gifs/yapis1',
      'https://giphy.com/gifs/yapis1 komik',
      'https://evil.example/gifs/yapis1',
      'https://giphy.com.evil.example/gifs/yapis1',
    ]) {
      expect(((await send(content)).json() as Message).embeds).toEqual([]);
    }
    expect(giphy.calls).toHaveLength(2);
  });

  it('düzenlenince GIF yeniden belirlenir', async () => {
    const { send, get, giphy, token } = await setup();
    giphy.byId.yapis1 = giphyGif('yapis1');
    await get('/api/gifs/trending');
    const message = (await send('https://giphy.com/gifs/komik-kedi-kedi1')).json() as Message;
    expect(message.embeds).toHaveLength(1);
    const edit = (content: string) =>
      app!.inject({ method: 'PATCH', url: `/api/messages/${message.id}`, headers: auth(token), payload: { content } });
    expect(((await edit('artık gif yok')).json() as Message).embeds).toEqual([]);
    expect(((await edit('https://giphy.com/gifs/yapis1')).json() as Message).embeds).toMatchObject([{ id: 'yapis1' }]);
  });

  it('direkt mesajda ve yanıtta GIF: gömülür, yanıt özeti "GIF", READY DM özelliğiyle birlikte gifs bildirir', async () => {
    const { get, token, ctx, text } = await setup();
    const code = (await app!.inject({ method: 'POST', url: '/api/invites', headers: auth(token), payload: {} })).json()
      .code as string;
    const veli = (
      await app!.inject({ method: 'POST', url: '/api/auth/register', payload: { inviteCode: code, username: 'veli', password: 'sifre12345' } })
    ).json() as { token: string; user: { id: string } };
    const picked = ((await get('/api/gifs/trending')).json() as GifPage).results[0]!;
    const dm = (
      await app!.inject({ method: 'POST', url: '/api/dms', headers: auth(token), payload: { userIds: [veli.user.id] } })
    ).json() as { id: string };

    const post = (tok: string, channelId: string, payload: Record<string, unknown>) =>
      app!.inject({ method: 'POST', url: `/api/channels/${channelId}/messages`, headers: auth(tok), payload });
    const inDm = (await post(token, dm.id, { content: picked.url })).json() as Message;
    expect(inDm.embeds).toMatchObject([{ type: 'gif', id: picked.id }]);
    // Karşı taraf GIF'e yanıt verir: özette bağlantı değil "GIF"
    const reply = (await post(veli.token, dm.id, { content: 'harika', replyToId: inDm.id })).json() as Message;
    expect(reply.referencedMessage).toMatchObject({ id: inDm.id, content: 'GIF' });
    const listed = (await app!.inject({ method: 'GET', url: `/api/channels/${dm.id}/messages`, headers: auth(veli.token) })).json() as Message[];
    expect(listed.map((m) => [m.embeds?.length, m.referencedMessage?.content ?? null])).toEqual([
      [1, null],
      [0, 'GIF'],
    ]);
    // Kanalda da aynı
    const inChannel = (await post(token, text.id, { content: picked.url })).json() as Message;
    const channelReply = (await post(veli.token, text.id, { content: 'x', replyToId: inChannel.id })).json() as Message;
    expect(channelReply.referencedMessage?.content).toBe('GIF');

    await app!.listen({ port: 0, host: '127.0.0.1' });
    const client = await connectGateway(app!, veli.token, [CLIENT_FEATURE_DM]);
    expect(client.ready.features).toEqual({ gifs: true });
    expect(client.ready.dms?.map((d) => d.id)).toEqual([dm.id]);
    client.ws.close();
    expect(ctx.gifs.enabled).toBe(true);
  });

  it('bağlantıdan kimlik çıkarma', () => {
    expect(giphyIdFromLink('https://giphy.com/gifs/cat-funny-3o7abKhOpu0NwenH3O')).toBe('3o7abKhOpu0NwenH3O');
    expect(giphyIdFromLink(' https://giphy.com/gifs/3o7abKhOpu0NwenH3O/ ')).toBe('3o7abKhOpu0NwenH3O');
    expect(giphyIdFromLink('https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif')).toBe('3o7abKhOpu0NwenH3O');
    expect(giphyIdFromLink('https://media4.giphy.com/media/v1.Y2lk_x-y=/3o7abKhOpu0NwenH3O/200w.webp?cid=1')).toBe(
      '3o7abKhOpu0NwenH3O',
    );
    expect(giphyIdFromLink('https://i.giphy.com/3o7abKhOpu0NwenH3O.gif')).toBe('3o7abKhOpu0NwenH3O');
    expect(giphyIdFromLink('https://i.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.webp')).toBe('3o7abKhOpu0NwenH3O');
    expect(giphyIdFromLink('https://giphy.com/embed/3o7abKhOpu0NwenH3O')).toBe('3o7abKhOpu0NwenH3O');
    expect(giphyIdFromLink('https://giphy.com/stickers/3o7abKhOpu0NwenH3O')).toBeNull();
    expect(giphyIdFromLink('https://gph.is/g/abc')).toBeNull();
    expect(giphyIdFromLink('merhaba')).toBeNull();
  });

  it('eksik medyalı GIF sadeleştirilemez', () => {
    expect(normalizeGif({ id: 'x1', images: { original: { width: '10', height: '10' } } })).toBeNull();
    expect(normalizeGif(giphyGif('tamam1'))).not.toBeNull();
  });
});
