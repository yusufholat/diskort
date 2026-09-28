import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { extractEmbedUrls, Permission as P, type LinkEmbed, type Message } from '@diskort/shared';
import { EmbedMediaService, type Fetcher } from '../src/embedMedia.js';
import { parseHtmlMeta, decodeHtml } from '../src/htmlMeta.js';
import { parseYoutubeTime, tweetOf, youtubeVideo } from '../src/linkPreviews.js';
import { FetchError, isBlockedAddress, readCapped, safeFetch, type SafeResponse } from '../src/safeFetch.js';
import { connectGateway, startServer, type TestServer } from './helpers.js';

// ---------- Bağlantıların bulunması ----------

describe('extractEmbedUrls', () => {
  it('metindeki bağlantıları sırayla ve tekrarsız bulur', () => {
    expect(extractEmbedUrls('bak https://a.com/x ve https://b.org. sonra https://a.com/x')).toEqual([
      'https://a.com/x',
      'https://b.org/',
    ]);
  });

  it('kod, satır içi kod, sürpriz ve <…> içindekileri atlar', () => {
    const text = [
      '```\nhttps://kod.com/a\n```',
      '`https://satir.com`',
      '||https://surpriz.com||',
      '<https://kapali.com/sayfa>',
      'https://acik.com/sayfa)',
    ].join(' ');
    expect(extractEmbedUrls(text)).toEqual(['https://acik.com/sayfa']);
  });

  it('en fazla 5 bağlantı; kullanıcı bilgili ve http(s) olmayanlar sayılmaz', () => {
    const many = Array.from({ length: 8 }, (_, i) => `https://s${i}.com`).join(' ');
    expect(extractEmbedUrls(many)).toHaveLength(5);
    expect(extractEmbedUrls('https://kullanici:sifre@site.com ftp://x.com javascript:alert(1)')).toEqual([]);
  });
});

// ---------- SSRF ----------

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    '2002:c0a8:0101::1',
    '2001:db8::1',
    '2001::1',
    '100::1',
    'bozuk',
  ])('%s engellenir', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808'])(
    '%s genel adrestir',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );
});

