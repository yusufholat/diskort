// Paket dosyalarının cihazdaki önbelleği. Dosyaların adresi sürümlüdür (/api/cosmetics/packs/<kimlik>/<sürüm>/
// <ad>; sürüm içeriğin özetidir) ve içerikleri değişmez: bir kez indirilen dosya her açılışta yeniden indirilmez.
// Bildirimde artık bulunmayan sürümlerin dosyaları silinir. Dosya sistemi dışarıdan verilir (uygulamada
// expo-file-system, testlerde sahtesi); bu dosya React Native'e bağlı değildir.

import type { CosmeticPackManifest } from '@diskort/shared';
import { COSMETIC_PIECES } from '@diskort/shared';

/** Önbelleğin kullandığı dosya işlemleri (adresler `file://` biçiminde) */
export interface PackCacheFs {
  /** Önbellek klasörü (sonunda / ile); cihazda yoksa null */
  dir: string | null;
  /** Dosyanın boyutu (bayt); dosya yoksa null */
  size(uri: string): Promise<number | null>;
  makeDir(uri: string): Promise<void>;
  /** Adresi dosyaya indirir; HTTP durum kodunu döner */
  download(url: string, uri: string): Promise<number>;
  move(from: string, to: string): Promise<void>;
  remove(uri: string): Promise<void>;
  /** Klasördeki dosya adları; klasör yoksa boş */
  list(uri: string): Promise<string[]>;
}

const PACK_FILE_URL = /\/api\/cosmetics\/packs\/([a-z][a-z0-9-]{1,23})\/([0-9a-f]{12,64})\/([a-z0-9][a-z0-9.-]{0,39})$/;
/** İnmekte olan dosyanın eki (yarım dosya hiçbir zaman asıl adıyla durmaz) */
const PART = '.part';

/**
 * Paket dosyasının önbellekteki adı: `<kimlik>_<sürüm>_<ad>` (alt çizgi üçünde de bulunamaz). Adres bir paket
 * dosyasının adresi değilse null (önbelleğe alınmaz).
 */
export function cacheFileName(url: string): string | null {
  const m = PACK_FILE_URL.exec(url.split(/[?#]/)[0] ?? '');
  return m ? `${m[1]}_${m[2]}_${m[3]}` : null;
}

/** Bildirimdeki bütün dosyaların önbellek adları (hangi türü kullandığımızdan bağımsız) */
export function manifestCacheNames(manifest: CosmeticPackManifest): Set<string> {
  const names = new Set<string>();
  for (const pack of manifest.packs) {
    for (const piece of COSMETIC_PIECES) {
      for (const asset of pack.assets[piece]) {
        const name = cacheFileName(asset.url);
        if (name) names.add(name);
      }
    }
  }
  return names;
}

/** Önbellek klasöründeki dosyalardan silinecekler: bildirimde olmayan sürümler ve yarım kalmış indirmeler */
export function staleCacheFiles(existing: readonly string[], keep: ReadonlySet<string>, downloading: ReadonlySet<string> = new Set()): string[] {
  return existing.filter((name) => {
    if (name.endsWith(PART)) return !downloading.has(name.slice(0, -PART.length));
    return !keep.has(name);
  });
}

export interface PackCache {
  /**
   * Dosyanın cihazdaki adresi; yoksa indirir. `bytes`: bildirimdeki boyut (tutmayan dosya geçersizdir). Aynı
   * dosya için aynı anda tek indirme yapılır. Önbellek kullanılamıyorsa ya da indirilemezse hata verir.
   */
  ensure(file: { url: string; bytes: number }): Promise<string>;
  /** Bildirimde olmayan dosyaları siler; silinen sayısını döner. Hata vermez. */
  evict(manifest: CosmeticPackManifest): Promise<number>;
}

export function createPackCache(fs: PackCacheFs, folder = 'kozmetik-paketleri/'): PackCache {
  const inflight = new Map<string, Promise<string>>();
  const root = (): string => {
    if (!fs.dir) throw new Error('önbellek klasörü yok');
    return fs.dir + folder;
  };

  async function fetchFile(name: string, url: string, bytes: number): Promise<string> {
    const dir = root();
    const uri = dir + name;
    if ((await fs.size(uri)) === bytes) return uri;
    await fs.makeDir(dir);
    const part = uri + PART;
    await fs.remove(part);
    try {
      const status = await fs.download(url, part);
      if (status !== 200) throw new Error(`paket dosyası indirilemedi (${status})`);
      const size = await fs.size(part);
      if (size !== bytes) throw new Error(`paket dosyasının boyutu tutmuyor (${String(size)} / ${bytes})`);
      await fs.remove(uri);
      await fs.move(part, uri);
      return uri;
    } catch (err) {
      await fs.remove(part).catch(() => undefined);
      throw err;
    }
  }

  return {
    ensure({ url, bytes }) {
      const name = cacheFileName(url);
      if (!name) return Promise.reject(new Error('paket dosyası adresi değil'));
      const running = inflight.get(name);
      if (running) return running;
      const job = fetchFile(name, url, bytes).finally(() => inflight.delete(name));
      inflight.set(name, job);
      return job;
    },
    async evict(manifest) {
      try {
        const dir = root();
        const stale = staleCacheFiles(await fs.list(dir), manifestCacheNames(manifest), new Set(inflight.keys()));
        let removed = 0;
        for (const name of stale) {
          try {
            await fs.remove(dir + name);
            removed++;
          } catch {
            // silinemeyen dosya bir sonraki sefere kalır
          }
        }
        return removed;
      } catch {
        return 0;
      }
    },
  };
}
