import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Attachment, Message } from '@diskort/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { inspectVideo, parseRange } from '../src/fileInfo.js';
import { auth } from './helpers.js';

// Testlerde sınır 2 MB
const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: '.', ATTACHMENT_MAX_MB: '2' });

let app: FastifyInstance;
let ctx: AppContext;
let dir: string;
let account: Promise<{ token: string; text: { id: string } }> | null;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-video-'));
  ({ app, ctx } = await buildApp(config, { dbFile: ':memory:', logger: false, attachmentsDir: dir }));
  account = null;
});

afterEach(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function member() {
  account ??= register();
  return account;
}

async function register() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { inviteCode: ctx.store.ensureBootstrapInvite()!.code, username: 'uye', password: 'sifre12345' },
  });
  const { token } = res.json() as { token: string };
  const text = ctx.store.listChannels(ctx.guild.id).find((c) => c.type === 'text')!;
  return { token, text };
}

/** Dosyayı yükler ve bir mesaja ekler (yalnızca mesajdaki dosyalar sunulur) */
async function post(name: string, body: Buffer, contentType: string): Promise<Attachment> {
  const { token, text } = await member();
  const uploaded = await app.inject({
    method: 'POST',
    url: `/api/channels/${text.id}/attachments?name=${encodeURIComponent(name)}`,
    headers: { ...auth(token), 'content-type': contentType },
    payload: body,
  });
  expect(uploaded.statusCode).toBe(201);
  const attachment = uploaded.json() as Attachment;
  const message = await app.inject({
    method: 'POST',
    url: `/api/channels/${text.id}/messages`,
    headers: auth(token),
    payload: { attachmentIds: [attachment.id] },
  });
  expect((message.json() as Message).attachments).toEqual([attachment]);
  return attachment;
}

// ---------- Küçük ama başlıkları gerçek video dosyaları ----------

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]);
}

interface Mp4Options {
  brand?: string;
  width?: number;
  height?: number;
  /** Telefonla dik çekim: 90° döndürme matrisi */
  rotated?: boolean;
  seconds?: number;
  /** moov dosyanın sonunda (telefon kayıtları) ya da başında (web için hazırlanmış) */
  moovAtEnd?: boolean;
  /** false: yalnızca ses izi (M4A gibi) */
  video?: boolean;
  mdatBytes?: number;
}

function mp4({
  brand = 'isom',
  width = 1920,
  height = 1080,
  rotated = false,
  seconds = 12.5,
  moovAtEnd = true,
  video = true,
  mdatBytes = 300 * 1024,
}: Mp4Options = {}): Buffer {
  const ftyp = box('ftyp', Buffer.from(brand, 'latin1'), u32(0x200), Buffer.from('isomiso2mp41', 'latin1'));
  const timescale = 1000;
  const mvhd = box('mvhd', u32(0), u32(0), u32(0), u32(timescale), u32(seconds * timescale), Buffer.alloc(80));
  const matrix = rotated
    ? [0, 0x00010000, 0, 0xffff0000, 0, 0, 0, 0, 0x40000000]
    : [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
  const tkhd = box(
    'tkhd',
    u32(3), // sürüm 0, bayraklar
    u32(0),
    u32(0),
    u32(1), // iz kimliği
    u32(0),
    u32(seconds * timescale),
    Buffer.alloc(8),
    Buffer.alloc(8), // katman, grup, ses, ayrılmış
    ...matrix.map(u32),
    u32(video ? width * 65536 : 0),
    u32(video ? height * 65536 : 0),
  );
  const hdlr = box('hdlr', u32(0), u32(0), Buffer.from(video ? 'vide' : 'soun', 'latin1'), Buffer.alloc(12), Buffer.from('Handler\0'));
  const moov = box('moov', mvhd, box('trak', tkhd, box('mdia', hdlr)));
  const mdat = box('mdat', Buffer.alloc(mdatBytes, 7));
  return moovAtEnd ? Buffer.concat([ftyp, mdat, moov]) : Buffer.concat([ftyp, moov, mdat]);
}

/** EBML öğesi: kimlik (işaret biti dahil) ve 8 baytlık boyut */
function el(id: number, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const idBytes: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) idBytes.unshift(v & 0xff);
  const size = Buffer.alloc(8);
  size[0] = 0x01;
  size.writeUIntBE(body.length, 2, 6);
  return Buffer.concat([Buffer.from(idBytes), size, body]);
}

const uint = (n: number, bytes: number): Buffer => {
  const b = Buffer.alloc(bytes);
  b.writeUIntBE(n, 0, bytes);
  return b;
};

