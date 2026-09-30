// Kozmetik paketleri deposu: <DATA_DIR>/cosmetic-packs/
//   manifest.json                     yayınlanmış paketler (gösterim sırasıyla) ve dosyalarının bilgisi
//   <kimlik>/<sürüm>/<dosya adı>      paketin dosyaları; sürüm dosyaların içerik özetidir. Yayındaki sürümün
//                                     yanında en fazla bir önceki sürüm durur (yeniden yayından sonra 24 saat)
//
// Yayınlama yalnızca sunucudaki komut satırı aracıyla yapılır (cosmetics-cli.ts): yükleme için HTTP ucu
// yoktur. Çalışan sunucu manifest.json'un değiştiğini kendisi fark eder (bkz. CosmeticPackStore.current).
// Sözleşme: @diskort/shared cosmetics.ts; kullanım: docs/kozmetik-paketleri.md.

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COSMETIC_KIND_CONTENT_TYPE,
  COSMETIC_KIND_EXTENSION,
  COSMETIC_PACK_FILE_NAME_PATTERN,
  COSMETIC_PACK_FORMAT,
  COSMETIC_PACK_MAX_BUNDLE_BYTES,
  COSMETIC_PACK_MAX_COUNT,
  COSMETIC_PACK_MAX_FILE_BYTES,
  COSMETIC_PACK_VERSION_PATTERN,
  COSMETIC_SET_ID_PATTERN,
  cosmeticPackFileSetError,
  cosmeticPackFileUrl,
  isCosmeticSet,
  parseCosmeticPlatforms,
  validateCosmeticPackFileInfo,
  validateCosmeticPackInfo,
  type CosmeticAssetKind,
  type CosmeticPack,
  type CosmeticPackAsset,
  type CosmeticPackFileInfo,
  type CosmeticPackInfo,
  type CosmeticPackManifest,
  type CosmeticPiece,
  type CosmeticPlatform,
} from '@diskort/shared';
import { inspectImage, inspectVideo, mp4Metadata } from './fileInfo.js';

/** Geçersiz paket ya da yapılamayan işlem: iletisi kullanıcıya (komut satırına) gösterilir */
export class CosmeticPackError extends Error {}

/** Saklanan dosyanın bilgisi */
export interface StoredPackFile extends CosmeticPackFileInfo {
  bytes: number;
  /** İçeriğin SHA-256 özeti (onaltılık) */
  sha256: string;
}

/** manifest.json'daki bir paket */
export interface StoredPack extends CosmeticPackInfo {
  /** Dosyaların içerik özeti; klasör adı ve adreslerin parçası */
  version: string;
  publishedAt: number;
  files: StoredPackFile[];
}

/** Doğrulanmış yayın paketi (dosyalar çözülmüş) */
export interface ParsedBundle {
  info: CosmeticPackInfo;
  files: { info: StoredPackFile; data: Buffer }[];
}

/** Sunulmak üzere açılmış paket dosyası; tutamacı alan kapatır */
export interface OpenedPackFile {
  handle: fs.promises.FileHandle;
  size: number;
  contentType: string;
}

/**
 * Yeniden yayında yerini bırakan sürümün klasörü bu süre boyunca durur ve sunulur: bağlı istemciler bildirimi
 * tazeleyene dek (en geç 10 dakikada bir) eski adresleri kullanır.
 */
export const COSMETIC_PACK_GRACE_MS = 24 * 60 * 60_000;

const MANIFEST_FILE = 'manifest.json';
const LOCK_FILE = '.lock';
/** Bu kadar eski kilit, yarıda kalmış bir işlemden kalmadır */
const STALE_LOCK_MS = 10 * 60_000;

/** Kilit dosyasının içeriği: kilidi tutan süreç */
interface LockInfo {
  token: string;
  pid: number;
  host: string;
  /** Alındığı an (ms) */
  at: number;
}

function readLock(file: string): { raw: string; info: LockInfo | null; mtimeMs: number } | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const { mtimeMs } = fs.statSync(file);
    let info: LockInfo | null = null;
    try {
      const v = JSON.parse(raw) as Partial<LockInfo> | null;
      if (v && typeof v.token === 'string' && typeof v.pid === 'number' && typeof v.host === 'string' && typeof v.at === 'number') {
        info = { token: v.token, pid: v.pid, host: v.host, at: v.at };
      }
    } catch {
      // eski biçimli (boş) ya da yazılmakta olan kilit: yaşı dosyanın zamanından
    }
    return { raw, info, mtimeMs };
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: süreç var ama başkasının
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockIsStale(lock: { info: LockInfo | null; mtimeMs: number }): boolean {
  if (Date.now() - (lock.info?.at ?? lock.mtimeMs) >= STALE_LOCK_MS) return true;
  // Aynı makinede (kapsayıcıda) sahibi artık çalışmıyorsa (araç öldürülmüş) beklemeye gerek yok
  return lock.info !== null && lock.info.host === os.hostname() && !pidAlive(lock.info.pid);
}

