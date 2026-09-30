// Oyun ikonları: exe'nin kendi ikonu küçük bir PNG olarak çıkarılır, anahtarı PNG'nin SHA-256'sıdır (sunucuya
// bu anahtarla bir kez yüklenir). Çıkarılan ikonlar kullanıcı verileri klasöründe saklanır; exe değişmedikçe
// (yol + değiştirilme zamanı) yeniden çıkarılmaz.
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { ACTIVITY_ICON_KEY_PATTERN, ACTIVITY_ICON_MAX_SIZE_PX } from '@diskort/shared';
import { pathKey } from './libraries';
import { iconKeyOf, sanitizeIconPng } from './png';

interface IndexEntry {
  mtimeMs: number;
  key: string;
}

const MAX_INDEX_ENTRIES = 300;

export class IconStore {
  private index: Map<string, IndexEntry> | null = null;
  /** Bu oturumda ikonu alınamayan exe'ler (yeniden denenmez) */
  private readonly failed = new Set<string>();
  private readonly pending = new Map<string, Promise<string | null>>();
  /**
   * Yardımcı çıkaramadığı için Electron'un küçük ikonuyla yetinilen exe'ler: yalnızca bu oturumda geçerlidir,
   * sonraki açılışta büyük ikon yeniden denenir.
   */
  private readonly sessionKeys = new Map<string, string>();
  /** index.json yazımları sırayla yapılır (aynı anda iki ikon çıkarılabilir) */
  private indexWrites: Promise<void> = Promise.resolve();
  /** Ayarlar listesindeki küçük ikonlar (data: adresi) */
  private readonly previews = new Map<string, string | null>();

  constructor(
    private readonly dir: string,
    /** Büyük ikonu çıkaran yardımcı (tarayıcı süreci). null: exe'nin ikonu yok; undefined: çıkaramadı */
    private readonly extract: (path: string) => Promise<Buffer | null | undefined>,
  ) {}

  /** Exe'nin ikon anahtarı; ikon yoksa null */
  keyFor(path: string): Promise<string | null> {
    const id = pathKey(path);
    let task = this.pending.get(id);
    if (!task) {
      task = this.resolve(path, id)
        .catch(() => null)
        .finally(() => this.pending.delete(id));
      this.pending.set(id, task);
    }
    return task;
  }

  /** Anahtarın PNG'si (yalnızca bu bilgisayarda çıkarılmış ikonlar) */
  async bytes(key: string): Promise<Buffer | null> {
    if (!ACTIVITY_ICON_KEY_PATTERN.test(key)) return null;
    try {
      const png = await readFile(join(this.dir, `${key}.png`));
      return iconKeyOf(png) === key && sanitizeIconPng(png) === png ? png : null;
    } catch {
      return null;
    }
  }

  /** Listelerde gösterilen küçük ikon; alınamazsa null */
  async preview(path: string): Promise<string | null> {
    const id = pathKey(path);
    if (this.previews.has(id)) return this.previews.get(id)!;
    let url: string | null = null;
    try {
      await stat(path); // olmayan dosyada Windows genel bir ikon verir
      const image = await app.getFileIcon(path, { size: 'large' });
      if (!image.isEmpty()) url = image.toDataURL();
    } catch {
      url = null;
    }
    if (this.previews.size > 500) this.previews.clear();
    this.previews.set(id, url);
    return url;
  }

  private async resolve(path: string, id: string): Promise<string | null> {
    if (this.failed.has(id)) return null;
    const session = this.sessionKeys.get(id);
    if (session) return session;
    const mtimeMs = (await stat(path)).mtimeMs;
    const index = await this.loadIndex();
    const cached = index.get(id);
    if (cached && cached.mtimeMs === mtimeMs && (await this.bytes(cached.key))) return cached.key;

    const extracted = await this.extract(path);
    // Sunucunun kabul etmeyeceği parçalar ayıklanır; anahtar ayıklanmış baytlardan hesaplanır
    const usable = extracted ? sanitizeIconPng(extracted) : null;
    // null: exe'nin kendi ikonu yok (kesin). Yardımcı çıkaramadıysa Electron'un ikonuna düşülür
    const png = usable ?? (extracted === null ? null : await this.fallback(path));
    if (!png) {
      this.failed.add(id);
      return null;
    }
    const key = iconKeyOf(png);
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${key}.png`), png);
    if (!usable) {
      this.sessionKeys.set(id, key);
      return key;
    }
    index.delete(id);
    index.set(id, { mtimeMs, key });
    while (index.size > MAX_INDEX_ENTRIES) index.delete(index.keys().next().value!);
    await this.saveIndex(index);
    return key;
  }

  /** Kaydı geçici dosyaya yazıp yerine taşır: yarım yazılmış ya da iç içe geçmiş dosya kalmaz */
  private saveIndex(index: Map<string, IndexEntry>): Promise<void> {
    const write = async (): Promise<void> => {
      const file = join(this.dir, 'index.json');
      const temp = `${file}.tmp`;
      await writeFile(temp, JSON.stringify(Object.fromEntries(index)));
      await rename(temp, file);
    };
    this.indexWrites = this.indexWrites.then(write, write);
    return this.indexWrites;
  }

  /** Yardımcı ikonu veremediyse Electron'un verdiği (Windows'ta 32–48 px) ikon kullanılır */
  private async fallback(path: string): Promise<Buffer | null> {
    try {
      let image = await app.getFileIcon(path, { size: 'large' });
      if (image.isEmpty()) return null;
      const { width, height } = image.getSize();
      if (width !== height || width > ACTIVITY_ICON_MAX_SIZE_PX) {
        const side = Math.min(width, height, ACTIVITY_ICON_MAX_SIZE_PX);
        image = image.resize({ width: side, height: side, quality: 'best' });
      }
      return sanitizeIconPng(image.toPNG());
    } catch {
      return null;
    }
  }

  private async loadIndex(): Promise<Map<string, IndexEntry>> {
    if (this.index) return this.index;
    const index = new Map<string, IndexEntry>();
    try {
      const raw = JSON.parse(await readFile(join(this.dir, 'index.json'), 'utf8')) as Record<string, Partial<IndexEntry>>;
      for (const [id, entry] of Object.entries(raw)) {
        if (typeof entry?.mtimeMs === 'number' && typeof entry.key === 'string' && ACTIVITY_ICON_KEY_PATTERN.test(entry.key)) {
          index.set(id, { mtimeMs: entry.mtimeMs, key: entry.key });
        }
      }
    } catch {
      // kayıt yok ya da bozuk: ikonlar yeniden çıkarılır
    }
    this.index = index;
    return index;
  }
}
