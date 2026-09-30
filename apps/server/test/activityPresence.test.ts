import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIVITY_ELAPSED_MAX_MS,
  ACTIVITY_ICON_MAX_BYTES,
  ACTIVITY_NAME_MAX_LENGTH,
  CLIENT_FEATURE_DM,
  CLIENT_FEATURE_PRESENCE,
  activityIconPath,
  type Activity,
} from '@diskort/shared';
import { ActivityIconStore, inspectPng } from '../src/activityIcons.js';
import { auth, connectGateway, type GatewayClient, type TestServer, startServer } from './helpers.js';

let s: TestServer;
let dir: string;
const clients: GatewayClient[] = [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-activity-'));
  s = await startServer({ activityIconsDir: dir });
  await s.app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const connect = async (token: string): Promise<GatewayClient> => {
  const client = await connectGateway(s.app, token, [CLIENT_FEATURE_DM, CLIENT_FEATURE_PRESENCE]);
  clients.push(client);
  return client;
};

const report = (c: GatewayClient, activity: unknown): void => c.ws.send(JSON.stringify({ t: 'ACTIVITY_SET', d: { activity } }));
const game = (name: string, elapsedMs = 0, icon: string | null = null) => ({ type: 'game', name, icon, elapsedMs });

const MIN = 60_000;
const HOUR = 60 * MIN;

const sha = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

/** Tek renk PNG */
const png = (width: number, height = width, color = '#3366cc'): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 4, background: color } })
    .png()
    .toBuffer();

const put = (token: string | null, key: string, body: Buffer, contentType = 'image/png') =>
  s.app.inject({
    method: 'PUT',
    url: activityIconPath(key),
    headers: { ...(token ? auth(token) : {}), 'content-type': contentType },
    payload: body,
  });

