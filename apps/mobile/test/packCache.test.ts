// Paket dosyalarının cihazdaki önbelleği: dosya adı adresteki kimlik, sürüm ve addan kurulur; var olan dosya
// yeniden indirilmez; bildirimde kalmayan sürümlerin dosyaları silinir. Dosya sistemi sahtedir.

import { describe, expect, it } from 'vitest';
import type { CosmeticPack, CosmeticPackAsset, CosmeticPackManifest } from '@diskort/shared';
import { cacheFileName, createPackCache, manifestCacheNames, staleCacheFiles, type PackCacheFs } from '../src/components/cosmetics/packCache';

const V1 = '0123456789abcdef';
const V2 = 'fedcba9876543210';
const url = (id: string, version: string, name: string): string => `https://sunucu.test/api/cosmetics/packs/${id}/${version}/${name}`;

describe('cacheFileName', () => {
  it('kimlik, sürüm ve addan kurulur (sunucudan bağımsız)', () => {
    expect(cacheFileName(url('buz', V1, 'deco.webp'))).toBe(`buz_${V1}_deco.webp`);
    expect(cacheFileName(`/api/cosmetics/packs/kristal-buz/${V1}/card-poster.webp`)).toBe(`kristal-buz_${V1}_card-poster.webp`);
    expect(cacheFileName(`http://10.0.2.2:3000/api/cosmetics/packs/buz/${V1}/card.mp4?x=1`)).toBe(`buz_${V1}_card.mp4`);
  });

  it('sürüm değişince ad da değişir', () => {
    expect(cacheFileName(url('buz', V1, 'deco.webp'))).not.toBe(cacheFileName(url('buz', V2, 'deco.webp')));
  });

  it('paket dosyası olmayan adres ve klasörden çıkma denemesi: null', () => {
    expect(cacheFileName('https://sunucu.test/uploads/a.webp')).toBeNull();
    expect(cacheFileName(`https://sunucu.test/api/cosmetics/packs/buz/${V1}/../../x`)).toBeNull();
    expect(cacheFileName(`https://sunucu.test/api/cosmetics/packs/buz/${V1}/a/b.webp`)).toBeNull();
    expect(cacheFileName(`https://sunucu.test/api/cosmetics/packs/BUZ/${V1}/a.webp`)).toBeNull();
    expect(cacheFileName('')).toBeNull();
  });
});

const asset = (id: string, version: string, name: string, kind: CosmeticPackAsset['kind']): CosmeticPackAsset => ({
  kind,
  url: `/api/cosmetics/packs/${id}/${version}/${name}`,
  width: 10,
  height: 10,
  bytes: 5,
});

const pack = (id: string, version: string): CosmeticPack => ({
  id,
  label: id,
  accent: '#000000',
  from: '#000000',
  to: '#000000',
  fallback: ['#000000', '#000000', '#000000'],
  description: '',
  pieces: ['', '', ''],
  loopSeconds: 6,
  fps: 30,
  platforms: ['android'],
  version,
  assets: {
    card: [asset(id, version, 'card.mp4', 'stacked-h264'), asset(id, version, 'card-poster.webp', 'poster')],
    deco: [asset(id, version, 'deco.webp', 'webp')],
    plate: [asset(id, version, 'plate.webp', 'webp')],
  },
});

const manifest = (...packs: CosmeticPack[]): CosmeticPackManifest => ({ version: V1, packs });

describe('eski sürümlerin silinmesi', () => {
  it('bildirimdeki bütün dosyaların adları', () => {
    expect([...manifestCacheNames(manifest(pack('buz', V1)))].sort()).toEqual(
      [`buz_${V1}_card-poster.webp`, `buz_${V1}_card.mp4`, `buz_${V1}_deco.webp`, `buz_${V1}_plate.webp`].sort(),
    );
  });

  it('bildirimde olmayan sürümler ve yarım indirmeler silinir; süren indirme kalır', () => {
    const keep = manifestCacheNames(manifest(pack('buz', V2)));
    const existing = [`buz_${V1}_deco.webp`, `buz_${V2}_deco.webp`, `neon_${V1}_plate.webp`, `buz_${V2}_card.mp4.part`, `buz_${V2}_plate.webp.part`];
    expect(staleCacheFiles(existing, keep, new Set([`buz_${V2}_plate.webp`]))).toEqual([`buz_${V1}_deco.webp`, `neon_${V1}_plate.webp`, `buz_${V2}_card.mp4.part`]);
  });
});

/** Bellekte sahte dosya sistemi; `remote`: adres → içeriğin boyutu (yoksa 404) */
function fakeFs(remote: Record<string, number>) {
  const files = new Map<string, number>();
  const downloads: string[] = [];
  let hold: Promise<void> | null = null;
  const fs: PackCacheFs = {
    dir: 'file:///cache/',
    size: async (uri) => files.get(uri) ?? null,
    makeDir: async () => undefined,
    download: async (from, to) => {
      downloads.push(from);
      if (hold) await hold;
      const size = remote[from];
      if (size === undefined) return 404;
      files.set(to, size);
      return 200;
    },
    move: async (from, to) => {
      const size = files.get(from);
      if (size === undefined) throw new Error('taşınacak dosya yok');
      files.delete(from);
      files.set(to, size);
    },
    remove: async (uri) => void files.delete(uri),
    list: async (dir) => [...files.keys()].filter((uri) => uri.startsWith(dir)).map((uri) => uri.slice(dir.length)),
  };
  return {
    fs,
    files,
    downloads,
    holdDownloads: () => {
      let release!: () => void;
      hold = new Promise<void>((resolve) => (release = resolve));
      return () => {
        hold = null;
        release();
      };
    },
  };
}

