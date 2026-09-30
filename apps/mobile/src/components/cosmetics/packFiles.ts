// Paket dosyalarının cihazdaki önbelleği (packCache.ts) için dosya sistemi: uygulama güncelleyicisinin de
// kullandığı expo-file-system (src/update/updater.ts). Dosyalar önbellek klasöründe durur: yer darlığında
// sistem silebilir, o zaman yeniden indirilir.

import * as FileSystem from 'expo-file-system/legacy';
import { useCosmeticPacks } from '@diskort/client-core';
import { createPackCache } from './packCache';

/** İndirme bu kadar süre (ms) hiç ilerlemezse vazgeçilir (yanıt vermeyen sunucu oynatıcıyı "yükleniyor"da bırakmasın) */
const DOWNLOAD_STALL_MS = 20_000;

/**
 * Dosyayı indirir; HTTP durum kodunu döner. iOS'ta ön plan oturumu kullanılır: varsayılan arka plan oturumu sunucu
 * ya da bağlantı kesikken hata vermez, sonsuza kadar yeniden dener. İlerleme DOWNLOAD_STALL_MS durursa indirme
 * iptal edilir ve hata döner.
 */
function download(url: string, uri: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      finish();
    };
    const watch = (): void => {
      if (settled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        settle(() => reject(new Error('paket dosyasının indirilmesi zaman aşımına uğradı')));
        task.cancelAsync().catch(() => undefined);
      }, DOWNLOAD_STALL_MS);
    };
    const task = FileSystem.createDownloadResumable(url, uri, { sessionType: FileSystem.FileSystemSessionType.FOREGROUND }, watch);
    watch();
    task.downloadAsync().then(
      (result) => settle(() => (result ? resolve(result.status) : reject(new Error('paket dosyasının indirilmesi iptal edildi')))),
      (err: unknown) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
  });
}

export const packFiles = createPackCache({
  dir: FileSystem.cacheDirectory,
  size: async (uri) => {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && !info.isDirectory ? info.size : null;
  },
  makeDir: (uri) => FileSystem.makeDirectoryAsync(uri, { intermediates: true }),
  download,
  move: (from, to) => FileSystem.moveAsync({ from, to }),
  remove: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
  list: async (uri) => {
    try {
      return await FileSystem.readDirectoryAsync(uri);
    } catch {
      return [];
    }
  },
});

/** Bildirim değiştikten bu kadar sonra eski sürümlerin dosyaları silinir (ms; açılışı ve oynatmayı bekletmesin) */
const EVICT_DELAY_MS = 20_000;
let watching = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Bildirimi izler: değişince (ve ilk çağrıda) bildirimde olmayan dosyaları siler. İkinci çağrı bir şey yapmaz. */
export function watchPackFiles(): void {
  if (watching) return;
  watching = true;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const { manifest } = useCosmeticPacks.getState();
      // Bildirim hiç alınamadıysa dokunulmaz (çevrimdışı açılış)
      if (manifest) void packFiles.evict(manifest);
    }, EVICT_DELAY_MS);
  };
  schedule();
  useCosmeticPacks.subscribe((state, previous) => {
    if (state.manifest !== previous.manifest) schedule();
  });
}