/** Dosya adının uzantısından türü (yerini bırakmış sürümün dosyaları için; kayıt tutulmaz) */
function kindOfName(name: string): CosmeticAssetKind | null {
  // poster de .webp'tir: sunulan Content-Type aynıdır
  for (const kind of ['avif', 'webp', 'stacked-h264'] as const) if (name.endsWith(COSMETIC_KIND_EXTENSION[kind])) return kind;
  return null;
}
/** Çalışan sunucu manifest.json'a en çok bu sıklıkta bakar */
const DEFAULT_RECHECK_MS = 2000;
const SHA256 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** H.264 kare yüksekliği 16'nın katına tamamlanmış olabilir */
const VIDEO_HEIGHT_PADDING_PX = 15;

const formatMb = (bytes: number): string => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

// ---------- Dosya içeriğinin denetimi ----------

type Box = { type: string; start: number; end: number };

/**
 * ISO-BMFF (MP4, AVIF) kutuları: `from`-`to` aralığındaki art arda kutular (start/end kutunun içeriği).
 * Kutular aralığı tam kaplamıyorsa (kırpık, sonunda artık veri) null.
 */
function boxesIn(buf: Buffer, from: number, to: number): Box[] | null {
  const result: Box[] = [];
  let pos = from;
  while (pos < to) {
    if (pos + 8 > to) return null;
    let size = buf.readUInt32BE(pos);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > to) return null;
      const big = buf.readBigUInt64BE(pos + 8);
      if (big > BigInt(buf.length)) return null;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = to - pos;
    }
    if (size < header || pos + size > to) return null;
    result.push({ type: buf.toString('latin1', pos + 4, pos + 8), start: pos + header, end: pos + size });
    pos += size;
    if (result.length > 4096) return null;
  }
  return result;
}

/** Üst düzey kutular; dosyayı tam kaplamıyorlarsa null */
const topLevelBoxes = (buf: Buffer): Box[] | null => boxesIn(buf, 0, buf.length);

/** "moov" kutusundaki izlerin boyutları (tkhd; 16.16 sabit noktalı). Görüntü dizisinde karenin boyutudur. */
function trackSizes(buf: Buffer, moov: Box): { width: number; height: number }[] {
  const sizes: { width: number; height: number }[] = [];
  for (const trak of boxesIn(buf, moov.start, moov.end)?.filter((b) => b.type === 'trak') ?? []) {
    const tkhd = boxesIn(buf, trak.start, trak.end)?.find((b) => b.type === 'tkhd');
    if (!tkhd) continue;
    // Sürüm 1'de zaman alanları 64 bittir: boyutlar 12 bayt ileride
    const at = tkhd.start + (buf[tkhd.start] === 1 ? 88 : 76);
    if (at + 8 > tkhd.end) continue;
    const width = buf.readUInt32BE(at) / 65536;
    const height = buf.readUInt32BE(at + 4) / 65536;
    if (width > 0 && height > 0) sizes.push({ width, height });
  }
  return sizes;
}

/** AVIF'in "ftyp" kutusundaki markalar (ana marka + uyumlu markalar) */
function ftypBrands(buf: Buffer, box: { start: number; end: number }): string[] {
  const brands: string[] = [];
  if (box.end - box.start >= 4) brands.push(buf.toString('latin1', box.start, box.start + 4));
  for (let at = box.start + 8; at + 4 <= box.end; at += 4) brands.push(buf.toString('latin1', at, at + 4));
  return brands;
}

/** AVIF'teki resim boyutları ("ispe" özellikleri: asıl resim, alfa, küçük resim…) */
function avifSizes(buf: Buffer, box: { start: number; end: number }): { width: number; height: number }[] {
  const sizes: { width: number; height: number }[] = [];
  let at = box.start;
  while (sizes.length < 64) {
    at = buf.indexOf('ispe', at, 'latin1');
    // "ispe" + sürüm/bayraklar (4) + genişlik (4) + yükseklik (4)
    if (at < 0 || at + 16 > box.end) break;
    sizes.push({ width: buf.readUInt32BE(at + 8), height: buf.readUInt32BE(at + 12) });
    at += 4;
  }
  return sizes;
}

/**
 * Dosyanın içeriği bildirilen türde mi (dosya imzası), yapısı sağlam mı ve boyutları bildirilenle uyuşuyor
 * mu. Dosyalar olduğu gibi sunulduğundan türü yanlış ya da sonunda artık veri taşıyan dosya alınmaz.
 * Sorun varsa iletisi, yoksa null.
 */
