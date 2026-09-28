import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CosmeticsCatalog, User } from '@diskort/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { CosmeticsService, defaultCosmeticsDir } from '../src/cosmetics.js';

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

describe('kozmetik kataloğu', () => {
  it('depodaki tasarımlar katalogda: kimlik, Türkçe ad, sürümlü adres', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cosmetics' });
    expect(res.statusCode).toBe(200);
    const catalog = res.json() as CosmeticsCatalog;
    expect(catalog.decorations.length).toBeGreaterThanOrEqual(8);
    expect(catalog.frames.length).toBeGreaterThanOrEqual(4);
    for (const item of [...catalog.decorations, ...catalog.frames]) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.url).toMatch(/^\/api\/cosmetics\/(decorations|frames)\/[a-z0-9-]+\.webp\?v=[0-9a-f]{12}$/);
    }
    // Her SVG manifestte (unutulan dosya kalmasın)
    const dir = defaultCosmeticsDir();
    for (const kind of ['decorations', 'frames'] as const) {
      const files = fs.readdirSync(path.join(dir, kind)).map((f) => f.replace(/\.svg$/, '')).sort();
      expect(catalog[kind].map((i) => i.id).sort()).toEqual(files);
    }
  });

  it('resimler saydam, kare WebP (dekorasyon 240, çerçeve 480); önbellek başlıkları ve 304', async () => {
    const catalog = (await app.inject({ method: 'GET', url: '/api/cosmetics' })).json() as CosmeticsCatalog;
    for (const [items, size] of [
      [catalog.decorations, 240],
      [catalog.frames, 480],
    ] as const) {
      for (const item of items) {
        const res = await app.inject({ method: 'GET', url: item.url });
        expect(res.statusCode, item.url).toBe(200);
        expect(res.headers['content-type']).toBe('image/webp');
        expect(res.headers['cache-control']).toContain('immutable');
        const meta = await sharp(res.rawPayload).metadata();
        expect(meta).toMatchObject({ format: 'webp', width: size, height: size, hasAlpha: true });
        // Orta saydam: avatarın ve kartın içeriği görünür
        const { data, info } = await sharp(res.rawPayload).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const center = ((info.height / 2) * info.width + info.width / 2) * 4 + 3;
        expect(data[center], item.id).toBe(0);

        const again = await app.inject({ method: 'GET', url: item.url, headers: { 'if-none-match': res.headers.etag as string } });
        expect(again.statusCode).toBe(304);
      }
    }
  });

  it('bilinmeyen tasarım 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/cosmetics/decorations/yok.webp' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/cosmetics/frames/neon.png' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/cosmetics/decorations/..%2Fmanifest.webp' })).statusCode).toBe(404);
  });

  it('klasör yoksa katalog boş, sunucu açılır', () => {
    const empty = new CosmeticsService(path.join(os.tmpdir(), 'diskort-kozmetik-yok'));
    expect(empty.catalog).toEqual({ decorations: [], frames: [] });
    expect(empty.has('decorations', 'neon')).toBe(false);
  });

  it('dekorasyon ve çerçeve kaydedilir; katalogda olmayan reddedilir, null kaldırır', async () => {
    const { token } = await member();
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: '/api/me', headers: auth(token), payload });
    const [decoration] = ctx.cosmetics.catalog.decorations;
    const [frame] = ctx.cosmetics.catalog.frames;

    const ok = await patch({ avatarDecoration: decoration!.id, profileFrame: frame!.id });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ avatarDecoration: decoration!.id, profileFrame: frame!.id });

    expect((await patch({ avatarDecoration: 'olmayan' })).statusCode).toBe(400);
    expect((await patch({ profileFrame: 'olmayan' })).statusCode).toBe(400);
    expect((await patch({ avatarDecoration: 'Büyük Harf' })).statusCode).toBe(400);
    // Dekorasyon kimliği çerçeve olarak geçmez (yalnızca ikisinde de varsa)
    const onlyDecoration = ctx.cosmetics.catalog.decorations.find((d) => !ctx.cosmetics.has('frames', d.id));
    if (onlyDecoration) expect((await patch({ profileFrame: onlyDecoration.id })).statusCode).toBe(400);

    // Yalnızca verilen alan değişir
    expect((await patch({ displayName: 'Üye' })).json()).toMatchObject({ avatarDecoration: decoration!.id });
    const cleared = (await patch({ avatarDecoration: null, profileFrame: null })).json() as User;
    expect(cleared.avatarDecoration).toBeNull();
    expect(cleared.profileFrame).toBeNull();
  });
});