describe('safeFetch', () => {
  let server: http.Server;
  let port = 0;
  const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {
    '/ok': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<title>Merhaba</title>');
    },
    '/gzip': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync('<title>Sıkıştırılmış</title>'));
    },
    '/big': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('x'.repeat(10_000));
    },
    '/slow': () => undefined, // hiç yanıt vermez
    '/to-private': (_req, res) => {
      res.writeHead(302, { location: 'http://10.0.0.1/' });
      res.end();
    },
    '/to-evil-name': (_req, res) => {
      res.writeHead(301, { location: 'http://evil.example/' });
      res.end();
    },
    '/to-v6': (_req, res) => {
      res.writeHead(302, { location: 'http://[::1]/' });
      res.end();
    },
    '/to-port': (_req, res) => {
      res.writeHead(302, { location: 'http://good.example:22/' });
      res.end();
    },
    '/to-ok': (_req, res) => {
      res.writeHead(302, { location: '/ok' });
      res.end();
    },
    '/loop': (_req, res) => {
      res.writeHead(302, { location: '/loop' });
      res.end();
    },
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const route = routes[req.url ?? ''];
      if (route) route(req, res);
      else res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  /** good.example yerel test sunucusuna çözülür ve (yalnızca o) izinlidir; evil.example özel ağdadır */
  const opts = () => ({
    resolve: async (host: string) =>
      host === 'good.example' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '192.168.1.10', family: 4 }],
    isBlocked: (ip: string) => ip !== '127.0.0.1' && isBlockedAddress(ip),
    allowedPorts: [80, 443, port],
    timeoutMs: 1000,
  });
  const url = (p: string) => `http://good.example:${port}${p}`;
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (err: unknown) => (err instanceof FetchError ? err.code : String(err)));

  it('varsayılan ayarlarla özel adreslere, yerel adlara ve başka kapılara istek yapmaz', async () => {
    for (const target of [
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://10.0.0.5/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:127.0.0.1]/',
      'http://2130706433/',
      'http://0x7f.1/',
      'http://localhost/',
      'https://example.com:8443/',
      'file:///etc/passwd',
    ]) {
      expect(await code(safeFetch(target, { timeoutMs: 1000 })), target).toBe('blocked');
    }
  });

  it('özel adrese çözülen adı engeller', async () => {
    expect(await code(safeFetch('http://evil.example/', opts()))).toBe('blocked');
    // Adreslerden biri bile özelse
    const mixed = { ...opts(), resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }] };
    expect(await code(safeFetch('http://mixed.example/', mixed))).toBe('blocked');
  });

  it('izinli adresten okur, sıkıştırmayı çözer, göreli yönlendirmeyi izler', async () => {
    const res = await safeFetch(url('/to-ok'), opts());
    expect(res.url).toBe(url('/ok'));
    expect(res.contentType).toBe('text/html');
    expect(res.charset).toBe('utf-8');
    expect((await readCapped(res, 1000)).data.toString()).toBe('<title>Merhaba</title>');
    const gz = await safeFetch(url('/gzip'), opts());
    expect((await readCapped(gz, 1000)).data.toString()).toBe('<title>Sıkıştırılmış</title>');
  });

  it('özel ağa, IPv6 yerel adrese ve başka kapıya yönlendirmeyi engeller', async () => {
    expect(await code(safeFetch(url('/to-private'), opts()))).toBe('blocked');
    expect(await code(safeFetch(url('/to-evil-name'), opts()))).toBe('blocked');
    expect(await code(safeFetch(url('/to-v6'), opts()))).toBe('blocked');
    expect(await code(safeFetch(url('/to-port'), opts()))).toBe('blocked');
  });

  it('en fazla 5 yönlendirme, süre ve boyut sınırı', async () => {
    expect(await code(safeFetch(url('/loop'), opts()))).toBe('redirects');
    expect(await code(safeFetch(url('/slow'), { ...opts(), timeoutMs: 200 }))).toBe('timeout');
    const big = await safeFetch(url('/big'), opts());
    expect(await code(readCapped(big, 1000))).toBe('too_large');
    const cut = await readCapped(await safeFetch(url('/big'), opts()), 1000, true);
    expect(cut.truncated).toBe(true);
    expect(cut.data.length).toBe(1000);
  });
});

// ---------- Sayfa bilgileri ----------

describe('parseHtmlMeta', () => {
  it('OpenGraph bilgilerini okur, göreli resmi çözer, metni temizler', () => {
    const html = `<!doctype html><html><head>
      <meta charset="utf-8">
      <title>Yedek başlık</title>
      <meta property="og:title" content="Tom &amp; Jerry &#8212; &quot;Klasik&quot;">
      <meta property="og:description" content="Açıklama‮tersine\u0007   burada">
      <meta property='og:site_name' content='Örnek Site'>
      <meta property="og:image" content="/resim.png">
      <meta property="og:image:width" content="1200">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="theme-color" content="#F0A">
      <script>var x = '<meta property="og:title" content="Sahte">';</script>
      </head><body><meta property="og:image" content="https://govde.com/x.png"></body></html>`;
    expect(parseHtmlMeta(html, 'https://ornek.com/yazi/1')).toEqual({
      title: 'Tom & Jerry — "Klasik"',
      description: 'Açıklama tersine burada',
      siteName: 'Örnek Site',
      author: null,
      color: '#ff00aa',
      image: 'https://ornek.com/resim.png',
      imageWidth: 1200,
      imageHeight: null,
      card: 'summary_large_image',
    });
  });

  it('Twitter kartına, <title>a ve description\'a geri düşer; javascript: resmi atılır', () => {
    const html = `<head><TITLE>Sade  sayfa</TITLE><meta name="description" content="Kısa açıklama">
      <meta name="twitter:image" content="javascript:alert(1)"></head>`;
    const meta = parseHtmlMeta(html, 'https://sade.com/');
    expect(meta.title).toBe('Sade sayfa');
    expect(meta.description).toBe('Kısa açıklama');
    expect(meta.image).toBeNull();
  });

  it('uzun metinleri kısaltır, sayfanın karakter kümesini kullanır', () => {
    const long = parseHtmlMeta(`<meta property="og:description" content="${'a'.repeat(1000)}">`, 'https://x.com/');
    expect([...long.description!].length).toBe(350);
    expect(long.description!.endsWith('…')).toBe(true);
    const latin5 = Buffer.concat([
      Buffer.from('<meta charset="iso-8859-9"><title>'),
      Buffer.from([0xde, 0xfe, 0xf0]), // Ş ş ğ
      Buffer.from('</title>'),
    ]);
    expect(parseHtmlMeta(decodeHtml(latin5, null), 'https://x.com/').title).toBe('Şşğ');
  });

  it('kapanmamış açılışlarla dolu 1 MB sayfada olay döngüsünü kilitlemez (ReDoS)', () => {
    const MB = 1024 * 1024;
    const payloads = [
      '<!--'.repeat(MB / 4),
      '<script>'.repeat(MB / 8),
      '<style>'.repeat(MB / 7),
      '<noscript>'.repeat(MB / 10),
      '<title>'.repeat(MB / 7),
      '<meta'.repeat(MB / 5),
      `<meta ${'a="'.repeat(MB / 3)}`,
      `<title>x${'</title'.repeat(MB / 7)}`,
    ];
    for (const payload of payloads) {
      const started = performance.now();
      const meta = parseHtmlMeta(`<head><title>Başlık</title>${payload}`, 'https://x.com/');
      expect(performance.now() - started).toBeLessThan(200);
      expect(meta.title).toBe('Başlık');
    }
  });

  it('yorum, betik ve gövdedeki etiketleri eskisi gibi yok sayar; kapanmamış yorumun ardı okunur', () => {
    const html = `<head><!-- <meta property="og:title" content="Yorum"> -->
      <style>a{}</style ><noscript><meta name="description" content="Gizli"></noscript>
      <meta name="description" content="Gerçek"><!-- kapanmadı
      <meta property="og:site_name" content="Site"></head><body><title>Gövde</title>`;
    const meta = parseHtmlMeta(html, 'https://x.com/');
    expect(meta.title).toBeNull();
    expect(meta.description).toBe('Gerçek');
    expect(meta.siteName).toBe('Site');
  });
});