describe('etkinlik', () => {
  it('ACTIVITY_SET ortak sunucudakilere PRESENCE_UPDATE ile gider; READY ve GUILD_CREATE içerir; null temizler', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const cv = await connect(veli.token);
    const ca = await connect(ali.token);
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE')).toEqual([
      { userId: ali.user.id, online: true, status: 'online', customStatus: null, activity: null },
    ]);
    cv.events.length = 0;

    const before = Date.now();
    report(ca, game('  Counter-Strike\n2  ', 5 * MIN));
    await cv.settle();
    const updates = cv.of('PRESENCE_UPDATE');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      userId: ali.user.id,
      online: true,
      status: 'online',
      activity: { type: 'game', name: 'Counter-Strike 2', icon: null },
    });
    const startedAt = updates[0]!.activity!.startedAt;
    expect(startedAt).toBeGreaterThanOrEqual(before - 5 * MIN);
    expect(startedAt).toBeLessThanOrEqual(Date.now() - 5 * MIN);
    // Kendi oturumu da alır
    expect(ca.of('PRESENCE_UPDATE').at(-1)).toMatchObject({ userId: ali.user.id, activity: { name: 'Counter-Strike 2' } });

    // Sonradan bağlanan READY'de, yeni katıldığı sunucuda GUILD_CREATE'te görür
    const cv2 = await connect(veli.token);
    expect(cv2.ready.presences?.[ali.user.id]?.activity).toEqual(updates[0]!.activity);
    const guild = (await s.req(ali.token, 'POST', '/api/guilds', { name: 'İkinci' })).json() as { guild: { id: string } };
    const code = (await s.req(ali.token, 'POST', `/api/guilds/${guild.guild.id}/invites`, {})).json().code as string;
    await s.req(veli.token, 'POST', `/api/invites/${code}/accept`, {});
    await cv.settle();
    expect(cv.of('GUILD_CREATE').at(-1)?.presences?.[ali.user.id]?.activity).toEqual(updates[0]!.activity);

    // Boşta ve Rahatsız Etmeyin'de de görünür
    await s.req(ali.token, 'PATCH', '/api/me/status', { status: 'dnd' });
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE').at(-1)).toMatchObject({ status: 'dnd', activity: { name: 'Counter-Strike 2' } });

    cv.events.length = 0;
    report(ca, null);
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE')).toEqual([
      { userId: ali.user.id, online: true, status: 'dnd', customStatus: null, activity: null },
    ]);
    // Zaten yokken temizlemek olay üretmez
    cv.events.length = 0;
    report(ca, null);
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE')).toEqual([]);
  });

  it('geçersiz bildirimler yok sayılır; süre sınırlanır', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const cv = await connect(veli.token);
    const ca = await connect(ali.token);
    report(ca, game('Hades', MIN));
    await cv.settle();
    cv.events.length = 0;

    const bad: unknown[] = [
      undefined,
      'Hades',
      42,
      [],
      {},
      { type: 'listening', name: 'Şarkı', icon: null, elapsedMs: 0 },
      { type: 'game', name: 123, icon: null, elapsedMs: 0 },
      game(''),
      game(' \n\t\u0000 '),
      game('x'.repeat(ACTIVITY_NAME_MAX_LENGTH + 1)),
      { type: 'game', name: 'Oyun', icon: null },
      { type: 'game', name: 'Oyun', icon: null, elapsedMs: '5' },
      { type: 'game', name: 'Oyun', icon: null, elapsedMs: null },
    ];
    for (const activity of bad) report(ca, activity);
    ca.ws.send(JSON.stringify({ t: 'ACTIVITY_SET' }));
    ca.ws.send(JSON.stringify({ t: 'ACTIVITY_SET', d: null }));
    ca.ws.send(JSON.stringify({ t: 'ACTIVITY_SET', d: { activity: { type: 'game', name: 'Oyun', elapsedMs: 1e999 } } }));
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE')).toEqual([]);
    expect(s.ctx.gateway.presenceOf(ali.user.id).activity).toMatchObject({ name: 'Hades' });
    expect(ca.ws.readyState).toBe(ca.ws.OPEN);

    // En uzun ad kabul edilir (kod noktası sayılır); süre eksi ya da aşırıysa sınıra çekilir
    const long = '🎮'.repeat(ACTIVITY_NAME_MAX_LENGTH);
    report(ca, game(long, -5000));
    await cv.settle();
    const fresh = cv.of('PRESENCE_UPDATE').at(-1)!.activity!;
    expect(fresh.name).toBe(long);
    expect(Math.abs(fresh.startedAt - Date.now())).toBeLessThan(5000);
    report(ca, game('Eski', ACTIVITY_ELAPSED_MAX_MS * 10));
    await cv.settle();
    const old = cv.of('PRESENCE_UPDATE').at(-1)!.activity!;
    expect(Math.abs(Date.now() - ACTIVITY_ELAPSED_MAX_MS - old.startedAt)).toBeLessThan(5000);
    // Biçimi bozuk ya da sunucuda olmayan ikon: etkinlik ikonsuz görünür
    report(ca, game('İkonlu', 0, '../../etc/passwd'));
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE').at(-1)!.activity).toMatchObject({ name: 'İkonlu', icon: null });
    report(ca, game('İkonlu 2', 0, 'a'.repeat(64)));
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE').at(-1)!.activity).toMatchObject({ name: 'İkonlu 2', icon: null });
  });

  it('aynı oyun yeniden bildirilince başlangıç korunur; ikon değişikliği ve büyük fark duyurulur', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const cv = await connect(veli.token);
    const ca = await connect(ali.token);
    const last = async (): Promise<Activity> => {
      await cv.settle();
      return cv.of('PRESENCE_UPDATE').at(-1)!.activity!;
    };
    report(ca, game('Factorio', 10_000));
    const first = await last();
    cv.events.length = 0;

    report(ca, game('Factorio', 35_000));
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE')).toEqual([]);
    expect(s.ctx.gateway.presenceOf(ali.user.id).activity).toEqual(first);

    // İkon sonradan yüklendi: başlangıç aynı kalır, ikon gelir
    const icon = await png(32);
    expect((await put(ali.token, sha(icon), icon)).statusCode).toBe(201);
    report(ca, game('Factorio', 40_000, sha(icon)));
    expect(await last()).toEqual({ ...first, icon: sha(icon) });

    // Bir dakikadan büyük fark gerçek bir değişikliktir
    report(ca, game('Factorio', 10 * MIN, sha(icon)));
    const moved = await last();
    expect(first.startedAt - moved.startedAt).toBeGreaterThan(9 * MIN);
    // Başka oyun: başlangıç korunmaz
    report(ca, game('Satisfactory', 10 * MIN));
    expect(await last()).toMatchObject({ name: 'Satisfactory', icon: null });
  });

  it('iki oturum: en son başlayan görünür; oturum kapanınca etkinliği kalkar', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const cv = await connect(veli.token);
    const desk = await connect(ali.token);
    const laptop = await connect(ali.token);
    const last = async (): Promise<Activity | null | undefined> => {
      await cv.settle();
      return cv.of('PRESENCE_UPDATE').at(-1)?.activity;
    };
    report(desk, game('Eski Oyun', HOUR));
    expect(await last()).toMatchObject({ name: 'Eski Oyun' });
    report(laptop, game('Yeni Oyun', MIN));
    expect(await last()).toMatchObject({ name: 'Yeni Oyun' });
    // Daha eski başlayan bir oyun görüneni değiştirmez
    cv.events.length = 0;
    report(desk, game('Daha Eski', 2 * HOUR));
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE')).toEqual([]);

    laptop.ws.close();
    expect(await last()).toMatchObject({ name: 'Daha Eski' });
    desk.ws.close();
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE').at(-1)).toEqual({ userId: ali.user.id, online: false, status: 'offline', customStatus: null });
    // Yeniden bağlanınca eski etkinlik geri gelmez
    await connect(ali.token);
    expect(await last()).toBeNull();
  });

  it('görünmez kullanıcının etkinliği sızmaz; görünür olunca duyurulur', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const ca = await connect(ali.token);
    await s.req(ali.token, 'PATCH', '/api/me/status', { status: 'invisible' });
    const cv = await connect(veli.token);
    report(ca, game('Gizli Oyun', MIN));
    await cv.settle();
    expect(JSON.stringify(cv.events)).not.toContain('Gizli Oyun');
    expect(s.ctx.gateway.presenceOf(ali.user.id)).toEqual({ status: 'offline', customStatus: null });
    const cv2 = await connect(veli.token);
    expect(JSON.stringify(cv2.ready)).not.toContain('Gizli Oyun');

    await s.req(ali.token, 'PATCH', '/api/me/status', { status: 'online' });
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE').at(-1)).toMatchObject({ status: 'online', activity: { name: 'Gizli Oyun' } });
    // Yeniden görünmez: çevrimdışı duyurusunda etkinlik yok
    await s.req(ali.token, 'PATCH', '/api/me/status', { status: 'invisible' });
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE').at(-1)).toEqual({ userId: ali.user.id, online: false, status: 'offline', customStatus: null });
  });

  it('sel koruması: art arda bildirimler birleştirilir, son hâl uygulanır', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const cv = await connect(veli.token);
    const ca = await connect(ali.token);
    await cv.settle();
    cv.events.length = 0;
    for (let i = 0; i < 40; i++) report(ca, game(`Oyun ${i}`));
    await new Promise((r) => setTimeout(r, 1200));
    const updates = cv.of('PRESENCE_UPDATE');
    expect(updates.length).toBeLessThan(10);
    expect(updates.at(-1)!.activity).toMatchObject({ name: 'Oyun 39' });
  });
});