export async function inspectPackFile(info: CosmeticPackFileInfo, data: Buffer): Promise<string | null> {
  const { kind, width, height } = info;
  if (kind === 'webp' || kind === 'poster') {
    const image = inspectImage(data);
    if (image?.type !== 'image/webp') return 'içerik WebP değil.';
    // RIFF uzunluğu dosyanın tamamı: sonunda başka veri taşınamaz
    if (data.readUInt32LE(4) + 8 !== data.length) return 'WebP bozuk (uzunluğu başlığıyla uyuşmuyor).';
    const animated = data.toString('latin1', 12, 16) === 'VP8X' && (data[20]! & 0x02) !== 0;
    if (kind === 'webp' && !animated) return 'hareketli WebP olmalı.';
    if (kind === 'poster' && animated) return 'poster sabit (hareketsiz) bir WebP olmalı.';
    if (image.width !== width || image.height !== height) {
      return `boyutu ${image.width}×${image.height}, bildirilen ${width}×${height}.`;
    }
    return null;
  }
  const boxes = topLevelBoxes(data);
  if (!boxes || boxes[0]?.type !== 'ftyp') return kind === 'avif' ? 'içerik AVIF değil.' : 'içerik MP4 değil.';
  if (kind === 'avif') {
    const brands = ftypBrands(data, boxes[0]);
    if (!brands.includes('avif') && !brands.includes('avis')) return 'içerik AVIF değil.';
    const moov = boxes.find((b) => b.type === 'moov');
    if (!moov) return 'hareketli AVIF (görüntü dizisi) olmalı.';
    // Boyut doğrulanamıyorsa dosya alınmaz (denetim atlanmaz). Kaynak: üst düzey "meta" kutusundaki "ispe"
    // özellikleri; kodlayıcı dizide "meta" yazmamışsa izlerin başlıkları (tkhd).
    const meta = boxes.find((b) => b.type === 'meta');
    let sizes = meta ? avifSizes(data, meta) : [];
    if (sizes.length === 0) sizes = trackSizes(data, moov);
    if (sizes.length === 0) return 'AVIF\'in boyutu okunamadı ("ispe" özelliği de iz başlığı da yok).';
    if (!sizes.some((s) => s.width === width && s.height === height)) {
      return `boyutu ${sizes[0]!.width}×${sizes[0]!.height}, bildirilen ${width}×${height}.`;
    }
    return null;
  }
  // stacked-h264
  if (inspectVideo(data)?.type !== 'video/mp4') return 'içerik MP4 değil.';
  const meta = await mp4Metadata(async (position, length) => data.subarray(position, position + length), data.length);
  if (!meta?.video || meta.width === null || meta.height === null) return 'MP4\'te görüntü izi bulunamadı.';
  if (data.indexOf('avcC', 0, 'latin1') < 0) return 'video H.264 (AVC) olmalı.';
  if (meta.width !== info.stackedWidth) {
    return `videonun genişliği ${meta.width}, bildirilen stackedWidth ${info.stackedWidth}.`;
  }
  if (meta.height < height || meta.height > height + VIDEO_HEIGHT_PADDING_PX) {
    return `videonun yüksekliği ${meta.height}, bildirilen ${height}.`;
  }
  return null;
}

/**
 * Yayın paketini (JSON'dan okunmuş değer) bütünüyle doğrular: biçim, bilgi kaydı, dosya listesi, base64,
 * boyut sınırları ve her dosyanın içeriği. Geçersizse CosmeticPackError atar; hiçbir şey yazmaz.
 */
