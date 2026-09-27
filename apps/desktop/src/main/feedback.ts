import { ipcMain } from 'electron';
import type { CapturedImage, SystemInfo } from '../shared/bridge';

/** Ekran görüntüsünün en geniş kenarı (4K/yüksek DPI pencereler küçültülür; sunucu da 2560'a indirir) */
const MAX_WIDTH = 2560;
/** PNG bundan büyükse JPEG'e çevrilir (sunucu sınırı 12 MB) */
const PNG_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Geri bildirim için ana süreç işleri: yalnızca Diskort penceresinin görüntüsü (webContents.capturePage;
 * masaüstünün ya da başka pencerelerin görüntüsü asla alınmaz) ve işletim sistemi bilgisi.
 */
export function registerFeedbackIpc(): void {
  ipcMain.handle('feedback:capture', async (e): Promise<CapturedImage> => {
    let image = await e.sender.capturePage();
    if (image.isEmpty()) throw new Error('Pencerenin görüntüsü alınamadı.');
    if (image.getSize().width > MAX_WIDTH) image = image.resize({ width: MAX_WIDTH, quality: 'best' });
    const { width, height } = image.getSize();
    let data = image.toPNG();
    let type: CapturedImage['type'] = 'image/png';
    if (data.length > PNG_MAX_BYTES) {
      data = image.toJPEG(90);
      type = 'image/jpeg';
    }
    return { data: new Uint8Array(data), type, width, height };
  });

  ipcMain.handle(
    'feedback:system-info',
    (): SystemInfo => ({
      os: process.platform,
      osVersion: process.getSystemVersion(),
      arch: process.arch,
      electron: process.versions.electron ?? '',
    }),
  );
}
