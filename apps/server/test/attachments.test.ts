import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { Attachment, GatewayServerMessage, Message, ReadyPayload } from '@diskort/shared';
import { buildApp } from '../src/app.js';
import { PENDING_TTL_MS } from '../src/attachments.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { sanitizeFileName } from '../src/fileInfo.js';

// Testlerde sınır 1 MB
const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: '.', ATTACHMENT_MAX_MB: '1' });
const MAX = 1024 * 1024;

let app: FastifyInstance;
let ctx: AppContext;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-ekler-'));
  ({ app, ctx } = await buildApp(config, { dbFile: ':memory:', logger: false, attachmentsDir: dir }));
});

afterEach(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function setup() {
  const bootstrap = ctx.store.ensureBootstrapInvite()!;
  const admin = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: bootstrap.code, username: 'admin', password: 'sifre12345' },
    })
  ).json() as { token: string; user: { id: string } };
  const code = (await app.inject({ method: 'POST', url: '/api/invites', headers: auth(admin.token), payload: {} })).json()
    .code as string;
  const member = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: code, username: 'uye', password: 'sifre12345' },
    })
  ).json() as { token: string; user: { id: string } };
  const channels = ctx.store.listChannels(ctx.guild.id);
  return {
    admin,
    member,
    text: channels.find((c) => c.type === 'text')!,
    voice: channels.find((c) => c.type === 'voice')!,
  };
}

const upload = (token: string | null, channelId: string, name: string, body: Buffer, contentType: string) =>
  app.inject({
    method: 'POST',
    url: `/api/channels/${channelId}/attachments?name=${encodeURIComponent(name)}`,
    headers: { ...(token ? auth(token) : {}), 'content-type': contentType },
    payload: body,
  });

const send = (token: string, channelId: string, payload: { content?: string; attachmentIds?: string[] }) =>
  app.inject({ method: 'POST', url: `/api/channels/${channelId}/messages`, headers: auth(token), payload });

/** Yalnızca başlığı gerçek olan küçük bir PNG (sunucu resmi çözmez, başlığı okur) */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** EXIF'inde yön (6 = 90° döndür) ve GPS enlem bilgisi olan küçük bir JPEG */
function jpegWithGps(width: number, height: number): { data: Buffer; latitude: Buffer } {
  // TIFF (küçük sonlu): başlık, IFD0 (2 kayıt), GPS IFD (1 kayıt), enlem (3 rasyonel = 24 bayt)
  const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 2 + 12 + 4 + 24);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  let p = 8;
  tiff.writeUInt16LE(2, p);
  p += 2;
  tiff.writeUInt16LE(0x0112, p); // yön
  tiff.writeUInt16LE(3, p + 2);
  tiff.writeUInt32LE(1, p + 4);
  tiff.writeUInt16LE(6, p + 8);
  p += 12;
  const gpsIfd = 8 + 2 + 24 + 4;
  tiff.writeUInt16LE(0x8825, p); // GPS dizini
  tiff.writeUInt16LE(4, p + 2);
  tiff.writeUInt32LE(1, p + 4);
  tiff.writeUInt32LE(gpsIfd, p + 8);
  p += 12;
  tiff.writeUInt32LE(0, p); // sonraki dizin yok
  p = gpsIfd;
  tiff.writeUInt16LE(1, p);
  const latitudeAt = gpsIfd + 2 + 12 + 4;
  tiff.writeUInt16LE(0x0002, p + 2); // GPSLatitude
  tiff.writeUInt16LE(5, p + 4); // RATIONAL
  tiff.writeUInt32LE(3, p + 6);
  tiff.writeUInt32LE(latitudeAt, p + 10);
  const latitude = Buffer.alloc(24);
  [41, 1, 0, 1, 12, 1].forEach((v, i) => latitude.writeUInt32LE(v === 0 ? 0 : v * 1000 + 7, i * 4));
  latitude.copy(tiff, latitudeAt);

  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exif.length + 2, 2);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  const data = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, exif, sof, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
  return { data, latitude };
}

