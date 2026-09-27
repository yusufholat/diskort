import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { INLINE_IMAGE_TYPES, type Attachment } from '@diskort/shared';
import type { Store } from './db.js';
import { declaredType, inspectImage, sanitizeFileName, type ImageInfo } from './fileInfo.js';

/** Dosya kimliği: 128 bit rastgele, küçük harf onaltılık */
export const ATTACHMENT_ID = /^[0-9a-f]{32}$/;
/** İnceleme için dosyanın başından tutulan kısım (JPEG'de EXIF en fazla 64 KB) */
const HEAD_BYTES = 256 * 1024;
/** Diskte en az bu kadar yer kalmalı (veritabanı ve kayıtlar sıkışmasın) */
const MIN_FREE_BYTES = 1024 ** 3;
/** Yüklenip mesaja eklenmeyen dosyalar bu süreden sonra silinir */
export const PENDING_TTL_MS = 60 * 60_000;
/** Veritabanında karşılığı olmayan (yarım kalmış, artık) dosyalar için bekleme süresi */
const ORPHAN_GRACE_MS = 60 * 60_000;

export class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const formatMb = (bytes: number): string => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

/**
 * Dosya ekleri: <DATA_DIR>/attachments/<kimlik> olarak diske yazılır (adı ve türü veritabanında).
 * Diskteki ad yalnızca rastgele kimliktir; kullanıcının verdiği ad hiçbir zaman yol olarak kullanılmaz.
 */
export class AttachmentService {
  constructor(
    private readonly store: Store,
    readonly dir: string,
    readonly maxBytes: number,
    private readonly log?: { info(obj: unknown, msg?: string): void },
  ) {}

  pathOf(id: string): string {
    return path.join(this.dir, id);
  }

  /** Gövdeyi diske akıtır, inceler ve henüz mesaja bağlı olmayan bir ek olarak kaydeder. */
  async upload(input: {
    body: Readable;
    declaredSize: number | null;
    name: string;
    contentType: string | undefined;
    channelId: string;
    uploaderId: string;
  }): Promise<Attachment> {
    const tooLarge = new UploadError(413, 'too_large', `Dosya çok büyük (en fazla ${formatMb(this.maxBytes)}).`);
    if (input.declaredSize !== null && input.declaredSize > this.maxBytes) throw tooLarge;
    // Klasör ilk yüklemede oluşturulur
    await fs.promises.mkdir(this.dir, { recursive: true });
    await this.ensureSpace(input.declaredSize ?? this.maxBytes);

    const id = randomBytes(16).toString('hex');
    const partial = `${this.pathOf(id)}.part`;
    const head: Buffer[] = [];
    let headLength = 0;
    let size = 0;
    const max = this.maxBytes;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        size += chunk.length;
        if (size > max) {
          done(tooLarge);
          return;
        }
        if (headLength < HEAD_BYTES) {
          const part = chunk.subarray(0, HEAD_BYTES - headLength);
          head.push(part);
          headLength += part.length;
        }
        done(null, chunk);
      },
    });
    let image: ImageInfo | null;
    try {
      await pipeline(input.body, counter, fs.createWriteStream(partial, { flags: 'wx' }));
      if (size === 0) throw new UploadError(400, 'empty_file', 'Dosya boş.');
      image = inspectImage(Buffer.concat(head));
      // Telefon fotoğraflarındaki konum bilgisi paylaşılmasın
      if (image?.scrub.length) await this.zeroRegions(partial, image.scrub);
      await fs.promises.rename(partial, this.pathOf(id));
    } catch (err) {
      await fs.promises.rm(partial, { force: true });
      if (err instanceof UploadError) throw err;
      throw new UploadError(400, 'upload_failed', 'Dosya yüklenemedi, bağlantı kesildi.');
    }

    // Resim türü yalnızca içerik gerçekten o resimse verilir; bildirilen tür yalan olabilir
    let contentType = declaredType(input.contentType);
    if (image) contentType = image.type;
    else if (INLINE_IMAGE_TYPES.includes(contentType)) contentType = 'application/octet-stream';
    return this.store.createAttachment({
      id,
      channelId: input.channelId,
      uploaderId: input.uploaderId,
      name: sanitizeFileName(input.name),
      size,
      contentType,
      width: image?.width ?? null,
      height: image?.height ?? null,
    });
  }

  /** Diskten siler (veritabanı kaydı ayrıca silinir ya da zaten silinmiştir). */
  async remove(ids: string[]): Promise<void> {
    await Promise.all(
      ids.filter((id) => ATTACHMENT_ID.test(id)).map((id) => fs.promises.rm(this.pathOf(id), { force: true })),
    );
  }

  /**
   * Temizlik: süresi geçmiş (mesaja eklenmemiş) yüklemeleri ve veritabanında karşılığı olmayan
   * dosyaları (kanal silinmesi, yarım kalan yüklemeler, eski yedekten geri dönüş) siler.
   */
  async sweep(now = Date.now()): Promise<number> {
    const stale = this.store.stalePendingAttachments(now - PENDING_TTL_MS);
    this.store.deleteAttachments(stale);
    await this.remove(stale);
    let removed = stale.length;

    const files = await fs.promises.readdir(this.dir).catch(() => [] as string[]);
    for (const file of files) {
      const id = file.endsWith('.part') ? file.slice(0, -5) : file;
      if (!ATTACHMENT_ID.test(id)) continue; // bize ait olmayan dosyalara dokunulmaz
      if (file === id && this.store.attachmentExists(id)) continue;
      const full = path.join(this.dir, file);
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat || now - stat.mtimeMs < ORPHAN_GRACE_MS) continue;
      await fs.promises.rm(full, { force: true });
      removed++;
    }
    if (removed > 0) this.log?.info({ removed }, 'kullanılmayan dosya ekleri silindi');
    return removed;
  }

  private async ensureSpace(bytes: number): Promise<void> {
    const stats = await fs.promises.statfs(this.dir).catch(() => null);
    if (stats && stats.bavail * stats.bsize - bytes < MIN_FREE_BYTES) {
      throw new UploadError(507, 'storage_full', 'Sunucuda yer kalmadı, dosya yüklenemiyor.');
    }
  }

  private async zeroRegions(file: string, regions: [number, number][]): Promise<void> {
    const handle = await fs.promises.open(file, 'r+');
    try {
      for (const [at, length] of regions) await handle.write(Buffer.alloc(length), 0, length, at);
    } finally {
      await handle.close();
    }
  }
}