function webm({ docType = 'webm', width = 640, height = 360, ms = 5500, unknownSegmentSize = false } = {}): Buffer {
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(ms);
  const header = el(0x1a45dfa3, el(0x4286, uint(1, 1)), el(0x4282, Buffer.from(docType, 'latin1')));
  const children = Buffer.concat([
    el(0x1549a966, el(0x2ad7b1, uint(1_000_000, 3)), el(0x4489, duration)),
    el(
      0x1654ae6b,
      // Önce ses izi, sonra görüntü izi
      el(0xae, el(0x83, uint(2, 1))),
      el(0xae, el(0x83, uint(1, 1)), el(0xe0, el(0xb0, uint(width, 2)), el(0xba, uint(height, 2)))),
    ),
    el(0x1f43b675, Buffer.alloc(2048, 3)),
  ]);
  const segment = unknownSegmentSize
    ? Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), children])
    : el(0x18538067, children);
  return Buffer.concat([header, segment]);
}

describe('video ekleri', () => {
  it('MP4: içerikten tanınır, boyut ve süre dosyanın sonundaki moov kutusundan okunur, satır içinde sunulur', async () => {
    const data = mp4();
    const a = await post('tatil.mp4', data, 'video/mp4');
    expect(a).toMatchObject({ contentType: 'video/mp4', width: 1920, height: 1080, duration: 12.5 });

    const served = await app.inject({ method: 'GET', url: a.url });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(data)).toBe(true);
    expect(served.headers).toMatchObject({
      'content-type': 'video/mp4',
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
      'content-length': String(data.length),
    });
    expect(served.headers['content-disposition']).toMatch(/^inline; filename="tatil.mp4"/);
    expect(served.headers['content-security-policy']).toContain('sandbox');
    expect(served.headers['content-security-policy']).toContain("media-src 'self'");
  });

  it('dik çekim (90° döndürülmüş) videoda boyut döner; moov başta da okunur', async () => {
    const a = await post('dik.mp4', mp4({ rotated: true, moovAtEnd: false, seconds: 3 }), 'video/mp4');
    expect(a).toMatchObject({ contentType: 'video/mp4', width: 1080, height: 1920, duration: 3 });
  });

  it('QuickTime (.mov) ve WebM tanınır; Matroska indirilebilir dosya kalır', async () => {
    const mov = await post('IMG_0001.MOV', mp4({ brand: 'qt  ', width: 1280, height: 720 }), 'video/quicktime');
    expect(mov).toMatchObject({ contentType: 'video/quicktime', width: 1280, height: 720 });

    const web = await post('kayit.webm', webm(), 'video/webm');
    expect(web).toMatchObject({ contentType: 'video/webm', width: 640, height: 360, duration: 5.5 });
    const served = await app.inject({ method: 'GET', url: web.url });
    expect(served.headers['content-type']).toBe('video/webm');
    expect(served.headers['content-disposition']).toMatch(/^inline; /);

    // Tarayıcıdan kaydedilen WebM'de bölüm boyutu bilinmez ve süre yazılmaz
    expect(inspectVideo(webm({ unknownSegmentSize: true }))).toMatchObject({ type: 'video/webm', width: 640, height: 360 });

    const mkv = await post('film.mkv', webm({ docType: 'matroska' }), 'application/octet-stream');
    expect(mkv).toMatchObject({ contentType: 'video/x-matroska', width: 640, height: 360 });
    const download = await app.inject({ method: 'GET', url: mkv.url });
    expect(download.headers['content-type']).toBe('video/x-matroska');
    expect(download.headers['content-disposition']).toMatch(/^attachment; /);
  });

  it('bildirilen türe güvenilmez: sahte video indirilir, video olmayan ftyp dosyaları video sayılmaz', async () => {
    const cases: [string, Buffer, string, string][] = [
      // ad, içerik, bildirilen tür, saklanan tür
      ['sahte.mp4', Buffer.from('<html><script>alert(1)</script></html>'), 'video/mp4', 'application/octet-stream'],
      ['sahte.webm', Buffer.from('<svg onload="alert(1)"/>'), 'video/webm', 'application/octet-stream'],
      ['sahte.mov', Buffer.from('%PDF-1.4 sahte video'), 'video/quicktime', 'application/octet-stream'],
      // İçerik resimse resim sayılır (bildirilen tür ne olursa olsun)
      ['aslinda-gif.mov', Buffer.from('GIF89a\x10\x00\x10\x00', 'latin1'), 'video/quicktime', 'image/gif'],
      // HEIC resmi de "ftyp" kutusuyla başlar
      ['foto.heic', mp4({ brand: 'heic', mdatBytes: 64 }), 'image/heic', 'image/heic'],
      // Görüntü izi olmayan MP4 (ses kaydı)
      ['ses.m4a', mp4({ video: false, mdatBytes: 64 }), 'audio/mp4', 'audio/mp4'],
      ['ses2.mp4', mp4({ video: false, mdatBytes: 64 }), 'video/mp4', 'application/octet-stream'],
      // Gerçek video, türü bildirilmemiş
      ['adsiz', mp4({ mdatBytes: 64 }), 'application/octet-stream', 'video/mp4'],
    ];
    for (const [name, body, declared, stored] of cases) {
      const a = await post(name, body, declared);
      expect({ name, type: a.contentType }).toEqual({ name, type: stored });
      const served = await app.inject({ method: 'GET', url: a.url });
      const inline = (stored.startsWith('video/') && stored !== 'video/x-matroska') || stored === 'image/gif';
      expect(served.headers['content-disposition']).toMatch(inline ? /^inline; / : /^attachment; /);
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      if (!inline) expect(served.headers['content-type']).not.toMatch(/^(video|text\/html|image\/(svg|gif|png))/);
    }
  });
});