describe('etkinlik ikonları', () => {
  it('yükleme doğrulanır: oturum, anahtar, özet, PNG, kare, kenar, boyut', async () => {
    const ali = await s.member('ali');
    const icon = await png(64);
    const key = sha(icon);
    expect((await put(null, key, icon)).statusCode).toBe(401);
    expect((await put(ali.token, 'abc', icon)).statusCode).toBe(400);
    expect((await put(ali.token, key.toUpperCase(), icon)).statusCode).toBe(400);
    // Özet uyuşmuyor
    const mismatch = await put(ali.token, sha(Buffer.from('başka')), icon);
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ error: 'hash_mismatch' });
    // Boş gövde, yanlış içerik türü
    expect((await put(ali.token, sha(Buffer.alloc(0)), Buffer.alloc(0))).statusCode).toBe(400);
    expect((await put(ali.token, key, icon, 'application/json')).statusCode).toBe(415);

    const rejected = async (body: Buffer, status: number, error: string): Promise<void> => {
      const res = await put(ali.token, sha(body), body);
      expect(res.statusCode).toBe(status);
      expect(res.json()).toMatchObject({ error });
    };
    // PNG değil (içeriğe bakılır)
    await rejected(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 415, 'unsupported_type');
    await rejected(await sharp(icon).jpeg().toBuffer(), 415, 'unsupported_type');
    // Bozuk yapı: sonunda artık bayt, kesik dosya, tutmayan CRC
    await rejected(Buffer.concat([icon, Buffer.from('<script>')]), 415, 'unsupported_type');
    await rejected(icon.subarray(0, icon.length - 12), 415, 'unsupported_type');
    const corrupt = Buffer.from(icon);
    corrupt[40] = corrupt[40]! ^ 0xff;
    await rejected(corrupt, 415, 'unsupported_type');
    // Kare değil, çok küçük, çok büyük kenar
    await rejected(await png(64, 32), 400, 'invalid_image');
    await rejected(await png(8), 400, 'invalid_image');
    await rejected(await png(256), 400, 'invalid_image');
    // Çok büyük dosya (Fastify gövde sınırı)
    await rejected(Buffer.alloc(ACTIVITY_ICON_MAX_BYTES + 1, 1), 413, 'too_large');
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(s.ctx.activityIcons.count).toBe(0);
  });

  it('yüklenen ikon sunulur; yeniden yükleme dosyaya dokunmaz; ACTIVITY_SET ikonu taşır', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const icon = await png(128);
    const key = sha(icon);
    const url = activityIconPath(key);

    expect((await s.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'HEAD', url })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'GET', url: '/api/activity-icons/..%2F..%2Fdiskort.db' })).statusCode).toBe(404);

    const created = await put(ali.token, key, icon);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ key });
    const file = path.join(dir, `${key}.png`);
    expect(fs.readFileSync(file).equals(icon)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([`${key}.png`]);
    // Aynı ikon (başka kullanıcıdan da) yeniden yazılmaz
    const past = new Date(Date.now() - HOUR);
    fs.utimesSync(file, past, past);
    const again = await put(veli.token, key, icon);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ key });
    expect(Math.abs(fs.statSync(file).mtimeMs - past.getTime())).toBeLessThan(2000);

    // Oturumsuz okunur (resim etiketleri jeton gönderemez)
    const res = await s.app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.rawPayload.equals(icon)).toBe(true);
    const head = await s.app.inject({ method: 'HEAD', url });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-type']).toBe('image/png');
    expect(head.rawPayload.length).toBe(0);
    const cached = await s.app.inject({ method: 'GET', url, headers: { 'if-none-match': res.headers.etag as string } });
    expect(cached.statusCode).toBe(304);

    const cv = await connect(veli.token);
    const ca = await connect(ali.token);
    report(ca, game('Hades', 0, key));
    await cv.settle();
    expect(cv.of('PRESENCE_UPDATE').at(-1)!.activity).toMatchObject({ name: 'Hades', icon: key });
  });

  it('kullanıcı başına yükleme sınırı yalnızca yeni ikonları sayar', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const icons = await Promise.all(Array.from({ length: 31 }, (_, i) => png(16, 16, `rgb(${i * 8}, 10, 200)`)));
    expect(new Set(icons.map(sha)).size).toBe(31);
    for (const icon of icons.slice(0, 30)) expect((await put(ali.token, sha(icon), icon)).statusCode).toBe(201);
    const limited = await put(ali.token, sha(icons[30]!), icons[30]!);
    expect(limited.statusCode).toBe(429);
    // Var olanı yeniden göndermek ve başka kullanıcı sınıra takılmaz
    expect((await put(ali.token, sha(icons[0]!), icons[0]!)).statusCode).toBe(200);
    expect((await put(veli.token, sha(icons[30]!), icons[30]!)).statusCode).toBe(201);
  });

  it('depo: toplam ikon sınırı, açılışta var olanları tanır, yarım dosyaları siler', async () => {
    const a = await png(16, 16, '#ff0000');
    const b = await png(16, 16, '#00ff00');
    const c = await png(16, 16, '#0000ff');
    const store = new ActivityIconStore(dir, 2);
    expect(await store.save(sha(a), a)).toBe(true);
    expect(await store.save(sha(b), b)).toBe(true);
    await expect(store.save(sha(c), c)).rejects.toMatchObject({ status: 507, code: 'storage_full' });
    // Dolu depoda var olan ikon yine başarılıdır
    expect(await store.save(sha(a), a)).toBe(false);
    expect(store.has(sha(c))).toBe(false);
    expect(store.pathOf(sha(c))).toBeNull();

    fs.writeFileSync(path.join(dir, '0123456789abcdef.tmp'), 'yarım');
    fs.writeFileSync(path.join(dir, 'notlar.txt'), 'bize ait değil');
    const reopened = new ActivityIconStore(dir);
    expect(reopened.count).toBe(2);
    expect(reopened.has(sha(a))).toBe(true);
    expect(reopened.pathOf(sha(b))).toBe(path.join(dir, `${sha(b)}.png`));
    expect(fs.readdirSync(dir).sort()).toEqual([`${sha(a)}.png`, `${sha(b)}.png`, 'notlar.txt'].sort());
  });

  it('PNG yapısı: boyutlar okunur, bozuk başlık reddedilir', async () => {
    const icon = await png(48);
    expect(inspectPng(icon)).toEqual({ width: 48, height: 48 });
    expect(inspectPng(await png(20, 30))).toEqual({ width: 20, height: 30 });
    expect(inspectPng(Buffer.alloc(0))).toBeNull();
    expect(inspectPng(icon.subarray(0, 8))).toBeNull();
    expect(inspectPng(icon.subarray(0, 33))).toBeNull();
    // IEND'siz: imza + IHDR + IDAT
    expect(inspectPng(icon.subarray(0, icon.length - 12))).toBeNull();
  });
});
