import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { pickAssets, ReleaseService } from '../src/releases.js';

const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: '.' });

const githubRelease = {
  tag_name: 'v0.2.0',
  published_at: '2026-09-26T16:00:00Z',
  assets: [
    { name: 'Diskort-Setup-0.2.0.exe', size: 1000, browser_download_url: 'https://example.test/Diskort-Setup-0.2.0.exe' },
    { name: 'Diskort-Setup-0.2.0.exe.blockmap', size: 10, browser_download_url: 'https://example.test/x.blockmap' },
    { name: 'latest.yml', size: 5, browser_download_url: 'https://example.test/latest.yml' },
    { name: 'Diskort-0.2.0-x86_64.AppImage', size: 2000, browser_download_url: 'https://example.test/app.AppImage' },
  ],
};

function fakeFetch(responses: Array<{ ok: boolean; body?: unknown } | Error>) {
  let calls = 0;
  const fn = (async () => {
    const r = responses[Math.min(calls++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return { ok: r.ok, status: r.ok ? 200 : 500, json: async () => r.body } as Response;
  }) as typeof fetch;
  return { fn, calls: () => calls };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('sürüm dosyası eşleştirme', () => {
  it('kurulum dosyalarını platformlara ayırır, blockmap/yml dosyalarını atlar', () => {
    const assets = pickAssets(githubRelease.assets);
    expect(assets.windows?.name).toBe('Diskort-Setup-0.2.0.exe');
    expect(assets['linux-appimage']?.name).toBe('Diskort-0.2.0-x86_64.AppImage');
    expect(assets['linux-deb']).toBeUndefined();
    expect(assets.mac).toBeUndefined();
  });

  it('GitHub geçici olarak ulaşılamazsa son bilinen sürümü kullanır', async () => {
    const fake = fakeFetch([{ ok: true, body: githubRelease }, new Error('ağ hatası')]);
    const service = new ReleaseService('x/y', fake.fn);
    expect((await service.latest())?.version).toBe('0.2.0');
    // Önbellek süresi dolmuş gibi davran
    (service as unknown as { cache: { at: number } }).cache.at = 0;
    expect((await service.latest())?.version).toBe('0.2.0');
    expect(fake.calls()).toBe(2);
  });
});

describe('indirme uçları', () => {
  it('sürüm bilgisini ve yalnızca bizim adreslerimizi döner; platform adresi dosyaya yönlendirir', async () => {
    const releases = new ReleaseService('x/y', fakeFetch([{ ok: true, body: githubRelease }]).fn);
    ({ app } = await buildApp(config, { dbFile: ':memory:', logger: false, releases }));

    const info = await app.inject({ method: 'GET', url: '/api/download/latest' });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({
      version: '0.2.0',
      platforms: { windows: { href: '/download/windows', size: 1000 } },
    });
    expect(JSON.stringify(info.json())).not.toContain('example.test');

    const win = await app.inject({ method: 'GET', url: '/download/windows' });
    expect(win.statusCode).toBe(302);
    expect(win.headers.location).toBe('https://example.test/Diskort-Setup-0.2.0.exe');

    const linux = await app.inject({ method: 'GET', url: '/download/linux' });
    expect(linux.headers.location).toBe('https://example.test/app.AppImage');

    // Henüz olmayan platform veya bilinmeyen adres indirme sayfasına döner
    for (const url of ['/download/mac', '/download/bilinmeyen']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/download');
    }
  });

  it('sürüm bilgisi hiç alınamadıysa 503 döner', async () => {
    const releases = new ReleaseService('x/y', fakeFetch([new Error('yok')]).fn);
    ({ app } = await buildApp(config, { dbFile: ':memory:', logger: false, releases }));
    expect((await app.inject({ method: 'GET', url: '/api/download/latest' })).statusCode).toBe(503);
  });
});