describe('HTTP Range', () => {
  const data = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

  async function file(): Promise<string> {
    return (await post('veri.bin', data, 'application/octet-stream')).url;
  }
  const get = (url: string, headers: Record<string, string>) => app.inject({ method: 'GET', url, headers });

  it('tek aralık: 206, Content-Range ve yalnızca istenen baytlar', async () => {
    const url = await file();
    const res = await get(url, { range: 'bytes=100-199' });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 100-199/1000');
    expect(res.headers['content-length']).toBe('100');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.rawPayload.equals(data.subarray(100, 200))).toBe(true);
    // İndirme dosyası parça parça alınsa da indirilir kalır
    expect(res.headers['content-disposition']).toMatch(/^attachment; /);
    expect(res.headers['content-type']).toBe('application/octet-stream');
  });

  it('açık uçlu, son N bayt ve dosyayı aşan son', async () => {
    const url = await file();
    const open = await get(url, { range: 'bytes=900-' });
    expect(open.statusCode).toBe(206);
    expect(open.headers['content-range']).toBe('bytes 900-999/1000');
    expect(open.rawPayload.equals(data.subarray(900))).toBe(true);

    const suffix = await get(url, { range: 'bytes=-10' });
    expect(suffix.headers['content-range']).toBe('bytes 990-999/1000');
    expect(suffix.rawPayload.equals(data.subarray(990))).toBe(true);

    const beyond = await get(url, { range: 'bytes=995-5000' });
    expect(beyond.statusCode).toBe(206);
    expect(beyond.headers['content-range']).toBe('bytes 995-999/1000');

    const whole = await get(url, { range: 'bytes=0-' });
    expect(whole.statusCode).toBe(206);
    expect(whole.rawPayload.equals(data)).toBe(true);
  });

  it('karşılanamayan ya da bozuk aralık: 416', async () => {
    const url = await file();
    for (const range of ['bytes=1000-', 'bytes=5000-6000', 'bytes=500-100', 'bytes=-0', 'bytes=abc', 'bytes=-', 'bayt']) {
      const res = await get(url, { range });
      expect({ range, status: res.statusCode }).toEqual({ range, status: 416 });
      expect(res.headers['content-range']).toBe('bytes */1000');
      expect(res.headers['content-disposition']).toBeUndefined();
    }
  });

  it('yok sayılan başlıklar: başka birim, çoklu aralık, eşleşmeyen If-Range → tüm dosya', async () => {
    const url = await file();
    for (const headers of [
      { range: 'items=0-5' } as Record<string, string>,
      { range: 'bytes=0-5,10-20' },
      { range: 'bytes=0-5', 'if-range': '"baska-surum"' },
    ]) {
      const res = await get(url, headers);
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(data)).toBe(true);
    }
    const etag = (await get(url, {})).headers.etag as string;
    expect((await get(url, { range: 'bytes=0-5', 'if-range': etag })).statusCode).toBe(206);
    expect((await get(url, { 'if-none-match': etag })).statusCode).toBe(304);
  });

  it('video ileri sarma: mesajdaki videonun ortasından okuma', async () => {
    const video = mp4();
    const a = await post('uzun.mp4', video, 'video/mp4');
    const res = await get(a.url, { range: `bytes=${video.length - 500}-` });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.rawPayload.equals(video.subarray(video.length - 500))).toBe(true);
  });

  it('parseRange', () => {
    expect(parseRange(undefined, 10)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=0-0', 10)).toEqual({ kind: 'range', start: 0, end: 0 });
    expect(parseRange('Bytes = 2-4', 10)).toEqual({ kind: 'range', start: 2, end: 4 });
    expect(parseRange('bytes=-20', 10)).toEqual({ kind: 'range', start: 0, end: 9 });
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'invalid' });
    expect(parseRange('bytes=99999999999999999999-', 10)).toEqual({ kind: 'invalid' });
  });
});