export async function parseBundle(input: unknown): Promise<ParsedBundle> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new CosmeticPackError('Paket bir JSON nesnesi olmalı.');
  }
  const bundle = input as Record<string, unknown>;
  if (bundle.format !== COSMETIC_PACK_FORMAT) {
    throw new CosmeticPackError(`format: ${COSMETIC_PACK_FORMAT} olmalı (bu araç yalnızca o biçimi tanır).`);
  }
  const info = validateCosmeticPackInfo(bundle.pack);
  if (!info.ok) throw new CosmeticPackError(info.error);
  const rawFiles = bundle.files;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) throw new CosmeticPackError('files: en az bir dosya olmalı.');
  // Parça başına her türden en fazla bir dosya olabilir; fazlası zaten geçersizdir
  if (rawFiles.length > 64) throw new CosmeticPackError('files: çok fazla dosya.');

  const metas: CosmeticPackFileInfo[] = [];
  rawFiles.forEach((raw, i) => {
    const meta = validateCosmeticPackFileInfo(raw, `files[${i}]`);
    if (!meta.ok) throw new CosmeticPackError(meta.error);
    metas.push(meta.value);
  });
  const setError = cosmeticPackFileSetError(metas);
  if (setError) throw new CosmeticPackError(setError);

  const files: ParsedBundle['files'] = [];
  let total = 0;
  for (const [i, meta] of metas.entries()) {
    const where = `files[${i}] (${meta.name})`;
    const encoded = (rawFiles[i] as Record<string, unknown>).data;
    if (typeof encoded !== 'string' || encoded.length === 0) throw new CosmeticPackError(`${where}: data base64 metin olmalı.`);
    // Çözmeden önce uzunluktan: sınırı aşan dosya belleğe hiç açılmaz
    const decodedSize = Math.floor((encoded.length * 3) / 4);
    if (decodedSize > COSMETIC_PACK_MAX_FILE_BYTES + 2) {
      throw new CosmeticPackError(`${where}: dosya çok büyük (en fazla ${formatMb(COSMETIC_PACK_MAX_FILE_BYTES)}).`);
    }
    if (encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
      throw new CosmeticPackError(`${where}: data geçerli base64 değil (boşluk ve satır sonu olmamalı).`);
    }
    const data = Buffer.from(encoded, 'base64');
    if (data.length === 0) throw new CosmeticPackError(`${where}: dosya boş.`);
    if (data.length > COSMETIC_PACK_MAX_FILE_BYTES) {
      throw new CosmeticPackError(`${where}: dosya çok büyük (en fazla ${formatMb(COSMETIC_PACK_MAX_FILE_BYTES)}).`);
    }
    total += data.length;
    if (total > COSMETIC_PACK_MAX_BUNDLE_BYTES) {
      throw new CosmeticPackError(`Paket çok büyük (en fazla ${formatMb(COSMETIC_PACK_MAX_BUNDLE_BYTES)}).`);
    }
    let problem: string | null;
    try {
      problem = await inspectPackFile(meta, data);
    } catch {
      problem = 'dosya okunamadı (bozuk olabilir).';
    }
    if (problem) throw new CosmeticPackError(`${where}: ${problem}`);
    files.push({ info: { ...meta, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }, data });
  }
  return { info: info.value, files };
}

/** Dosyaların içerik özeti: dosyalar (ve bildirilen ölçüleri) değişmedikçe aynı kalır */
function packVersion(files: readonly StoredPackFile[]): string {
  const hash = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    hash.update(`${JSON.stringify([f.name, f.piece, f.kind, f.width, f.height, f.stackedWidth ?? null, f.alphaX ?? null, f.sha256])}\n`);
  }
  return hash.digest('hex').slice(0, 16);
}

// ---------- manifest.json ----------

/** manifest.json'un içeriğini doğrular (elle düzenlenmiş ya da bozulmuş olabilir); geçersizse hata atar */
function parseStored(value: unknown): StoredPack[] {
  const root = value as { format?: unknown; packs?: unknown } | null;
  if (!root || root.format !== COSMETIC_PACK_FORMAT || !Array.isArray(root.packs)) throw new Error('biçim tanınmıyor');
  if (root.packs.length > COSMETIC_PACK_MAX_COUNT) throw new Error('çok fazla paket');
  const ids = new Set<string>();
  return root.packs.map((raw: unknown) => {
    const pack = raw as Record<string, unknown>;
    const info = validateCosmeticPackInfo(pack);
    if (!info.ok) throw new Error(info.error);
    if (ids.has(info.value.id)) throw new Error(`"${info.value.id}" iki kez geçiyor`);
    ids.add(info.value.id);
    const { version, publishedAt, files } = pack;
    if (typeof version !== 'string' || !COSMETIC_PACK_VERSION_PATTERN.test(version) || !Array.isArray(files)) {
      throw new Error(`"${info.value.id}" paketinin kaydı bozuk`);
    }
    const parsed = files.map((rawFile: unknown): StoredPackFile => {
      const file = rawFile as Record<string, unknown>;
      const meta = validateCosmeticPackFileInfo(file, `${info.value.id}.files`);
      if (!meta.ok) throw new Error(meta.error);
      const { bytes, sha256 } = file;
      if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0 || bytes > COSMETIC_PACK_MAX_FILE_BYTES) {
        throw new Error(`"${info.value.id}/${meta.value.name}" boyutu geçersiz`);
      }
      if (typeof sha256 !== 'string' || !SHA256.test(sha256)) throw new Error(`"${info.value.id}/${meta.value.name}" özeti geçersiz`);
      return { ...meta.value, bytes, sha256 };
    });
    const setError = cosmeticPackFileSetError(parsed);
    if (setError) throw new Error(`"${info.value.id}": ${setError}`);
    return { ...info.value, version, publishedAt: typeof publishedAt === 'number' ? publishedAt : 0, files: parsed };
  });
}

/** Paketin istemcilere sunulan hali */
function servedPack(pack: StoredPack): CosmeticPack {
  const assets: Record<CosmeticPiece, CosmeticPackAsset[]> = { card: [], deco: [], plate: [] };
  for (const f of pack.files) {
    assets[f.piece].push({
      kind: f.kind,
      url: cosmeticPackFileUrl(pack.id, pack.version, f.name),
      width: f.width,
      height: f.height,
      bytes: f.bytes,
      ...(f.stackedWidth !== undefined && f.alphaX !== undefined ? { stackedWidth: f.stackedWidth, alphaX: f.alphaX } : {}),
    });
  }
  const { id, label, accent, from, to, fallback, description, pieces, loopSeconds, fps, platforms, version } = pack;
  return { id, label, accent, from, to, fallback, description, pieces, loopSeconds, fps, platforms, version, assets };
}

