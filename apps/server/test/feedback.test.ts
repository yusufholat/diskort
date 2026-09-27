import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FEEDBACK_PER_HOUR, Permission as P, type Feedback, type FeedbackScreenshot } from '@diskort/shared';
import { buildApp } from '../src/app.js';
import { auth, config, connectGateway, startServer, type Account, type TestServer } from './helpers.js';

let s: TestServer;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-feedback-'));
  s = await startServer({ feedbackDir: dir });
});

afterEach(async () => {
  await s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const send = (token: string, body: Record<string, unknown>) => s.req(token, 'POST', '/api/feedback', body);

const png = (width = 320, height = 200, color = '#3366ff') =>
  sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();

const uploadShot = (token: string | null, body: Buffer, contentType = 'image/png') =>
  s.app.inject({
    method: 'POST',
    url: '/api/feedback/screenshots',
    headers: { ...(token ? auth(token) : {}), 'content-type': contentType },
    payload: body,
  });

const getShot = (token: string | null, id: string) =>
  s.app.inject({ method: 'GET', url: `/api/feedback/screenshots/${id}`, headers: token ? auth(token) : {} });

async function manager(): Promise<Account> {
  const account = await s.member('yonetici');
  const role = await s.createRole(s.owner.token, { name: 'Sunucu Yöneticisi', permissions: P.MANAGE_GUILD });
  expect(await s.giveRole(s.owner.token, account.user.id, role.id)).toBe(200);
  return account;
}

describe('geri bildirim gönderme', () => {
  it('her üye gönderebilir; teknik bilgilerdeki bilinmeyen alanlar atılır, uzun değerler kısaltılır', async () => {
    const member = await s.member('uye');
    const res = await send(member.token, {
      type: 'hata',
      title: '  Ses kopuyor ',
      body: 'Kanala girince ses gidiyor.',
      context: {
        platform: 'desktop',
        appVersion: '0.4.3',
        os: 'win32',
        osVersion: '10.0.26200',
        screen: '1920×1080 @1.25x',
        view: 'metin kanalı',
        token: 'gizli-olmamali',
        recentErrors: ['x'.repeat(1000), ...Array.from({ length: 14 }, (_, i) => `hata ${i}`)],
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json() as Feedback;
    expect(created).toMatchObject({
      userId: member.user.id,
      type: 'hata',
      title: 'Ses kopuyor',
      body: 'Kanala girince ses gidiyor.',
      status: 'yeni',
      adminNote: null,
      screenshots: [],
    });
    expect(created.context).not.toHaveProperty('token');
    expect(created.context!.recentErrors).toHaveLength(10);
    expect(created.context!.recentErrors!.at(-1)).toBe('hata 13');

    // Başlık ve teknik bilgiler isteğe bağlı
    const plain = (await send(member.token, { type: 'oneri', body: 'Karanlık tema daha koyu olsun' })).json() as Feedback;
    expect(plain).toMatchObject({ title: null, context: null, type: 'oneri' });

    // Kendi listesi, en yeni önce
    const mine = (await s.req(member.token, 'GET', '/api/feedback/mine')).json() as Feedback[];
    expect(mine.map((f) => f.id)).toEqual([plain.id, created.id]);
  });

  it('geçersiz istekler reddedilir', async () => {
    const member = await s.member('uye');
    expect((await send(member.token, { type: 'hata' })).statusCode).toBe(400);
    expect((await send(member.token, { type: 'hata', body: '   ' })).statusCode).toBe(400);
    expect((await send(member.token, { type: 'sikayet', body: 'x' })).statusCode).toBe(400);
    expect((await send(member.token, { type: 'hata', body: 'x'.repeat(4001) })).statusCode).toBe(400);
    expect((await send(member.token, { type: 'hata', title: 'x'.repeat(121), body: 'x' })).statusCode).toBe(400);
    const ids = Array.from({ length: 4 }, (_, i) => String(i).repeat(32));
    expect((await send(member.token, { type: 'hata', body: 'x', screenshotIds: ids })).statusCode).toBe(400);
    expect((await send(member.token, { type: 'hata', body: 'x', screenshotIds: ['../etc'] })).statusCode).toBe(400);
    // Oturumsuz gönderilemez
    const anon = await s.app.inject({ method: 'POST', url: '/api/feedback', payload: { type: 'hata', body: 'x' } });
    expect(anon.statusCode).toBe(401);
    // 4000 karakter sınırında kabul edilir
    expect((await send(member.token, { type: 'diger', body: 'ç'.repeat(4000) })).statusCode).toBe(201);
  });

  it(`saatte en fazla ${FEEDBACK_PER_HOUR} geri bildirim; sınır kullanıcı başınadır`, async () => {
    const a = await s.member('ayse');
    const b = await s.member('bora');
    for (let i = 0; i < FEEDBACK_PER_HOUR; i++) {
      expect((await send(a.token, { type: 'oneri', body: `öneri ${i}` })).statusCode).toBe(201);
    }
    const limited = await send(a.token, { type: 'oneri', body: 'bir tane daha' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe('rate_limited');
    expect((await send(b.token, { type: 'oneri', body: 'benimki' })).statusCode).toBe(201);

    // Bir saat önceki gönderimler sayılmaz
    s.ctx.store.db.prepare('UPDATE feedback SET created_at = created_at - ? WHERE user_id = ?').run(61 * 60_000, a.user.id);
    expect((await send(a.token, { type: 'oneri', body: 'saat geçti' })).statusCode).toBe(201);
  });
});

describe('yönetim yetkileri', () => {
  it('liste, durum, not ve silme yalnızca Sunucuyu Yönet (ya da Yönetici) yetkisiyle', async () => {
    const member = await s.member('uye');
    const other = await s.member('diger');
    const mod = await manager();
    const created = (await send(member.token, { type: 'hata', body: 'Çöküyor' })).json() as Feedback;
    await send(other.token, { type: 'oneri', body: 'Tema' });

    for (const token of [member.token, other.token]) {
      expect((await s.req(token, 'GET', '/api/feedback')).statusCode).toBe(403);
      expect((await s.req(token, 'GET', '/api/feedback/stats')).statusCode).toBe(403);
      expect((await s.req(token, 'PATCH', `/api/feedback/${created.id}`, { status: 'tamamlandi' })).statusCode).toBe(403);
      expect((await s.req(token, 'DELETE', `/api/feedback/${created.id}`)).statusCode).toBe(403);
    }
    // Gönderen kendi geri bildirimini görür, başkası göremez
    expect((await s.req(member.token, 'GET', `/api/feedback/${created.id}`)).statusCode).toBe(200);
    expect((await s.req(other.token, 'GET', `/api/feedback/${created.id}`)).statusCode).toBe(404);
    expect(((await s.req(other.token, 'GET', '/api/feedback/mine')).json() as Feedback[]).map((f) => f.body)).toEqual([
      'Tema',
    ]);

    // Sahip (Yönetici) ve Sunucuyu Yönet yetkilisi hepsini görür; süzme ve sıralama
    for (const token of [s.owner.token, mod.token]) {
      const all = (await s.req(token, 'GET', '/api/feedback')).json() as Feedback[];
      expect(all.map((f) => f.body)).toEqual(['Tema', 'Çöküyor']);
    }
    expect(((await s.req(mod.token, 'GET', '/api/feedback?type=hata')).json() as Feedback[]).map((f) => f.id)).toEqual([
      created.id,
    ]);
    expect((await s.req(mod.token, 'GET', '/api/feedback?status=bilinmeyen')).statusCode).toBe(400);

    const patched = await s.req(mod.token, 'PATCH', `/api/feedback/${created.id}`, {
      status: 'planlandi',
      adminNote: ' 0.4.5 ile gelecek ',
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ status: 'planlandi', adminNote: '0.4.5 ile gelecek' });
    expect((await s.req(mod.token, 'PATCH', `/api/feedback/${created.id}`, { status: 'bitti' })).statusCode).toBe(400);
    expect((await s.req(mod.token, 'PATCH', `/api/feedback/${created.id}`, {})).statusCode).toBe(400);
    expect((await s.req(mod.token, 'PATCH', '/api/feedback/9999', { status: 'incelendi' })).statusCode).toBe(404);
    // Boş not silinir
    expect((await s.req(mod.token, 'PATCH', `/api/feedback/${created.id}`, { adminNote: '' })).json().adminNote).toBeNull();

    // Gönderen yeni durumu kendi listesinde görür
    expect(((await s.req(member.token, 'GET', '/api/feedback/mine')).json() as Feedback[])[0]!.status).toBe('planlandi');
    expect((await s.req(s.owner.token, 'GET', '/api/feedback/stats')).json().counts).toMatchObject({
      yeni: 1,
      planlandi: 1,
      tamamlandi: 0,
    });

    expect((await s.req(s.owner.token, 'DELETE', `/api/feedback/${created.id}`)).statusCode).toBe(204);
    expect((await s.req(member.token, 'GET', `/api/feedback/${created.id}`)).statusCode).toBe(404);
    expect((await s.req(s.owner.token, 'DELETE', `/api/feedback/${created.id}`)).statusCode).toBe(404);
  });

  it('hesap silinince geri bildirim kalır, gönderen null olur', async () => {
    const member = await s.member('uye');
    const created = (await send(member.token, { type: 'hata', body: 'x' })).json() as Feedback;
    expect((await s.req(s.owner.token, 'DELETE', `/api/users/${member.user.id}`)).statusCode).toBe(204);
    const item = (await s.req(s.owner.token, 'GET', `/api/feedback/${created.id}`)).json() as Feedback;
    expect(item.userId).toBeNull();
  });
});

describe('ekran görüntüleri', () => {
  it('WebP olarak saklanır; yalnızca yetkililer ve gönderen alabilir', async () => {
    const member = await s.member('uye');
    const other = await s.member('diger');
    const mod = await manager();

    const up = await uploadShot(member.token, await png(3000, 1500));
    expect(up.statusCode).toBe(201);
    const shot = up.json() as FeedbackScreenshot;
    // En uzun kenar 2560'a küçültülür
    expect(shot).toMatchObject({ width: 2560, height: 1280, url: `/api/feedback/screenshots/${shot.id}` });
    expect(fs.existsSync(path.join(dir, `${shot.id}.webp`))).toBe(true);

    // Gönderilmeden önce yalnızca yükleyen görür
    expect((await getShot(member.token, shot.id)).statusCode).toBe(200);
    expect((await getShot(other.token, shot.id)).statusCode).toBe(404);

    // Başkası bu kimliği kendi geri bildirimine ekleyemez
    expect((await send(other.token, { type: 'hata', body: 'x', screenshotIds: [shot.id] })).statusCode).toBe(400);

    const created = (
      await send(member.token, { type: 'hata', body: 'Ekranda hata', screenshotIds: [shot.id] })
    ).json() as Feedback;
    expect(created.screenshots.map((x) => x.id)).toEqual([shot.id]);
    // Aynı resim ikinci kez kullanılamaz
    expect((await send(member.token, { type: 'hata', body: 'x', screenshotIds: [shot.id] })).statusCode).toBe(400);

    // Kimlik doğrulaması şart: adresi bilmek yetmez
    expect((await getShot(null, shot.id)).statusCode).toBe(401);
    expect((await getShot(other.token, shot.id)).statusCode).toBe(404);
    for (const token of [member.token, mod.token, s.owner.token]) {
      const res = await getShot(token, shot.id);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.headers['cache-control']).toContain('private');
      expect(res.rawPayload.subarray(8, 12).toString('latin1')).toBe('WEBP');
    }
    expect((await getShot(member.token, 'f'.repeat(32))).statusCode).toBe(404);
    expect((await getShot(member.token, '..%2F..%2Fdiskort.db')).statusCode).toBe(404);

    // Silinince dosya da gider
    expect((await s.req(mod.token, 'DELETE', `/api/feedback/${created.id}`)).statusCode).toBe(204);
    expect(fs.existsSync(path.join(dir, `${shot.id}.webp`))).toBe(false);
    expect((await getShot(member.token, shot.id)).statusCode).toBe(404);
  });

  it('resim olmayan, bozuk ve çok büyük dosyalar reddedilir', async () => {
    const member = await s.member('uye');
    expect((await uploadShot(member.token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).statusCode).toBe(415);
    expect((await uploadShot(member.token, Buffer.alloc(0))).statusCode).toBe(400);
    const broken = Buffer.concat([(await png()).subarray(0, 40), Buffer.alloc(100)]);
    expect((await uploadShot(member.token, broken)).statusCode).toBe(400);
    expect((await uploadShot(member.token, Buffer.alloc(13 * 1024 * 1024, 1))).statusCode).toBe(413);
    expect((await uploadShot(null, await png())).statusCode).toBe(401);
    expect(fs.readdirSync(dir).filter((f) => !f.endsWith('.webp'))).toEqual([]);
  });

  it('gönderilmeyen eski ekran görüntüleri temizlenir', async () => {
    const member = await s.member('uye');
    const shot = (await uploadShot(member.token, await png())).json() as FeedbackScreenshot;
    const used = (await uploadShot(member.token, await png(100, 100, '#ff0000'))).json() as FeedbackScreenshot;
    await send(member.token, { type: 'hata', body: 'x', screenshotIds: [used.id] });
    s.ctx.store.db.prepare('UPDATE feedback_screenshots SET created_at = created_at - ?').run(2 * 60 * 60_000);
    // Sweep'i doğrudan çağırmak için servis yeniden kurulur (aynı veritabanı ve klasör)
    const { FeedbackService } = await import('../src/feedback.js');
    const { FeedbackStore } = await import('../src/feedbackStore.js');
    const service = new FeedbackService(new FeedbackStore(s.ctx.store.db), dir);
    expect(await service.sweep()).toBe(1);
    expect(fs.existsSync(path.join(dir, `${shot.id}.webp`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${used.id}.webp`))).toBe(true);
  });
});

describe('gateway', () => {
  it('yeni geri bildirim yetkililere, durum değişikliği gönderene de iletilir', async () => {
    await s.app.listen({ port: 0, host: '127.0.0.1' });
    const member = await s.member('uye');
    const other = await s.member('diger');
    const mod = await manager();
    const gMember = await connectGateway(s.app, member.token);
    const gOther = await connectGateway(s.app, other.token);
    const gMod = await connectGateway(s.app, mod.token);
    const gOwner = await connectGateway(s.app, s.owner.token);
    const created = (await send(member.token, { type: 'oneri', body: 'Yeni fikir' })).json() as Feedback;
    await s.req(mod.token, 'PATCH', `/api/feedback/${created.id}`, { status: 'tamamlandi' });
    await gMod.settle();

    expect(gMod.of('FEEDBACK_CREATE').map((f) => f.id)).toEqual([created.id]);
    expect(gOwner.of('FEEDBACK_CREATE').map((f) => f.id)).toEqual([created.id]);
    expect(gMember.of('FEEDBACK_CREATE')).toEqual([]);
    expect(gOther.of('FEEDBACK_CREATE')).toEqual([]);

    expect(gMember.of('FEEDBACK_UPDATE').map((f) => f.status)).toEqual(['tamamlandi']);
    expect(gMod.of('FEEDBACK_UPDATE')).toHaveLength(1);
    expect(gOther.of('FEEDBACK_UPDATE')).toEqual([]);
    for (const g of [gMember, gOther, gMod, gOwner]) g.ws.close();
  });
});

describe('komut satırı aracı', () => {
  it('list, show, set ve note', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-feedback-cli-'));
    try {
      const { app, ctx } = await buildApp(config, {
        dbFile: path.join(dataDir, 'diskort.db'),
        logger: false,
        feedbackDir: path.join(dataDir, 'feedback'),
      });
      const register = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { inviteCode: ctx.store.ensureBootstrapInvite()!.code, username: 'ali', password: 'sifre12345' },
      });
      const token = register.json().token as string;
      await app.inject({
        method: 'POST',
        url: '/api/feedback',
        headers: auth(token),
        payload: { type: 'hata', title: 'Ses', body: 'Ses kopuyor', context: { platform: 'desktop', recentErrors: ['boom'] } },
      });
      await app.close();

      const cli = (...args: string[]) =>
        spawnSync(process.execPath, ['--import', 'tsx', 'src/feedback-cli.ts', ...args], {
          cwd: path.resolve(import.meta.dirname, '..'),
          env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATA_DIR: dataDir },
          encoding: 'utf8',
        });

      const list = cli('list', '--status', 'yeni', '--json');
      expect(list.status).toBe(0);
      const items = JSON.parse(list.stdout) as (Feedback & { username: string })[];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: 1, username: 'ali', title: 'Ses', status: 'yeni' });

      const text = cli('list');
      expect(text.stdout).toMatch(/#1\s+yeni\s+hata/);
      expect(text.stdout).toContain('@ali');

      const show = cli('show', '1');
      expect(show.stdout).toContain('Ses kopuyor');
      expect(show.stdout).toContain('boom');

      expect(cli('set', '1', 'planlandi', '0.4.5', 'ile').status).toBe(0);
      const after = JSON.parse(cli('show', '1', '--json').stdout) as Feedback;
      expect(after).toMatchObject({ status: 'planlandi', adminNote: '0.4.5 ile' });
      expect(cli('note', '1', '').status).toBe(0);
      expect((JSON.parse(cli('show', '#1', '--json').stdout) as Feedback).adminNote).toBeNull();

      const bad = cli('set', '1', 'bitti');
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('Geçersiz durum');
      expect(cli('show', '99').status).toBe(1);
      expect(cli('list', '--status', 'yeni').stdout).toContain('Geri bildirim yok.');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});
