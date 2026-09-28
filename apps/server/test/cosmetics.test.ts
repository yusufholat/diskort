import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { User } from '@diskort/shared';
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

async function member(): Promise<{ token: string; user: User }> {
  const bootstrap = ctx.store.ensureBootstrapInvite()!;
  return (
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: bootstrap.code, username: 'uye', password: 'sifre12345' },
    })
  ).json() as { token: string; user: User };
}

describe('eski kozmetik kataloğu (0.8.x istemciler için)', () => {
  it('katalog boş ama iki anahtar da var; eski resim adresleri 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cosmetics' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ decorations: [], frames: [] });

    for (const url of [
      '/api/cosmetics/decorations/crown.webp?v=0123456789ab',
      '/api/cosmetics/frames/gold.webp?v=0123456789ab',
      '/api/cosmetics/decorations/yok.png',
      '/api/cosmetics/decorations/..%2Fmanifest.webp',
    ]) {
      const image = await app.inject({ method: 'GET', url });
      expect(image.statusCode, url).toBe(404);
      expect(image.json()).toMatchObject({ error: 'not_found' });
    }
  });

  it('kullanıcıda eski kozmetik alanları her zaman null gider', async () => {
    const { user } = await member();
    expect(user).toMatchObject({ profileEffect: null, profileFrame: null, animatedEffect: null, avatarDecoration: null });
  });
});

describe('hareketli setler ve eski değerler (PATCH /api/me)', () => {
  it('hareketli set parçaları: efekt animatedEffect\'te döner, anim: dekorasyonu ve isim plakası kaydedilir', async () => {
    const { token } = await member();
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: '/api/me', headers: auth(token), payload });

    const ok = await patch({ profileEffect: 'karadelik', avatarDecoration: 'anim:sakura', nameplate: 'neon' });
    expect(ok.statusCode).toBe(200);
    // Eski istemciler tanımadıkları efekt kimliğinde çöker: profileEffect hep null
    expect(ok.json()).toMatchObject({
      profileEffect: null,
      animatedEffect: 'karadelik',
      avatarDecoration: 'anim:sakura',
      nameplate: 'neon',
      profileFrame: null,
    });

    expect((await patch({ profileEffect: 'fireworks' })).statusCode).toBe(400);
    expect((await patch({ avatarDecoration: 'anim:olmayan' })).statusCode).toBe(400);
    expect((await patch({ avatarDecoration: 'anim:' })).statusCode).toBe(400);
    expect((await patch({ avatarDecoration: 'Büyük Harf' })).statusCode).toBe(400);
    expect((await patch({ profileFrame: 'Büyük Harf' })).statusCode).toBe(400);
    expect((await patch({ nameplate: 'olmayan' })).statusCode).toBe(400);
    expect((await patch({ nameplate: 'anim:neon' })).statusCode).toBe(400);

    // Yalnızca verilen alan değişir; null kaldırır
    expect((await patch({ displayName: 'Üye' })).json()).toMatchObject({ nameplate: 'neon', avatarDecoration: 'anim:sakura' });
    const cleared = (await patch({ nameplate: null, avatarDecoration: null, profileEffect: null })).json() as User;
    expect(cleared).toMatchObject({ nameplate: null, avatarDecoration: null, profileEffect: null, animatedEffect: null });
  });

  it('eski istemcilerin gönderdiği kaldırılmış değerler kabul edilir ama yazılmaz; diğer alanlar kaydedilir', async () => {
    const { token, user } = await member();
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: '/api/me', headers: auth(token), payload });
    await patch({ profileEffect: 'buz', avatarDecoration: 'anim:neon' });

    for (const effect of ['snow', 'sparkles', 'petals']) {
      const res = await patch({ profileEffect: effect, avatarDecoration: 'crown', profileFrame: 'gold', displayName: `Üye ${effect}` });
      expect(res.statusCode, effect).toBe(200);
      // Bugünkü seçim olduğu gibi kalır
      expect(res.json()).toMatchObject({
        displayName: `Üye ${effect}`,
        profileEffect: null,
        animatedEffect: 'buz',
        avatarDecoration: 'anim:neon',
        profileFrame: null,
      });
    }
    // Çerçeveyi kaldırmak (null) da zararsız
    expect((await patch({ profileFrame: null })).statusCode).toBe(200);

    const row = ctx.store.db
      .prepare('SELECT profile_effect, avatar_decoration, profile_frame FROM users WHERE id = ?')
      .get(user.id);
    expect(row).toEqual({ profile_effect: 'buz', avatar_decoration: 'anim:neon', profile_frame: null });
  });
});