/** Deponun bir anki hali: manifest.json'dan türetilir, dosya değişene kadar bellekte kalır */
interface Snapshot {
  /** manifest.json'un damgası (değişti mi diye); dosya yoksa boş */
  stamp: string;
  packs: StoredPack[];
  byId: Map<string, StoredPack>;
  manifest: CosmeticPackManifest;
  /** Sunulan bildirimin JSON'u ve ETag'i */
  json: string;
  etag: string;
}

function snapshotOf(packs: StoredPack[], stamp: string): Snapshot {
  const served = packs.map(servedPack);
  const version = createHash('sha256').update(JSON.stringify(served)).digest('hex').slice(0, 16);
  const manifest: CosmeticPackManifest = { version, packs: served };
  return {
    stamp,
    packs,
    byId: new Map(packs.map((p) => [p.id, p])),
    manifest,
    json: JSON.stringify(manifest),
    etag: `"${version}"`,
  };
}

function writeDurable(file: string, data: Buffer | string): void {
  // Diske indiği kesinleşmeden adı verilmez: ani kapanmada boş ya da yarım dosya kalmasın
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

const rmQuiet = (target: string): void => {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // Temizlik başarısız (ör. dosya o an okunuyor): sonraki yayında yeniden denenir
  }
};

export interface CosmeticPackStoreOptions {
  /** manifest.json'a bakma aralığı (ms); testlerde 0 */
  recheckMs?: number;
  log?: { warn(obj: unknown, msg?: string): void };
}

export class CosmeticPackStore {
  private snapshot: Snapshot = snapshotOf([], '');
  private checkedAt = Number.NEGATIVE_INFINITY;
  private readonly recheckMs: number;
  private readonly log: CosmeticPackStoreOptions['log'];

  constructor(
    readonly dir: string,
    opts: CosmeticPackStoreOptions = {},
  ) {
    this.recheckMs = opts.recheckMs ?? DEFAULT_RECHECK_MS;
    this.log = opts.log;
  }

  private get manifestFile(): string {
    return path.join(this.dir, MANIFEST_FILE);
  }

  // ---------- Okuma (çalışan sunucu) ----------

  /**
   * Deponun güncel hali. Yayınlama başka bir süreçte (komut satırı aracı) yapıldığından manifest.json'un
   * damgasına (değişiklik zamanı, boyut, düğüm) aralıklı bakılır; değiştiyse yeniden okunur. Bakma ucuzdur
   * (tek stat) ve en çok `recheckMs`de bir yapılır; arada bellekteki hal kullanılır.
   */
  private current(): Snapshot {
    const now = Date.now();
    if (now - this.checkedAt >= this.recheckMs) {
      this.checkedAt = now;
      this.reload(false);
    }
    return this.snapshot;
  }

