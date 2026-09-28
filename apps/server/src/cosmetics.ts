import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { COSMETIC_ID, type CosmeticItem, type CosmeticsCatalog } from '@diskort/shared';

export type CosmeticKind = 'decorations' | 'frames';

/**
 * Kaydedilen resmin kenarı (piksel). Dekorasyon avatarın 1,25 katı çizilir (en büyük avatar 88 px →
 * ~110 px, yüksek DPI için pay var); çerçevenin köşesi (üçte biri) kartta 40 px, resimde 160 px.
 */
export const COSMETIC_SIZE: Record<CosmeticKind, number> = { decorations: 240, frames: 480 };

interface Source {
  file: string;
  /** SVG'nin ve boyutun özeti: adreste sürüm, ETag */
  hash: string;
}

/** Varsayılan klasör: sunucu paketinin yanındaki cosmetics/ (kaynakta ve derlenmiş dist/'te aynı yer) */
export function defaultCosmeticsDir(): string {
  return process.env.COSMETICS_DIR ?? fileURLToPath(new URL('../cosmetics/', import.meta.url));
}

/**
 * Kozmetik kataloğu: avatar dekorasyonları ve profil çerçeveleri. Tasarımlar <dir>/decorations/*.svg ve
 * <dir>/frames/*.svg; adları ve sırası <dir>/manifest.json'da. SVG'ler ilk istendiğinde sharp ile saydam
 * WebP'ye çevrilip bellekte tutulur (hepsi birkaç yüz KB). Klasör yoksa katalog boştur.
 */
export class CosmeticsService {
  readonly catalog: CosmeticsCatalog;
  private readonly sources = new Map<string, Source>();
  private readonly images = new Map<string, Promise<Buffer>>();

  constructor(
    readonly dir: string = defaultCosmeticsDir(),
    log?: { warn(obj: unknown, msg?: string): void },
  ) {
    let manifest: Record<CosmeticKind, { id: string; name: string }[]> = { decorations: [], frames: [] };
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as typeof manifest;
    } catch (err) {
      log?.warn({ err, dir }, 'Kozmetik kataloğu okunamadı; dekorasyon ve çerçeve yok');
    }
    const load = (kind: CosmeticKind): CosmeticItem[] =>
      (manifest[kind] ?? []).flatMap(({ id, name }) => {
        const file = path.join(dir, kind, `${id}.svg`);
        if (!COSMETIC_ID.test(id) || !fs.existsSync(file)) {
          log?.warn({ kind, id }, 'Kozmetik atlandı: kimlik geçersiz ya da SVG yok');
          return [];
        }
        const hash = createHash('sha256')
          .update(fs.readFileSync(file))
          .update(String(COSMETIC_SIZE[kind]))
          .digest('hex')
          .slice(0, 12);
        this.sources.set(`${kind}/${id}`, { file, hash });
        return [{ id, name, url: `/api/cosmetics/${kind}/${id}.webp?v=${hash}` }];
      });
    this.catalog = { decorations: load('decorations'), frames: load('frames') };
  }

  has(kind: CosmeticKind, id: string): boolean {
    return this.sources.has(`${kind}/${id}`);
  }

  /** Tasarımın WebP'si ve özeti; katalogda yoksa null. */
  async image(kind: CosmeticKind, id: string): Promise<{ data: Buffer; hash: string } | null> {
    const key = `${kind}/${id}`;
    const source = this.sources.get(key);
    if (!source) return null;
    let image = this.images.get(key);
    if (!image) {
      image = rasterize(source.file, COSMETIC_SIZE[kind]);
      // Çevrilemezse bir dahaki istekte yeniden denenir
      image.catch(() => this.images.delete(key));
      this.images.set(key, image);
    }
    return { data: await image, hash: source.hash };
  }
}

/** SVG'yi kare, saydam WebP'ye çevirir (çizim çözünürlüğü doğrudan hedef boyuttan) */
async function rasterize(file: string, size: number): Promise<Buffer> {
  const svg = await fs.promises.readFile(file);
  const { width } = await sharp(svg).metadata();
  return sharp(svg, { density: (72 * size) / (width ?? size) })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90, alphaQuality: 100, effort: 4 })
    .toBuffer();
}