describe('YouTube ve X bağlantıları', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s', 'dQw4w9WgXcQ', 90],
    ['https://youtu.be/dQw4w9WgXcQ?t=42', 'dQw4w9WgXcQ', 42],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD', 'dQw4w9WgXcQ', null],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
  ])('%s', (url, id, start) => {
    expect(youtubeVideo(url)).toEqual({ id, start });
  });

  it('video olmayan YouTube ve benzer adresler', () => {
    for (const url of [
      'https://www.youtube.com/@kanal',
      'https://www.youtube.com/watch?v=kisa',
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'https://notyoutu.be/dQw4w9WgXcQ',
    ]) {
      expect(youtubeVideo(url), url).toBeNull();
    }
    expect(parseYoutubeTime('1h2m3s')).toBe(3723);
    expect(parseYoutubeTime('abc')).toBeNull();
  });

  it('X gönderileri', () => {
    expect(tweetOf('https://x.com/jack/status/20')).toEqual({ user: 'jack', id: '20' });
    expect(tweetOf('https://twitter.com/jack/status/20?s=1')).toEqual({ user: 'jack', id: '20' });
    expect(tweetOf('https://x.com/jack')).toBeNull();
    expect(tweetOf('https://x.com.evil.com/jack/status/20')).toBeNull();
  });
});

// ---------- Sahte dış dünya ----------

interface FakeResource {
  status?: number;
  type: string;
  body: Buffer | string;
}