  /** manifest.json'u (değiştiyse) yeniden okur. `strict`: bozuksa hata atar (komut satırı); değilse eski hal kalır. */
  private reload(strict: boolean): void {
    let stamp = '';
    try {
      const st = fs.statSync(this.manifestFile);
      stamp = `${st.mtimeMs}:${st.size}:${st.ino}`;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (strict) throw err;
        return;
      }
    }
    if (stamp === this.snapshot.stamp && !strict) return;
    try {
      const packs = stamp ? parseStored(JSON.parse(fs.readFileSync(this.manifestFile, 'utf8'))) : [];
      this.snapshot = snapshotOf(packs, stamp);
    } catch (err) {
      if (strict) throw new CosmeticPackError(`manifest.json okunamadı: ${err instanceof Error ? err.message : String(err)}`);
      // Bozuk kayıt: son sağlam hal kullanılmaya devam eder; dosya değişene kadar yeniden denenmez
      this.log?.warn({ err: String(err) }, 'kozmetik paketleri: manifest.json okunamadı, önceki hal kullanılıyor');
      this.snapshot = { ...this.snapshot, stamp };
    }
  }

  /** manifest.json'u hemen okur; bozuksa CosmeticPackError atar (komut satırı: bozuk kayıt boş liste gibi görünmesin) */
  load(): void {
    this.checkedAt = Date.now();
    this.reload(true);
  }

  /** Kimlik şu an seçilebilir mi: yerleşik setlerden biri ya da yayında olan bir paket */
  knows(id: string | null | undefined): boolean {
    return typeof id === 'string' && (isCosmeticSet(id) || this.current().byId.has(id));
  }

  /** İstemcilere sunulan bildirim */
  served(): { manifest: CosmeticPackManifest; json: string; etag: string } {
    return this.current();
  }

  /** Yayınlanmış paketler, gösterim sırasıyla */
  list(): StoredPack[] {
    return this.current().packs;
  }

  /**
   * Sunulacak dosyanın yolu ve türü; sunulamayacaksa null. Yol yalnızca biçimi doğrulanmış parçalardan
   * kurulur ve yalnızca şunlar için:
   * - Yayındaki sürüm: manifest.json'da kayıtlı dosyalar (türü kayıttan).
   * - Yerini yenisine bırakmış sürüm (yeniden yayından sonra, bkz. COSMETIC_PACK_GRACE_MS): paket hâlâ
   *   yayında olmalı; tür yalnızca dosya adının uzantısından (.avif / .webp / .mp4) çıkar. Klasörün var
   *   olduğuna ve dosyanın düz bir dosya olduğuna openFile bakar.
   * Yayından kaldırılan paketin hiçbir dosyası sunulmaz.
   */
  fileOf(id: string, version: string, name: string): { path: string; kind: CosmeticAssetKind; superseded: boolean } | null {
    if (!COSMETIC_SET_ID_PATTERN.test(id) || !COSMETIC_PACK_VERSION_PATTERN.test(version)) return null;
    if (!COSMETIC_PACK_FILE_NAME_PATTERN.test(name)) return null;
    const pack = this.current().byId.get(id);
    if (!pack) return null;
    const superseded = pack.version !== version;
    const kind = superseded ? kindOfName(name) : pack.files.find((f) => f.name === name)?.kind;
    return kind ? { path: path.join(this.dir, id, version, name), kind, superseded } : null;
  }

  /**
   * Sunulacak dosyayı açar (bkz. fileOf); açılamıyorsa null. Önce açılır, boyut açık dosyadan okunur: dosya
   * arada silinse de yanıt tutarlı kalır. Sürüm klasörü gerçek bir klasör, dosya da doğrudan onun içindeki
   * düz bir dosya olmalı (sembolik bağ izlenmez). Dönen tutamacı çağıran kapatır.
   */
  async openFile(id: string, version: string, name: string): Promise<OpenedPackFile | null> {
    const found = this.fileOf(id, version, name);
    if (!found) return null;
    let handle: fs.promises.FileHandle | null = null;
    try {
      const [folder, entry] = await Promise.all([fs.promises.lstat(path.dirname(found.path)), fs.promises.lstat(found.path)]);
      if (!folder.isDirectory() || !entry.isFile()) return null;
      handle = await fs.promises.open(found.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('düz dosya değil');
      return { handle, size: stat.size, contentType: COSMETIC_KIND_CONTENT_TYPE[found.kind] };
    } catch {
      // Yok, okunamıyor ya da düz dosya değil: çağıran 404 döner (yol hiçbir yere yazılmaz)
      await handle?.close().catch(() => undefined);
      return null;
    }
  }

  // ---------- Yazma (komut satırı aracı) ----------

  private get lockFile(): string {
    return path.join(this.dir, LOCK_FILE);
  }

  /**
   * Yazma kilidini alır; alınamıyorsa CosmeticPackError atar. Kilit dosyası sahibini taşır (süreç, makine,
   * an). Eski kilit devralınır: 10 dakikadan eskiyse ya da aynı makinede (kapsayıcıda) sahibi artık
   * çalışmıyorsa (araç öldürülmüş). Devralma atomiktir: eski kilit yeniden adlandırılarak kenara çekilir,
   * aynı anda deneyenlerden yalnızca biri başarır.
   */
  private acquireLock(): string {
    fs.mkdirSync(this.dir, { recursive: true });
    const lock = this.lockFile;
    const token = randomBytes(8).toString('hex');
    const body = JSON.stringify({ token, pid: process.pid, host: os.hostname(), at: Date.now() } satisfies LockInfo);
    const take = (): boolean => {
      try {
        fs.writeFileSync(lock, body, { flag: 'wx' });
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw err;
      }
    };
    const busy = (): CosmeticPackError =>
      new CosmeticPackError(
        'Başka bir yayınlama işlemi sürüyor; bitince yeniden dene. (Araç yarıda kesildiyse ve kilit takılı kaldıysa: --force-unlock)',
      );
    if (take()) return token;
    const held = readLock(lock);
    if (held) {
      if (!lockIsStale(held)) throw busy();
      const aside = `${lock}.${token}`;
      try {
        fs.renameSync(lock, aside);
      } catch (err) {
        // Kilit bu arada kalkmış (bırakılmış ya da başkası kenara çekmiş): aşağıda yeniden denenir
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      if (fs.existsSync(aside)) {
        // Kenara çekilen, az önce bakılan eski kilit olmalı. Arada başkası devralıp kendi kilidini koyduysa o
        // kilit yerine geri konur (yerinde yenisi yoksa) ve vazgeçilir.
        const moved = fs.readFileSync(aside, 'utf8');
        if (moved !== held.raw) {
          try {
            fs.linkSync(aside, lock);
          } catch {
            // yerine başka kilit konmuş
          }
          fs.rmSync(aside, { force: true });
          throw busy();
        }
        fs.rmSync(aside, { force: true });
      }
    }
    if (take()) return token;
    throw busy();
  }

  /** Kilidi bırakır; yalnızca hâlâ bizimse (zorla açılıp başkasınca alınmış kilide dokunulmaz) */
  private releaseLock(token: string): void {
    if (readLock(this.lockFile)?.info?.token === token) fs.rmSync(this.lockFile, { force: true });
  }

  /** Takılı kalmış kilidi kaldırır (komut satırı: --force-unlock). Kilit var mıydı döner. */
  forceUnlock(): boolean {
    const existed = fs.existsSync(this.lockFile);
    fs.rmSync(this.lockFile, { force: true });
    return existed;
  }

  /** Aynı anda tek yazan (bkz. acquireLock) */
  private async locked<T>(work: () => Promise<T> | T): Promise<T> {
    const token = this.acquireLock();
    try {
      // Kilit altında en güncel hal: başka bir süreç az önce yazmış olabilir
      this.reload(true);
      return await work();
    } finally {
      this.releaseLock(token);
    }
  }

  /** manifest.json'u atomik olarak değiştirir (geçici dosya + yeniden adlandırma) ve belleği günceller */
  private writeManifest(packs: StoredPack[]): void {
    const temp = path.join(this.dir, `${MANIFEST_FILE}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      writeDurable(temp, `${JSON.stringify({ format: COSMETIC_PACK_FORMAT, packs }, null, 2)}\n`);
      fs.renameSync(temp, this.manifestFile);
    } catch (err) {
      rmQuiet(temp);
      throw err;
    }
    this.reload(true);
  }

  /**
   * Diski bildirimle eşitler (kilit altında, manifest.json yazıldıktan sonra). Kalanlar: yayındaki her paketin
   * geçerli sürüm klasörü ve en fazla BİR önceki sürümü (yerini bırakalı COSMETIC_PACK_GRACE_MS geçmemişse;
   * `all` ile o da silinir). Gerisi silinir: yayında olmayan kimliklerin klasörleri, daha eski sürümler,
   * yarım kalmış hazırlıklar. Silinen önceki sürüm sayısını döner.
   *
   * Önceki sürümün ne zaman yerini bıraktığı klasörünün değişiklik zamanından okunur (publish o an damgalar);
   * ayrı bir kayıt tutulmaz.
   */
  private sweep(all = false): number {
    const now = Date.now();
    let removed = 0;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const entry of entries) {
      // Yalnızca paket klasörleri: manifest.json, kilit ve tanınmayan adlara dokunulmaz
      if (!entry.isDirectory() || !COSMETIC_SET_ID_PATTERN.test(entry.name)) continue;
      const packDir = path.join(this.dir, entry.name);
      const pack = this.snapshot.byId.get(entry.name);
      if (!pack) {
        rmQuiet(packDir);
        continue;
      }
      const previous: { full: string; at: number }[] = [];
      for (const name of fs.readdirSync(packDir)) {
        if (name === pack.version) continue;
        const full = path.join(packDir, name);
        const st = fs.lstatSync(full, { throwIfNoEntry: false });
        if (st?.isDirectory() && COSMETIC_PACK_VERSION_PATTERN.test(name)) previous.push({ full, at: st.mtimeMs });
        else rmQuiet(full);
      }
      previous.sort((a, b) => b.at - a.at);
      previous.forEach((p, i) => {
        if (!all && i === 0 && now - p.at < COSMETIC_PACK_GRACE_MS) return;
        rmQuiet(p.full);
        removed++;
      });
    }
    return removed;
  }

  /** Saklanan sürüm klasörü eksiksiz mi (her dosya var ve boyutu tutuyor) */
  private intact(id: string, version: string, files: readonly StoredPackFile[]): boolean {
    return files.every((f) => fs.statSync(path.join(this.dir, id, version, f.name), { throwIfNoEntry: false })?.size === f.bytes);
  }

  /**
   * Paketi yayınlar; aynı kimlikte paket varsa yerine geçer (sıradaki yeri korunur). Önce her şey bellekte
   * doğrulanır, sonra dosyalar yeni sürüm klasörüne yazılır, en son manifest.json değiştirilir: herhangi bir
   * adımda hata olursa depo olduğu gibi kalır.
   *
   * Yerini bırakan sürümün klasörü hemen silinmez: bağlı istemciler bildirimi tazeleyene dek eski adresleri
   * kullanır. Bir önceki sürüm COSMETIC_PACK_GRACE_MS boyunca sunulmaya devam eder ve sonraki yayında (ya da
   * `prune` ile) silinir; kimlik başına en fazla bir önceki sürüm tutulur.
   */
  async publish(input: unknown): Promise<StoredPack> {
    const bundle = await parseBundle(input);
    return this.locked(() => {
      const { info } = bundle;
      const packs = this.snapshot.packs;
      const index = packs.findIndex((p) => p.id === info.id);
      if (index < 0 && packs.length >= COSMETIC_PACK_MAX_COUNT) {
        throw new CosmeticPackError(`En fazla ${COSMETIC_PACK_MAX_COUNT} paket yayınlanabilir; önce birini kaldır.`);
      }
      const files = bundle.files.map((f) => f.info);
      const version = packVersion(files);
      const packDir = path.join(this.dir, info.id);
      const target = path.join(packDir, version);
      // Aynı içerik zaten yayında ve eksiksizse dosyalara dokunulmaz (yalnızca bilgi güncellenir)
      const reuse = packs[index]?.version === version && this.intact(info.id, version, files);
      if (!reuse) {
        fs.mkdirSync(packDir, { recursive: true });
        const staging = path.join(packDir, `.tmp-${randomBytes(6).toString('hex')}`);
        try {
          fs.mkdirSync(staging);
          for (const f of bundle.files) writeDurable(path.join(staging, f.info.name), f.data);
          // Hedef varsa yayında değildir (önceki sürüm ya da bozuk bir klasör): yerini yenisi alır
          rmQuiet(target);
          fs.renameSync(staging, target);
        } catch (err) {
          rmQuiet(staging);
          throw err;
        }
      }
      const now = Date.now();
      const previous = packs[index]?.version;
      const pack: StoredPack = { ...info, version, publishedAt: now, files };
      try {
        this.writeManifest(index < 0 ? [...packs, pack] : packs.map((p, i) => (i === index ? pack : p)));
      } catch (err) {
        // Bildirim değişmedi: yeni yazılan klasör yayına girmedi, geri alınır
        if (!reuse) rmQuiet(target);
        throw err;
      }
      // Yerini bırakan sürümün süresi şimdi başlar (bkz. sweep)
      if (previous !== undefined && previous !== version) {
        try {
          fs.utimesSync(path.join(packDir, previous), new Date(now), new Date(now));
        } catch {
          // klasör yok: tutulacak bir şey de yok
        }
      }
      this.sweep();
      return pack;
    });
  }

  /**
   * Paketi yayından kaldırır: önce manifest.json'dan düşer, sonra bütün sürümlerinin dosyaları HEMEN silinir
   * (bekleme süresi yok: kaldırılan paketin dosyaları sunulmaya devam etmez).
   */
  async remove(id: string): Promise<void> {
    await this.locked(() => {
      const packs = this.snapshot.packs;
      if (!packs.some((p) => p.id === id)) throw new CosmeticPackError(`"${id}" adlı paket yok.`);
      this.writeManifest(packs.filter((p) => p.id !== id));
      rmQuiet(path.join(this.dir, id));
      this.sweep();
    });
  }

  /**
   * Yerini yenisine bırakmış, süresi dolmuş önceki sürümleri (ve artık klasörleri) siler; `all`: süresi
   * dolmamış önceki sürümleri de. Silinen önceki sürüm sayısını döner.
   */
  async prune(all = false): Promise<number> {
    return this.locked(() => this.sweep(all));
  }

  /** Paketin oynatıldığı platformları değiştirir (dosyalara dokunmaz) */
  async setPlatforms(id: string, platforms: unknown): Promise<CosmeticPlatform[]> {
    const parsed = parseCosmeticPlatforms(platforms);
    if (!parsed) throw new CosmeticPackError('Platformlar: desktop, android, ios değerlerinden tekrarsız bir liste olmalı.');
    return this.locked(() => {
      const packs = this.snapshot.packs;
      if (!packs.some((p) => p.id === id)) throw new CosmeticPackError(`"${id}" adlı paket yok.`);
      this.writeManifest(packs.map((p) => (p.id === id ? { ...p, platforms: parsed } : p)));
      return parsed;
    });
  }

  /** Gösterim sırası: verilen kimlikler bu sırayla başa gelir, verilmeyenler kendi sıralarıyla arkada kalır */
  async setOrder(ids: readonly string[]): Promise<string[]> {
    return this.locked(() => {
      const packs = this.snapshot.packs;
      if (ids.length === 0) throw new CosmeticPackError('En az bir paket kimliği ver.');
      if (new Set(ids).size !== ids.length) throw new CosmeticPackError('Sıralamada bir kimlik birden çok kez geçiyor.');
      const first = ids.map((id) => {
        const pack = packs.find((p) => p.id === id);
        if (!pack) throw new CosmeticPackError(`"${id}" adlı paket yok.`);
        return pack;
      });
      const next = [...first, ...packs.filter((p) => !ids.includes(p.id))];
      this.writeManifest(next);
      return next.map((p) => p.id);
    });
  }
}
