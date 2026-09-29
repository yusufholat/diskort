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
    { name: 'Diskort-0.2.0-arm64.dmg', size: 3000, browser_download_url: 'https://example.test/arm.dmg' },
    { name: 'Diskort-0.2.0-arm64.dmg.blockmap', size: 30, browser_download_url: 'https://example.test/arm.dmg.blockmap' },
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
    expect(assets['mac-arm64']?.name).toBe('Diskort-0.2.0-arm64.dmg');
    expect(assets['mac-x64']).toBeUndefined();
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

    const mac = await app.inject({ method: 'GET', url: '/download/mac' });
    expect(mac.headers.location).toBe('https://example.test/arm.dmg');

    // Henüz olmayan platform veya bilinmeyen adres indirme sayfasına döner
    for (const url of ['/download/mac-x64', '/download/bilinmeyen']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/download');
    }
  });

  it('iOS: IPA varsa kurulum bildirimi ve itms-services yönlendirmesi; yoksa 404', async () => {
    let releases = new ReleaseService('x/y', fakeFetch([{ ok: true, body: githubRelease }]).fn);
    ({ app } = await buildApp(config, { dbFile: ':memory:', logger: false, releases }));
    expect((await app.inject({ method: 'GET', url: '/download/ios/manifest.plist' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/download/ios' })).headers.location).toBe('/download');
    await app.close();

    const withIpa = {
      ...githubRelease,
      assets: [
        ...githubRelease.assets,
        { name: 'Diskort-0.1.9-ios.ipa', size: 4000, browser_download_url: 'https://example.test/Diskort-0.1.9-ios.ipa' },
      ],
    };
    releases = new ReleaseService('x/y', fakeFetch([{ ok: true, body: withIpa }]).fn);
    ({ app } = await buildApp(config, { dbFile: ':memory:', logger: false, releases }));
    const info = (await app.inject({ method: 'GET', url: '/api/download/latest' })).json();
    expect(info.platforms.ios).toEqual({ name: 'Diskort-0.1.9-ios.ipa', size: 4000, href: '/download/ios' });

    const plist = await app.inject({ method: 'GET', url: '/download/ios/manifest.plist' });
    expect(plist.statusCode).toBe(200);
    expect(plist.headers['content-type']).toContain('application/xml');
    expect(plist.body).toContain('<string>https://example.test/Diskort-0.1.9-ios.ipa</string>');
    expect(plist.body).toContain('<string>com.diskort.app</string>');
    expect(plist.body).toContain('<key>bundle-version</key>\n        <string>0.1.9</string>');

    const install = await app.inject({ method: 'GET', url: '/download/iphone', headers: { host: 'diskort.test' } });
    expect(install.statusCode).toBe(302);
    expect(install.headers.location).toBe(
      `itms-services://?action=download-manifest&url=${encodeURIComponent('http://diskort.test/download/ios/manifest.plist')}`,
    );
  });

  it('sürüm bilgisi hiç alınamadıysa 503 döner', async () => {
    const releases = new ReleaseService('x/y', fakeFetch([new Error('yok')]).fn);
    ({ app } = await buildApp(config, { dbFile: ':memory:', logger: false, releases }));
    expect((await app.inject({ method: 'GET', url: '/api/download/latest' })).statusCode).toBe(503);
  });
});

describe('sürüm notları', () => {
  it('yayınlanmış sürümlerin notlarını yeniden eskiye verir, taslakları atlar', async () => {
    const fake = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => [
          { tag_name: 'v0.5.1', published_at: null, body: 'taslak', draft: true, prerelease: false },
          { tag_name: 'v0.5.0', published_at: '2026-09-27T10:00:00Z', body: '## Diskort 0.5.0\n- **DM**', draft: false, prerelease: false },
          { tag_name: 'v0.4.3', published_at: '2026-09-27T09:00:00Z', body: null, draft: false, prerelease: false },
        ],
      }) as Response) as unknown as typeof fetch;
    const notes = await new ReleaseService('x/y', fake).recentNotes();
    expect(notes).toEqual([
      { version: '0.5.0', publishedAt: '2026-09-27T10:00:00Z', notes: '## Diskort 0.5.0\n- **DM**' },
      { version: '0.4.3', publishedAt: '2026-09-27T09:00:00Z', notes: '' },
    ]);
  });

  it('notlar en son sürüm bilgisinin önüne geçmez: yeni sürümün notu, sürüm görülünce çıkar', async () => {
    const gh = githubFake({ latest: '0.8.9', notes: ['0.8.10', '0.8.9'] });
    const service = new ReleaseService('x/y', gh.fn);
    // Notlar yeni sürümü gördü, "en son" henüz eski: yeni sürümün notu gizli, bunun için GitHub'a ek istek yok
    expect((await service.recentNotes()).map((n) => n.version)).toEqual(['0.8.9']);
    await service.recentNotes();
    expect(gh.latestCalls()).toBe(1);
    // Yoklama yeni sürümü gördü: not görünür
    gh.set({ latest: '0.8.10' });
    await (service as unknown as { refresh: () => Promise<unknown> }).refresh();
    expect((await service.recentNotes()).map((n) => n.version)).toEqual(['0.8.10', '0.8.9']);
  });

  it('GitHub hata verince bekler: istek sınırı dolduysa sıfırlanana kadar gitmez, son bilinen değer kalır', async () => {
    const gh = githubFake({ latest: '0.8.9', notes: ['0.8.9'] });
    const service = new ReleaseService('x/y', gh.fn);
    await service.latest();
    gh.set({ limited: true });
    const refresh = () => (service as unknown as { refresh: () => Promise<{ version: string } | null> }).refresh();
    expect((await refresh())?.version).toBe('0.8.9');
    expect(gh.latestCalls()).toBe(2);
    // Beklerken ne sürüm ne not için GitHub'a gidilir
    expect((await refresh())?.version).toBe('0.8.9');
    backdate(service);
    await service.latest();
    expect(gh.latestCalls()).toBe(2);
    expect(await service.recentNotes()).toEqual([]);
    expect(gh.notesCalls()).toBe(0);
  });

  it('yeni sürüm görülünce notların önbelleği sıfırlanır', async () => {
    const gh = githubFake({ latest: '0.8.9', notes: ['0.8.9'] });
    const service = new ReleaseService('x/y', gh.fn);
    expect((await service.recentNotes()).map((n) => n.version)).toEqual(['0.8.9']);
    gh.set({ latest: '0.8.10', notes: ['0.8.10', '0.8.9'] });
    await (service as unknown as { refresh: () => Promise<unknown> }).refresh();
    expect((await service.recentNotes()).map((n) => n.version)).toEqual(['0.8.10', '0.8.9']);
  });
});