function fakeWeb(resources: Record<string, FakeResource>): { fetch: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const fetch: Fetcher = async (url) => {
    calls.push(url);
    const r = resources[url];
    if (!r) throw new FetchError('http', 'HTTP 404', 404);
    if (r.status && r.status !== 200) throw new FetchError('http', `HTTP ${r.status}`, r.status);
    const res: SafeResponse = {
      url,
      status: 200,
      contentType: r.type,
      charset: null,
      headers: {},
      body: Readable.from([Buffer.from(r.body)]),
      close: () => undefined,
      signal: new AbortController().signal,
    };
    return res;
  };
  return { fetch, calls };
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#3366cc' } }).png().toBuffer();

describe('önizleme resimleri (imzalı adresler)', () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('imzayı doğrular; değiştirilmiş imza ya da adres reddedilir', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-media-'));
    const media = new EmbedMediaService(dir, 'gizli-anahtar-1234567890');
    const signed = media.sign('https://site.com/resim.png');
    const [, , , sig, encoded] = signed.split('/');
    expect(media.verify(sig!, encoded!)).toBe('https://site.com/resim.png');
    expect(media.verify(`${sig!.slice(0, -1)}${sig!.endsWith('A') ? 'B' : 'A'}`, encoded!)).toBeNull();
    const other = Buffer.from('http://169.254.169.254/').toString('base64url');
    expect(media.verify(sig!, other)).toBeNull();
    // Başka anahtarla imzalanmış adres geçmez
    const foreign = new EmbedMediaService(dir, 'baska-anahtar-0987654321').sign('https://site.com/resim.png');
    expect(media.verify(foreign.split('/')[3]!, encoded!)).toBeNull();
  });

  it('resmi indirir, WebP olarak yeniden kodlar; resim olmayanı ve SVG\'yi reddeder', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-media-'));
    const web = fakeWeb({
      'https://site.com/buyuk.png': { type: 'image/png', body: await png(3000, 1500) },
      'https://site.com/sahte.png': { type: 'image/png', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      'https://site.com/cizim.svg': { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      'https://site.com/sayfa': { type: 'text/html', body: '<html></html>' },
    });
    const media = new EmbedMediaService(dir, 'gizli-anahtar-1234567890', web.fetch);
    const file = await media.get('https://site.com/buyuk.png', true);
    expect(file).toMatchObject({ contentType: 'image/webp', width: 1600, height: 800 });
    // İkincisi diskten
    await media.get('https://site.com/buyuk.png');
    expect(web.calls.filter((u) => u.endsWith('buyuk.png'))).toHaveLength(1);
    for (const bad of ['https://site.com/sahte.png', 'https://site.com/cizim.svg', 'https://site.com/sayfa']) {
      expect(await media.get(bad), bad).toBeNull();
    }
  });
});

// ---------- Mesajlarda önizleme ----------