describe('dosya yükleme', () => {
  it('resim yüklenir, mesaja eklenir ve tahmin edilemeyen adresten oturumsuz alınır', async () => {
    const { member, text } = await setup();
    const res = await upload(member.token, text.id, 'tatil fotoğrafı.png', png(640, 480), 'image/png');
    expect(res.statusCode).toBe(201);
    const attachment = res.json() as Attachment;
    expect(attachment).toMatchObject({ name: 'tatil fotoğrafı.png', size: 64, contentType: 'image/png', width: 640, height: 480 });
    expect(attachment.id).toMatch(/^[0-9a-f]{32}$/);
    expect(attachment.url).toBe(`/api/attachments/${attachment.id}/${encodeURIComponent('tatil fotoğrafı.png')}`);

    // Mesaja eklenmeden sunulmaz
    expect((await app.inject({ method: 'GET', url: attachment.url })).statusCode).toBe(404);

    const created = await send(member.token, text.id, { content: '', attachmentIds: [attachment.id] });
    expect(created.statusCode).toBe(201);
    const message = created.json() as Message;
    expect(message.content).toBe('');
    expect(message.attachments).toEqual([attachment]);
    const listed = (
      await app.inject({ method: 'GET', url: `/api/channels/${text.id}/messages`, headers: auth(member.token) })
    ).json() as Message[];
    expect(listed.at(-1)!.attachments).toEqual([attachment]);

    const served = await app.inject({ method: 'GET', url: attachment.url });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(png(640, 480))).toBe(true);
    expect(served.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=31536000, immutable',
    });
    expect(served.headers['content-disposition']).toMatch(/^inline; /);
    expect(served.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('tatil fotoğrafı.png')}`);
    expect(served.headers['content-security-policy']).toContain('sandbox');

    // Uzun (kodlanınca yüzlerce karakter) Türkçe ad da adreste çalışır
    const longName = `${'çğüşöı'.repeat(15)}.png`;
    const long = (await upload(member.token, text.id, longName, png(2, 2), 'image/png')).json() as Attachment;
    await send(member.token, text.id, { attachmentIds: [long.id] });
    expect(long.url.length).toBeGreaterThan(500);
    expect((await app.inject({ method: 'GET', url: long.url })).statusCode).toBe(200);

    // Adresteki ad önemsizdir; kimlik tek başına yeterli ve gereklidir
    expect((await app.inject({ method: 'GET', url: `/api/attachments/${attachment.id}/baska.png` })).statusCode).toBe(200);
    const guessed = `/api/attachments/${'0'.repeat(32)}/tatil.png`;
    expect((await app.inject({ method: 'GET', url: guessed })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/attachments/../../diskort.db/x' })).statusCode).toBe(404);
  });

  it('boyut sınırı: bildirilen boyut da akan gövde de denetlenir, yarım dosya kalmaz', async () => {
    const { member, text } = await setup();
    const exact = await upload(member.token, text.id, 'tam.bin', Buffer.alloc(MAX, 1), 'application/octet-stream');
    expect(exact.statusCode).toBe(201);

    const over = await upload(member.token, text.id, 'buyuk.bin', Buffer.alloc(MAX + 1, 1), 'application/octet-stream');
    expect(over.statusCode).toBe(413);
    expect(over.json().message).toBe('Dosya çok büyük (en fazla 1 MB).');

    // Content-Length olmadan (parça parça) gönderilen büyük dosya da kesilir
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const status = await new Promise<number | 'kesildi'>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `/api/channels/${text.id}/attachments?name=akis.bin`,
          headers: { ...auth(member.token), 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' },
        },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.on('error', () => resolve('kesildi'));
      const chunk = Buffer.alloc(64 * 1024, 2);
      let sent = 0;
      const pump = (): void => {
        while (sent <= MAX + chunk.length) {
          sent += chunk.length;
          if (!req.write(chunk)) {
            req.once('drain', pump);
            return;
          }
        }
        req.end();
      };
      pump();
    });
    expect([413, 'kesildi']).toContain(status);
    await new Promise((r) => setTimeout(r, 100));
    // Diskte yalnızca ilk (sınırda) dosya var; yarım .part dosyası yok
    expect(fs.readdirSync(dir)).toEqual([(exact.json() as Attachment).id]);
  });

  it('boş dosya, oturumsuz yükleme ve ses kanalına yükleme reddedilir', async () => {
    const { member, text, voice } = await setup();
    expect((await upload(member.token, text.id, 'bos.txt', Buffer.alloc(0), 'text/plain')).statusCode).toBe(400);
    expect((await upload(null, text.id, 'a.txt', Buffer.from('a'), 'text/plain')).statusCode).toBe(401);
    expect((await upload(member.token, voice.id, 'a.txt', Buffer.from('a'), 'text/plain')).statusCode).toBe(404);
  });

  it('etkin içerik (HTML, SVG, betik) hiçbir zaman tarayıcıda çalışacak türle sunulmaz', async () => {
    const { member, text } = await setup();
    const cases: [string, string, string, string][] = [
      // ad, bildirilen tür, saklanan tür, sunulan tür
      ['sayfa.html', 'text/html', 'text/html', 'application/octet-stream'],
      ['resim.svg', 'image/svg+xml', 'image/svg+xml', 'application/octet-stream'],
      ['betik.js', 'text/javascript; charset=utf-8', 'text/javascript', 'application/octet-stream'],
      // PNG olduğunu söyleyen ama olmayan dosya resim sayılmaz
      ['sahte.png', 'image/png', 'application/octet-stream', 'application/octet-stream'],
      ['not.txt', 'text/plain', 'text/plain', 'text/plain; charset=utf-8'],
      ['belge.pdf', 'application/pdf', 'application/pdf', 'application/pdf'],
      ['ozel', 'application/x-ozel-bicim', 'application/x-ozel-bicim', 'application/octet-stream'],
    ];
    const ids: string[] = [];
    for (const [name, declared, stored] of cases) {
      const res = await upload(member.token, text.id, name, Buffer.from('<script>alert(1)</script>'), declared);
      expect(res.json()).toMatchObject({ name, contentType: stored, width: null, height: null });
      ids.push((res.json() as Attachment).id);
    }
    const message = (await send(member.token, text.id, { content: 'dosyalar', attachmentIds: ids })).json() as Message;
    expect(message.attachments.map((a) => a.name)).toEqual(cases.map(([name]) => name));
    for (const [i, a] of message.attachments.entries()) {
      const served = await app.inject({ method: 'GET', url: a.url });
      expect(served.headers['content-type']).toBe(cases[i]![3]);
      expect(served.headers['content-disposition']).toMatch(/^attachment; /);
      expect(served.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('JPEG: EXIF yönü boyuta uygulanır, konum (GPS) bilgisi silinir', async () => {
    const { member, text } = await setup();
    const { data, latitude } = jpegWithGps(4000, 3000);
    expect(data.includes(latitude)).toBe(true);
    const res = await upload(member.token, text.id, 'IMG_0001.jpg', data, 'image/jpeg');
    expect(res.json()).toMatchObject({ contentType: 'image/jpeg', width: 3000, height: 4000 });
    const stored = fs.readFileSync(path.join(dir, (res.json() as Attachment).id));
    expect(stored.length).toBe(data.length);
    expect(stored.includes(latitude)).toBe(false);
    // Yön bilgisi ve görüntü kısmı yerinde kalır
    expect(stored.subarray(stored.length - 20).equals(data.subarray(data.length - 20))).toBe(true);
  });

  it('dosya adları temizlenir', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\ali\\Masaüstü\\rapor.pdf')).toBe('rapor.pdf');
    // Sağdan sola çevirme karakteriyle gizlenmiş uzantı
    expect(sanitizeFileName('resim\u202Egpj.exe')).toBe('resimgpj.exe');
    expect(sanitizeFileName('a\u0000b\u0007c<>:"|?*.txt')).toBe('abc_______.txt');
    expect(sanitizeFileName('  ..gizli.  ')).toBe('gizli');
    expect(sanitizeFileName('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFileName('')).toBe('dosya');
    expect(sanitizeFileName('...')).toBe('dosya');
    const long = sanitizeFileName(`${'ç'.repeat(150)}.jpeg`);
    expect(Array.from(long)).toHaveLength(100);
    expect(long.endsWith('ç.jpeg')).toBe(true);
    expect(sanitizeFileName('çok   boşluklu\tad.txt')).toBe('çok boşluklu ad.txt');
  });
});

describe('dosyalı mesajlar', () => {
  it('başkasının, başka kanalın ya da kullanılmış dosyası eklenemez; en fazla 10 dosya', async () => {
    const { admin, member, text } = await setup();
    const other = ctx.store.createChannel(ctx.guild.id, 'diger', 'text');
    const mine = (await upload(member.token, text.id, 'a.txt', Buffer.from('a'), 'text/plain')).json() as Attachment;
    const elsewhere = (await upload(member.token, other.id, 'b.txt', Buffer.from('b'), 'text/plain')).json() as Attachment;

    expect((await send(admin.token, text.id, { attachmentIds: [mine.id] })).json().error).toBe('invalid_attachment');
    expect((await send(member.token, text.id, { attachmentIds: [elsewhere.id] })).json().error).toBe('invalid_attachment');
    expect((await send(member.token, text.id, { attachmentIds: [mine.id, mine.id] })).statusCode).toBe(400);
    expect((await send(member.token, text.id, { attachmentIds: ['x'.repeat(32)] })).statusCode).toBe(400);
    expect((await send(member.token, text.id, { content: '', attachmentIds: [] })).json().message).toBe('Mesaj boş olamaz.');
    expect((await send(member.token, text.id, { attachmentIds: [mine.id] })).statusCode).toBe(201);
    expect((await send(member.token, text.id, { attachmentIds: [mine.id] })).json().error).toBe('invalid_attachment');

    const eleven = Array.from({ length: 11 }, (_, i) => i.toString(16).padStart(32, '0'));
    expect((await send(member.token, text.id, { attachmentIds: eleven })).json().message).toBe(
      'Bir mesaja en fazla 10 dosya eklenebilir.',
    );
  });

  it('dosyalı mesajın metni düzenlenip boşaltılabilir; dosyasız mesajınki boşaltılamaz', async () => {
    const { member, text } = await setup();
    const file = (await upload(member.token, text.id, 'a.txt', Buffer.from('a'), 'text/plain')).json() as Attachment;
    const withFile = (await send(member.token, text.id, { content: 'açıklama', attachmentIds: [file.id] })).json() as Message;
    const plain = (await send(member.token, text.id, { content: 'yalnız metin' })).json() as Message;
    const edit = (id: string) =>
      app.inject({ method: 'PATCH', url: `/api/messages/${id}`, headers: auth(member.token), payload: { content: ' ' } });
    const edited = await edit(withFile.id);
    expect(edited.json()).toMatchObject({ content: '', attachments: [file] });
    expect((await edit(plain.id)).statusCode).toBe(400);
  });

  it('mesaj silinince dosyası diskten silinir ve adresi çalışmaz; kanal silinince de', async () => {
    const { admin, member, text } = await setup();
    const a = (await upload(member.token, text.id, 'a.png', png(1, 1), 'image/png')).json() as Attachment;
    const b = (await upload(member.token, text.id, 'b.txt', Buffer.from('b'), 'text/plain')).json() as Attachment;
    const m1 = (await send(member.token, text.id, { attachmentIds: [a.id] })).json() as Message;
    await send(member.token, text.id, { attachmentIds: [b.id] });
    expect(fs.readdirSync(dir).sort()).toEqual([a.id, b.id].sort());

    expect(
      (await app.inject({ method: 'DELETE', url: `/api/messages/${m1.id}`, headers: auth(admin.token) })).statusCode,
    ).toBe(204);
    expect(fs.readdirSync(dir)).toEqual([b.id]);
    expect((await app.inject({ method: 'GET', url: a.url })).statusCode).toBe(404);

    await app.inject({ method: 'DELETE', url: `/api/channels/${text.id}`, headers: auth(admin.token) });
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(ctx.store.attachmentExists(b.id)).toBe(false);
  });

  it('temizlik: mesaja eklenmeyen eski yüklemeler ve veritabanında karşılığı olmayan dosyalar silinir', async () => {
    const { member, text } = await setup();
    const pending = (await upload(member.token, text.id, 'bekleyen.txt', Buffer.from('x'), 'text/plain')).json() as Attachment;
    const used = (await upload(member.token, text.id, 'kullanilan.txt', Buffer.from('y'), 'text/plain')).json() as Attachment;
    await send(member.token, text.id, { attachmentIds: [used.id] });
    const orphan = 'f'.repeat(32);
    fs.writeFileSync(path.join(dir, orphan), 'artık');
    fs.writeFileSync(path.join(dir, `${'e'.repeat(32)}.part`), 'yarım');
    fs.writeFileSync(path.join(dir, 'README.txt'), 'bize ait değil');

    // Henüz süresi dolmamış: hiçbir şey silinmez
    expect(await ctx.attachments.sweep()).toBe(0);
    expect(await ctx.attachments.sweep(Date.now() + PENDING_TTL_MS + 60_000)).toBe(3);
    expect(fs.readdirSync(dir).sort()).toEqual(['README.txt', used.id].sort());
    expect(ctx.store.attachmentExists(pending.id)).toBe(false);
  });

  it('gateway: READY dosya sınırını, MESSAGE_CREATE dosyaları taşır', async () => {
    const { admin, member, text } = await setup();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/gateway`);
    const events: GatewayServerMessage[] = [];
    const ready = await new Promise<ReadyPayload>((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as GatewayServerMessage;
        if (msg.t === 'HELLO') ws.send(JSON.stringify({ t: 'IDENTIFY', d: { token: admin.token } }));
        else if (msg.t === 'READY') resolve(msg.d);
        else events.push(msg);
      });
    });
    expect(ready.attachmentMaxBytes).toBe(MAX);
    const file = (await upload(member.token, text.id, 'a.gif', Buffer.from('GIF89a\x10\x00\x20\x00', 'latin1'), 'image/gif')).json() as Attachment;
    expect(file).toMatchObject({ contentType: 'image/gif', width: 16, height: 32 });
    await send(member.token, text.id, { attachmentIds: [file.id] });
    await new Promise((r) => setTimeout(r, 150));
    expect(events.find((e) => e.t === 'MESSAGE_CREATE')).toMatchObject({ d: { attachments: [file] } });
    ws.close();
  });
});