describe('en son sürümün önbelleği', () => {
  it('süresi dolmuş değeri beklemeden verir, arka planda tazeler', async () => {
    const gh = githubFake({ latest: '0.8.9' });
    const service = new ReleaseService('x/y', gh.fn);
    await service.latest();
    gh.set({ latest: '0.8.10' });
    backdate(service);
    // Eski değer hemen döner; tazeleme arka planda
    expect((await service.latest())?.version).toBe('0.8.9');
    expect(gh.latestCalls()).toBe(2);
    await new Promise((r) => setTimeout(r, 0));
    expect((await service.latest())?.version).toBe('0.8.10');
  });

  it('koşullu istek: ETag gönderir, 304 gelince bilinen sürüm geçerli kalır', async () => {
    const gh = githubFake({ latest: '0.8.9', etag: '"abc"' });
    const service = new ReleaseService('x/y', gh.fn);
    await service.latest();
    expect(gh.lastIfNoneMatch()).toBeUndefined();
    gh.set({ notModified: true });
    const refresh = () => (service as unknown as { refresh: () => Promise<{ version: string } | null> }).refresh();
    expect((await refresh())?.version).toBe('0.8.9');
    expect(gh.lastIfNoneMatch()).toBe('"abc"');
  });
});

/** Önbelleği süresi dolmuş gibi gösterir */
function backdate(service: ReleaseService): void {
  (service as unknown as { cache: { at: number } }).cache.at = 0;
}

/** Adrese göre yanıt veren sahte GitHub: /releases/latest ve /releases?per_page (notlar) */
function githubFake(initial: { latest: string; notes?: string[]; etag?: string }) {
  let state: { latest: string; notes: string[]; etag?: string; notModified?: boolean; limited?: boolean } = {
    notes: [],
    ...initial,
  };
  let latestCalls = 0;
  let notesCalls = 0;
  let ifNoneMatch: string | undefined;
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/releases/latest')) latestCalls++;
    else notesCalls++;
    if (state.limited) {
      const reset = String(Math.floor(Date.now() / 1000) + 20 * 60);
      return {
        ok: false,
        status: 403,
        headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }),
      } as unknown as Response;
    }
    if (url.endsWith('/releases/latest')) {
      ifNoneMatch = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];
      if (state.notModified) return { ok: false, status: 304, headers: new Headers() } as Response;
      return {
        ok: true,
        status: 200,
        headers: new Headers(state.etag ? { etag: state.etag } : {}),
        json: async () => ({ tag_name: `v${state.latest}`, published_at: '2026-09-29T10:00:00Z', assets: [] }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () =>
        state.notes.map((v) => ({ tag_name: `v${v}`, published_at: '2026-09-29T10:00:00Z', body: v, draft: false, prerelease: false })),
    } as unknown as Response;
  }) as typeof fetch;
  return {
    fn,
    set: (next: Partial<typeof state>) => {
      state = { ...state, ...next };
    },
    latestCalls: () => latestCalls,
    notesCalls: () => notesCalls,
    lastIfNoneMatch: () => ifNoneMatch,
  };
}