describe('mesajlarda bağlantı önizlemesi', () => {
  let s: TestServer;
  let dir: string;
  let web: ReturnType<typeof fakeWeb>;

  const PAGE = `<html><head><meta property="og:title" content="Harika Yazı"><meta property="og:site_name" content="Blog">
    <meta property="og:description" content="Özet"><meta property="og:image" content="https://blog.com/kapak.png">
    <meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#123456"></head></html>`;

  beforeAll(async () => {
    const cover = await png(1200, 630);
    const thumb = await png(480, 360);
    web = fakeWeb({
      'https://blog.com/yazi': { type: 'text/html', body: PAGE },
      'https://blog.com/kapak.png': { type: 'image/png', body: cover },
      'https://resim.com/kedi.png': { type: 'image/png', body: await png(640, 480) },
      'https://bos.com/': { type: 'text/html', body: '<html><body>yok</body></html>' },
      'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ': {
        type: 'application/json',
        body: JSON.stringify({ title: 'Never Gonna Give You Up', author_name: 'Rick Astley' }),
      },
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg': { type: 'image/jpeg', body: thumb },
    });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-media-'));
    s = await startServer({ linkFetch: web.fetch, embedMediaDir: dir });
    await s.app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(async () => {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const send = async (token: string, content: string): Promise<Message> => {
    const res = await s.req(token, 'POST', `/api/channels/${s.channel('text').id}/messages`, { content });
    expect(res.statusCode).toBe(201);
    return res.json() as Message;
  };
  const reload = async (id: string): Promise<Message> => {
    const list = (await s.req(s.owner.token, 'GET', `/api/channels/${s.channel('text').id}/messages`)).json() as Message[];
    return list.find((m) => m.id === id)!;
  };

  it('sayfa, YouTube ve doğrudan resim önizlemeleri MESSAGE_UPDATE ile gelir ve geçmişte kalır', async () => {
    const client = await connectGateway(s.app, s.owner.token);
    const message = await send(
      s.owner.token,
      'bak https://blog.com/yazi https://youtu.be/dQw4w9WgXcQ?t=10 https://resim.com/kedi.png https://bos.com/ `https://kod.com`',
    );
    expect(message.embeds).toEqual([]);
    await s.ctx.linkPreviews!.idle();
    await client.settle();
    const update = client.of('MESSAGE_UPDATE').find((m) => m.id === message.id)!;
    const embeds = update.embeds as LinkEmbed[];
    expect(embeds.map((e) => e.kind)).toEqual(['article', 'youtube', 'image']);
    expect(embeds[0]).toMatchObject({
      url: 'https://blog.com/yazi',
      title: 'Harika Yazı',
      siteName: 'Blog',
      description: 'Özet',
      color: '#123456',
      largeImage: true,
      image: { width: 1200, height: 630 },
    });
    expect(embeds[0]!.image!.url).toMatch(/^\/api\/embed-media\/[A-Za-z0-9_-]{32}\//);
    expect(embeds[1]).toMatchObject({ youtubeId: 'dQw4w9WgXcQ', youtubeStart: 10, title: 'Never Gonna Give You Up', author: 'Rick Astley' });
    expect(embeds[2]).toMatchObject({ kind: 'image', image: { width: 640, height: 480 } });
    expect(web.calls.some((u) => u.includes('kod.com'))).toBe(false);
    expect((await reload(message.id)).embeds).toEqual(embeds);

    // Resim sunucumuzdan, WebP olarak gelir; imza bozuksa 404
    const img = await s.app.inject({ method: 'GET', url: embeds[0]!.image!.url });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['content-security-policy']).toContain('sandbox');
    const tampered = embeds[0]!.image!.url.replace(/\/[A-Za-z0-9_-]{32}\//, `/${'A'.repeat(32)}/`);
    expect((await s.app.inject({ method: 'GET', url: tampered })).statusCode).toBe(404);

    // Önbellek: aynı bağlantı yeniden istenmez, yeni mesajda önizleme hemen gelir
    const before = web.calls.length;
    const again = await send(s.owner.token, 'tekrar https://blog.com/yazi');
    expect(web.calls.length).toBe(before);
    expect((again.embeds as LinkEmbed[]).map((e) => e.url)).toEqual(['https://blog.com/yazi']);
    client.ws.close();
  });

  it('<…> içindeki bağlantı önizlenmez; düzenlemede çıkarılan bağlantının önizlemesi kalkar', async () => {
    const hidden = await send(s.owner.token, '<https://blog.com/yazi>');
    await s.ctx.linkPreviews!.idle();
    expect((await reload(hidden.id)).embeds).toEqual([]);

    const message = await send(s.owner.token, 'https://blog.com/yazi');
    await s.ctx.linkPreviews!.idle();
    expect((await reload(message.id)).embeds).toHaveLength(1);
    const edited = await s.req(s.owner.token, 'PATCH', `/api/messages/${message.id}`, { content: 'bağlantı yok artık' });
    expect(edited.json().embeds).toEqual([]);
  });

  it('önizlemeyi yazar ve MANAGE_MESSAGES yetkilisi kaldırır; başkası kaldıramaz; düzenlemede geri gelmez', async () => {
    const author = await s.member('yazar');
    const other = await s.member('baskasi');
    const mod = await s.member('moderator');
    const role = await s.createRole(s.owner.token, { name: 'Mod', permissions: P.MANAGE_MESSAGES });
    expect(await s.giveRole(s.owner.token, mod.user.id, role.id)).toBeLessThan(300);

    const first = await send(author.token, 'https://blog.com/yazi');
    await s.ctx.linkPreviews!.idle();
    expect((await s.req(other.token, 'DELETE', `/api/messages/${first.id}/embeds`)).statusCode).toBe(403);
    const removed = await s.req(author.token, 'DELETE', `/api/messages/${first.id}/embeds`);
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ embeds: [], suppressEmbeds: true });
    await s.req(author.token, 'PATCH', `/api/messages/${first.id}`, { content: 'https://blog.com/yazi yeniden' });
    await s.ctx.linkPreviews!.idle();
    expect(await reload(first.id)).toMatchObject({ embeds: [], suppressEmbeds: true });

    const second = await send(author.token, 'https://blog.com/yazi');
    expect((await s.req(mod.token, 'DELETE', `/api/messages/${second.id}/embeds`)).statusCode).toBe(200);
    expect((await reload(second.id)).embeds).toEqual([]);
  });
});
