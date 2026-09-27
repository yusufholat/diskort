import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import sharp from 'sharp';
import { FEEDBACK_SCREENSHOT_MAX_BYTES, type FeedbackScreenshot } from '@diskort/shared';
import { UploadError } from './attachments.js';
import { readLimited } from './avatars.js';
import { inspectImage } from './fileInfo.js';
import type { FeedbackStore } from './feedbackStore.js';

/** Ekran görüntüsü kimliği: 128 bit rastgele, küçük harf onaltılık */
export const SCREENSHOT_ID = /^[0-9a-f]{32}$/;
/** Kaydedilen resmin en uzun kenarı (piksel); 4K/yüksek DPI pencereler küçültülür */
const MAX_EDGE = 2560;
/** Çözülecek resmin en fazla piksel sayısı: sıkıştırma bombalarına karşı */
const MAX_INPUT_PIXELS = 8192 * 8192;
/** Yüklenip gönderilmeyen ekran görüntüleri bu süreden sonra silinir */
export const SCREENSHOT_PENDING_TTL_MS = 60 * 60_000;
/** Veritabanında karşılığı olmayan dosyalar için bekleme süresi (yarım kalan işlem, eski yedek) */
const ORPHAN_GRACE_MS = 60 * 60_000;

/**
 * Geri bildirim ekran görüntüleri: <DATA_DIR>/feedback/<kimlik>.webp. Yüklenen resim (PNG, JPEG, WebP,
 * GIF; içeriğinden anlaşılır) WebP'ye yeniden kodlanır: EXIF/konum dahil hiçbir üst veri kalmaz, en uzun
 * kenar 2560 pikseli geçmez. Dosyalar herkese açık değildir (bkz. routes/feedback.ts).
 */
export class FeedbackService {
  /** Resimler sırayla işlenir (sunucuda LiveKit de çalışıyor, bellek sınırlı) */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly store: FeedbackStore,
    readonly dir: string,
    private readonly log?: { info(obj: unknown, msg?: string): void },
  ) {}

  pathOf(id: string): string {
    return path.join(this.dir, `${id}.webp`);
  }

  /** Gövdeyi okur, doğrular, WebP'ye çevirir ve kullanıcının bekleyen ekran görüntüsü olarak kaydeder. */
  async upload(uploaderId: string, body: Readable, declaredSize: number | null): Promise<FeedbackScreenshot> {
    const input = await readLimited(body, declaredSize, FEEDBACK_SCREENSHOT_MAX_BYTES);
    const image = inspectImage(input);
    if (!image) {
      throw new UploadError(415, 'unsupported_type', 'Yalnızca PNG, JPEG, WebP ya da GIF resim eklenebilir.');
    }
    if (image.width !== null && image.height !== null && image.width * image.height > MAX_INPUT_PIXELS) {
      throw new UploadError(400, 'invalid_image', 'Resmin çözünürlüğü çok yüksek.');
    }
    return this.serial(async () => {
      const output = await normalize(input);
      const id = randomBytes(16).toString('hex');
      await fs.promises.mkdir(this.dir, { recursive: true });
      const temp = path.join(this.dir, `${id}.tmp`);
      try {
        await fs.promises.writeFile(temp, output.data, { flag: 'wx' });
        await fs.promises.rename(temp, this.pathOf(id));
      } catch (err) {
        await fs.promises.rm(temp, { force: true });
        throw err;
      }
      return this.store.addScreenshot({
        id,
        uploaderId,
        size: output.data.length,
        width: output.width,
        height: output.height,
      });
    });
  }

  /** Diskten siler (veritabanı kaydı ayrıca silinir ya da zaten silinmiştir). */
  async remove(ids: string[]): Promise<void> {
    await Promise.all(
      ids.filter((id) => SCREENSHOT_ID.test(id)).map((id) => fs.promises.rm(this.pathOf(id), { force: true })),
    );
  }

  /** Temizlik: gönderilmemiş eski ekran görüntüleri ve veritabanında karşılığı olmayan dosyalar. */
  async sweep(now = Date.now()): Promise<number> {
    const stale = this.store.deleteStalePending(now - SCREENSHOT_PENDING_TTL_MS);
    await this.remove(stale);
    let removed = stale.length;
    const files = await fs.promises.readdir(this.dir).catch(() => [] as string[]);
    for (const file of files) {
      const match = /^([0-9a-f]{32})\.(webp|tmp)$/.exec(file);
      if (!match) continue; // bize ait olmayan dosyalara dokunulmaz
      if (match[2] === 'webp' && this.store.screenshotExists(match[1]!)) continue;
      const full = path.join(this.dir, file);
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat || now - stat.mtimeMs < ORPHAN_GRACE_MS) continue;
      await fs.promises.rm(full, { force: true });
      removed++;
    }
    if (removed > 0) this.log?.info({ removed }, 'kullanılmayan geri bildirim ekran görüntüleri silindi');
    return removed;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** Resmi çözer, gerekirse küçültür ve WebP'ye çevirir; çözülemezse 400. */
async function normalize(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  try {
    const image = sharp(input, { autoOrient: true, failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS, pages: 1 });
    const { format } = await image.metadata();
    // İçerik denetimi zaten yapıldı; libvips'in başka bir çözücü seçmediğinden emin olunur
    if (format !== 'png' && format !== 'jpeg' && format !== 'webp' && format !== 'gif') throw new Error(format);
    const { data, info } = await image
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      // Arayüz yazıları okunaklı kalsın
      .webp({ quality: 90, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new UploadError(400, 'invalid_image', 'Resim okunamadı; dosya bozuk olabilir.');
  }
}