describe('createPackCache', () => {
  const deco = url('buz', V1, 'deco.webp');
  const path = `file:///cache/kozmetik-paketleri/buz_${V1}_deco.webp`;

  it('dosyayı bir kez indirir, sonra cihazdakini kullanır', async () => {
    const t = fakeFs({ [deco]: 100 });
    const cache = createPackCache(t.fs);
    expect(await cache.ensure({ url: deco, bytes: 100 })).toBe(path);
    expect(await cache.ensure({ url: deco, bytes: 100 })).toBe(path);
    expect(t.downloads).toEqual([deco]);
    expect([...t.files.keys()]).toEqual([path]);
  });

  it('aynı dosya için aynı anda tek indirme', async () => {
    const t = fakeFs({ [deco]: 100 });
    const cache = createPackCache(t.fs);
    const release = t.holdDownloads();
    const a = cache.ensure({ url: deco, bytes: 100 });
    const b = cache.ensure({ url: deco, bytes: 100 });
    release();
    expect(await Promise.all([a, b])).toEqual([path, path]);
    expect(t.downloads).toHaveLength(1);
  });

  it('boyutu tutmayan (yarım, bozuk) dosya yeniden indirilir', async () => {
    const t = fakeFs({ [deco]: 100 });
    t.files.set(path, 40);
    const cache = createPackCache(t.fs);
    expect(await cache.ensure({ url: deco, bytes: 100 })).toBe(path);
    expect(t.downloads).toHaveLength(1);
    expect(t.files.get(path)).toBe(100);
  });

  it('indirilemeyen ya da boyutu bildirimle tutmayan dosya: hata, yarım dosya kalmaz', async () => {
    const missing = fakeFs({});
    await expect(createPackCache(missing.fs).ensure({ url: deco, bytes: 100 })).rejects.toThrow('404');
    expect(missing.files.size).toBe(0);

    const wrong = fakeFs({ [deco]: 90 });
    await expect(createPackCache(wrong.fs).ensure({ url: deco, bytes: 100 })).rejects.toThrow('boyutu');
    expect(wrong.files.size).toBe(0);
  });

  it('hata sonrası yeniden denenebilir', async () => {
    const remote: Record<string, number> = {};
    const t = fakeFs(remote);
    const cache = createPackCache(t.fs);
    await expect(cache.ensure({ url: deco, bytes: 100 })).rejects.toThrow();
    remote[deco] = 100;
    expect(await cache.ensure({ url: deco, bytes: 100 })).toBe(path);
  });

  it('önbellek klasörü yoksa ve adres paket dosyası değilse hata', async () => {
    const t = fakeFs({ [deco]: 100 });
    expect(createPackCache(t.fs).available).toBe(true);
    expect(createPackCache({ ...t.fs, dir: null }).available).toBe(false);
    await expect(createPackCache({ ...t.fs, dir: null }).ensure({ url: deco, bytes: 100 })).rejects.toThrow('önbellek');
    await expect(createPackCache(t.fs).ensure({ url: 'https://sunucu.test/a.webp', bytes: 1 })).rejects.toThrow('adresi');
  });

  it('discard: çözülemeyen dosyanın kopyası silinir, bir sonraki ensure yeniden indirir', async () => {
    const t = fakeFs({ [deco]: 100 });
    const cache = createPackCache(t.fs);
    await cache.ensure({ url: deco, bytes: 100 });
    await cache.discard(deco);
    expect(t.files.has(path)).toBe(false);
    expect(await cache.ensure({ url: deco, bytes: 100 })).toBe(path);
    expect(t.downloads).toEqual([deco, deco]);
  });

  it('discard: süren indirmenin bitmesini bekler; hata vermez', async () => {
    const t = fakeFs({ [deco]: 100 });
    const cache = createPackCache(t.fs);
    const release = t.holdDownloads();
    const pending = cache.ensure({ url: deco, bytes: 100 });
    const discarding = cache.discard(deco);
    release();
    await pending;
    await discarding;
    expect(t.files.has(path)).toBe(false);
    await expect(cache.discard('https://sunucu.test/a.webp')).resolves.toBeUndefined();
    await expect(createPackCache({ ...t.fs, dir: null }).discard(deco)).resolves.toBeUndefined();
  });

  it('evict: bildirimde olmayan sürümlerin dosyalarını siler', async () => {
    const t = fakeFs({ [deco]: 100, [url('buz', V2, 'deco.webp')]: 120 });
    const cache = createPackCache(t.fs);
    await cache.ensure({ url: deco, bytes: 100 });
    await cache.ensure({ url: url('buz', V2, 'deco.webp'), bytes: 120 });
    t.files.set('file:///cache/kozmetik-paketleri/kalinti.part', 3);
    expect(await cache.evict(manifest(pack('buz', V2)))).toBe(2);
    expect([...t.files.keys()]).toEqual([`file:///cache/kozmetik-paketleri/buz_${V2}_deco.webp`]);
  });

  it('evict hata vermez (klasör yok, liste okunamıyor)', async () => {
    const t = fakeFs({});
    expect(await createPackCache({ ...t.fs, dir: null }).evict(manifest())).toBe(0);
    const failing: PackCacheFs = {
      ...t.fs,
      list: async () => {
        throw new Error('okunamadı');
      },
    };
    expect(await createPackCache(failing).evict(manifest())).toBe(0);
  });
});
