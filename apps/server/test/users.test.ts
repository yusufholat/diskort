import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';

const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: '.' });

let app: FastifyInstance;
let ctx: AppContext;

beforeEach(async () => {
  ({ app, ctx } = await buildApp(config, { dbFile: ':memory:', logger: false }));
});

afterEach(async () => {
  await app.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Yönetici + bir üye oluşturur. */
async function setup() {
  const bootstrap = ctx.store.ensureBootstrapInvite()!;
  const admin = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: bootstrap.code, username: 'admin', password: 'sifre12345' },
    })
  ).json();
  const code = (
    await app.inject({ method: 'POST', url: `/api/guilds/${ctx.guild.id}/invites`, headers: auth(admin.token), payload: {} })
  ).json().code as string;
  const member = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: code, username: 'uye', password: 'eskisifre1' },
    })
  ).json();
  return { admin, member } as { admin: { token: string; user: { id: string } }; member: { token: string; user: { id: string } } };
}

/** Oturum jetonlarının saniye hassasiyetinde olması nedeniyle bir sonraki saniyeyi bekler. */
const nextSecond = () => new Promise((r) => setTimeout(r, 1100 - (Date.now() % 1000)));

describe('şifre sıfırlama', () => {
  it('yönetici kod üretir, üye kodla yeni şifre belirler; kod tek kullanımlıktır ve eski oturum kapanır', async () => {
    const { admin, member } = await setup();
    const reset = await app.inject({
      method: 'POST',
      url: `/api/users/${member.user.id}/reset-code`,
      headers: auth(admin.token),
    });
    expect(reset.statusCode).toBe(200);
    const { code, expiresAt } = reset.json();
    expect(expiresAt).toBeGreaterThan(Date.now() + 23 * 3_600_000);

    await nextSecond();
    const wrongUser = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { username: 'admin', code, newPassword: 'yenisifre1' },
    });
    expect(wrongUser.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { username: 'UYE', code: code.toLowerCase(), newPassword: 'yenisifre1' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.username).toBe('uye');

    // Kod ikinci kez kullanılamaz
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { username: 'uye', code, newPassword: 'baskasifre1' },
    });
    expect(again.statusCode).toBe(400);

    // Eski oturum jetonu geçersiz, yenisi geçerli
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(member.token) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(ok.json().token) })).statusCode).toBe(200);

    // Eski şifreyle giriş reddedilir, yenisiyle kabul edilir
    const login = (password: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'uye', password } });
    expect((await login('eskisifre1')).statusCode).toBe(401);
    expect((await login('yenisifre1')).statusCode).toBe(200);
  });

  it('süresi dolmuş kod kabul edilmez; üye kod üretemez', async () => {
    const { admin, member } = await setup();
    const { code } = ctx.store.createResetCode(member.user.id, admin.user.id, -1000);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { username: 'uye', code, newPassword: 'yenisifre1' },
    });
    expect(res.statusCode).toBe(400);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/users/${admin.user.id}/reset-code`,
      headers: auth(member.token),
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe('şifre değiştirme', () => {
  it('mevcut şifre doğrulanır; değişince eski jeton geçersiz, dönen yeni jeton geçerli olur', async () => {
    const { member } = await setup();
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/me/password',
      headers: auth(member.token),
      payload: { currentPassword: 'yanlis', newPassword: 'yenisifre1' },
    });
    expect(wrong.statusCode).toBe(400);

    await nextSecond();
    const ok = await app.inject({
      method: 'POST',
      url: '/api/me/password',
      headers: auth(member.token),
      payload: { currentPassword: 'eskisifre1', newPassword: 'yenisifre1' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(member.token) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(ok.json().token) })).statusCode).toBe(200);
  });
});

describe('üye yönetimi', () => {
  it('hesap davetlerini yalnızca hesap yöneticisi yönetir; hesap davetiyle gelen hiçbir sunucuya katılmaz', async () => {
    const { admin, member } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/invites', headers: auth(member.token), payload: {} })).statusCode).toBe(
      403,
    );
    const created = await app.inject({ method: 'POST', url: '/api/invites', headers: auth(admin.token), payload: { maxUses: 1 } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ guildId: null, maxUses: 1 });
    const list = await app.inject({ method: 'GET', url: '/api/invites', headers: auth(admin.token) });
    expect(list.json().map((i: { code: string }) => i.code)).toEqual([created.json().code]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: created.json().code, username: 'yeni', password: 'sifre12345' },
    });
    expect(res.statusCode).toBe(201);
    expect(ctx.store.userGuildIds(res.json().user.id)).toEqual([]);
    // Hesap daveti sunucuya katılmak için kullanılamaz
    const other = await app.inject({ method: 'POST', url: '/api/invites', headers: auth(admin.token), payload: {} });
    const join = await app.inject({
      method: 'POST',
      url: `/api/invites/${other.json().code}/accept`,
      headers: auth(res.json().token),
    });
    expect(join.statusCode).toBe(400);
    // Önizleme: sunucusu olmayan davet
    const preview = await app.inject({ method: 'GET', url: `/api/invites/${other.json().code}` });
    expect(preview.json()).toMatchObject({ guild: null, memberCount: 0 });
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/invites/${other.json().code}`, headers: auth(admin.token) })).statusCode,
    ).toBe(204);
  });

  it('silinen üyenin oturumu ve ses durumu kalkar; yönetici kendini silemez', async () => {
    const { admin, member } = await setup();
    const channel = ctx.store.listChannels(ctx.guild.id).find((c) => c.type === 'voice')!;
    ctx.voice.join(member.user.id, channel.id);

    expect(
      (await app.inject({ method: 'DELETE', url: `/api/users/${admin.user.id}`, headers: auth(admin.token) }))
        .statusCode,
    ).toBe(400);

    const del = await app.inject({ method: 'DELETE', url: `/api/users/${member.user.id}`, headers: auth(admin.token) });
    expect(del.statusCode).toBe(204);
    expect(ctx.voice.get(member.user.id)).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(member.token) })).statusCode).toBe(401);
    expect(ctx.store.getUser(member.user.id)).toBeNull();
  });

  it('kullanıcı şifresini onaylayarak kendi hesabını siler; sunucunun sahibi silemez', async () => {
    const { admin, member } = await setup();
    const del = (token: string, password: string) =>
      app.inject({ method: 'DELETE', url: '/api/me', headers: auth(token), payload: { password } });

    expect((await del(member.token, 'yanlis')).statusCode).toBe(400);
    expect(ctx.store.getUser(member.user.id)).not.toBeNull();

    const owner = await del(admin.token, 'sifre12345');
    expect(owner.statusCode).toBe(400);
    expect(owner.json().error).toBe('owner');

    expect((await del(member.token, 'eskisifre1')).statusCode).toBe(204);
    expect(ctx.store.getUser(member.user.id)).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(member.token) })).statusCode).toBe(401);
  });

  it('sesten çıkarma yalnızca bu sunucuda seste olan üye için çalışır', async () => {
    const { admin, member } = await setup();
    const kick = () =>
      app.inject({
        method: 'PATCH',
        url: `/api/guilds/${ctx.guild.id}/members/${member.user.id}/voice`,
        headers: auth(admin.token),
        payload: { channelId: null },
      });
    expect((await kick()).statusCode).toBe(400);
    ctx.voice.join(member.user.id, ctx.store.listChannels(ctx.guild.id).find((c) => c.type === 'voice')!.id);
    expect((await kick()).statusCode).toBe(204);
    expect(ctx.voice.get(member.user.id)).toBeUndefined();
  });
});
