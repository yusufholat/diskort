// Kozmetik setleri: sunucudan dağıtılan hazır paketler (her parça için kusursuz döngülü medya dosyaları +
// küçük bir bilgi kaydı) ve eski istemcilerin kodla çizdiği altı yerleşik set. Paketler herkese açıktır:
// sahiplik, satın alma ya da yetki yoktur; yayınlanan her set herkesin seçicisinde görünür. Her set üç
// parçadır: profil efekti (kartın tamamını saran), avatar dekorasyonu ve isim plakası; parçalar ayrı ayrı
// seçilir (setler karıştırılabilir).
//
// Paketin yaşamı: geliştirici "yayın paketini" (CosmeticPackBundle, JSON) sunucudaki komut satırı aracına
// verir (bkz. apps/server/src/cosmetics-cli.ts ve docs/kozmetik-paketleri.md); sunucu dosyaları saklar ve
// istemcilere bildirimi (CosmeticPackManifest, GET /api/cosmetics/packs) sunar. İstemci bir seti yalnızca
// paketini oynatarak gösterir (bkz. client-core cosmeticPacks.ts).

// ---------- Yerleşik setler ----------

/**
 * 0.9.1 ve önceki istemcilerin içinde gelen (kodla, gerçek zamanlı çizilen) altı set. O istemciler bu
 * kimlikleri bildirime bakmadan çizer; bu yüzden sunucu bunları her zaman geçerli sayar (paket olarak
 * yayınlanmış olsun olmasın) ve eski istemcilere yalnızca bunları gönderir. Aynı kimliklerle paket
 * yayınlanır: paketleri oynatan istemci seti oradan gösterir.
 */
export const COSMETIC_SETS = ['karadelik', 'sakura', 'kuzey', 'atesbocegi', 'buz', 'neon'] as const;
/** Yerleşik setin kimliği */
export type CosmeticSet = (typeof COSMETIC_SETS)[number];
export const COSMETIC_SET_LABELS: Record<CosmeticSet, string> = {
  karadelik: 'Karadelik',
  sakura: 'Sakura',
  kuzey: 'Kuzey Işıkları',
  atesbocegi: 'Ateşböceği Ormanı',
  buz: 'Kristal Buz',
  neon: 'Neon Yağmur',
};
/** Kimlik yerleşik setlerden biri mi (eski istemcilerin kodla çizdiği) */
export const isCosmeticSet = (v: unknown): v is CosmeticSet =>
  typeof v === 'string' && (COSMETIC_SETS as readonly string[]).includes(v);

// ---------- Set kimliği ----------

/**
 * Bir setin kimliği: yerleşik setlerden biri ya da sunucuda yayınlanmış bir paketin kimliği. Kullanıcının
 * seçimleri (User.animatedEffect, `anim:<kimlik>` dekorasyonu, User.nameplate) bu kimliği taşır. İstemci
 * tanımadığı (bildirimde bulunmayan) kimliği göstermez.
 */
export type CosmeticSetId = string;
export const COSMETIC_SET_ID_PATTERN = /^[a-z][a-z0-9-]{1,23}$/;
/**
 * Her nesnede zaten bulunan adlar (constructor, toString, __proto__…): set kimliği olamazlar. Böylece
 * kimlikle düz bir nesneye bakan kod (ör. `tablo[kimlik]`) kalıtılan bir üyeyi set sanmaz.
 */
const isObjectMember = (v: string): boolean => v in Object.prototype;
export const isCosmeticSetId = (v: unknown): v is CosmeticSetId =>
  typeof v === 'string' && COSMETIC_SET_ID_PATTERN.test(v) && !isObjectMember(v);
/**
 * Paket kimliği olamayan adlar: kaldırılan parçacıklı profil efektleri. 0.8.x istemcilerin seçicisi bunları
 * hâlâ gönderebilir (sunucu sessizce yok sayar); aynı adla paket yayınlanırsa o istek paketi seçerdi.
 */
export const RESERVED_COSMETIC_SET_IDS: readonly string[] = ['snow', 'sparkles', 'petals'];

// ---------- Paket sözleşmesi ----------

/** Yayın paketinin biçim sürümü */
export const COSMETIC_PACK_FORMAT = 1;

/** Setin parçaları: profil kartı efekti, avatar dekorasyonu, isim plakası */
export const COSMETIC_PIECES = ['card', 'deco', 'plate'] as const;
export type CosmeticPiece = (typeof COSMETIC_PIECES)[number];

/**
 * Dosya türleri:
 * - avif, webp: saydam (alfa kanallı) hareketli resim
 * - stacked-h264: sıradan, saydam olmayan bir MP4; karesi yan yana [önceden çarpılmış renk | boşluk | gri
 *   tonlu alfa]. `width`/`height` görünen kare, `stackedWidth` videonun tam genişliği, `alphaX` alfa
 *   yarısının başladığı sütun. İstemci iki yarıyı birleştirerek saydam görüntü elde eder.
 * - poster: saydam, sabit bir WebP: "hareketi azalt" açıkken, durdurulmuş görünümlerde ve yüklenirken.
 */
export const COSMETIC_ASSET_KINDS = ['avif', 'webp', 'stacked-h264', 'poster'] as const;
export type CosmeticAssetKind = (typeof COSMETIC_ASSET_KINDS)[number];
/** Hareketli türler (poster dışındakiler) */
export type CosmeticAnimatedKind = Exclude<CosmeticAssetKind, 'poster'>;
/** Tek başına resim olarak gösterilebilen türler (video birleştirme gerektirmeyen) */
export const COSMETIC_IMAGE_KINDS: readonly CosmeticAssetKind[] = ['poster', 'avif', 'webp'];

/** Paketin OYNATILDIĞI platformlar (ClientPlatform ile aynı değerler) */
export const COSMETIC_PLATFORMS = ['desktop', 'android', 'ios'] as const;
export type CosmeticPlatform = (typeof COSMETIC_PLATFORMS)[number];

/** Paketteki dosya adı: küçük harf, rakam, nokta ve tire; uzantısı türüne uymalı (bkz. COSMETIC_KIND_EXTENSION) */
export const COSMETIC_PACK_FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{0,39}$/;
/** Türün dosya uzantısı ve sunulurken gönderilen Content-Type */
export const COSMETIC_KIND_EXTENSION: Record<CosmeticAssetKind, string> = {
  avif: '.avif',
  webp: '.webp',
  'stacked-h264': '.mp4',
  poster: '.webp',
};
export const COSMETIC_KIND_CONTENT_TYPE: Record<CosmeticAssetKind, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  'stacked-h264': 'video/mp4',
  poster: 'image/webp',
};
/** Paketin sürümü: dosyaların içerik özeti (onaltılık) */
export const COSMETIC_PACK_VERSION_PATTERN = /^[0-9a-f]{12,64}$/;

/** Sınırlar (çözülmüş bayt) */
export const COSMETIC_PACK_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const COSMETIC_PACK_MAX_BUNDLE_BYTES = 40 * 1024 * 1024;
export const COSMETIC_PACK_MAX_COUNT = 64;
/** Görünen karenin kenarı (piksel) */
export const COSMETIC_PACK_MIN_SIZE_PX = 8;
export const COSMETIC_PACK_MAX_SIZE_PX = 2048;
/** Yan yana videonun en büyük genişliği (piksel) */
export const COSMETIC_PACK_MAX_STACKED_WIDTH_PX = 4096;
export const COSMETIC_PACK_LABEL_MAX_LENGTH = 40;
export const COSMETIC_PACK_DESCRIPTION_MAX_LENGTH = 400;
export const COSMETIC_PACK_PIECE_TEXT_MAX_LENGTH = 160;
export const COSMETIC_PACK_MAX_LOOP_SECONDS = 60;
export const COSMETIC_PACK_MAX_FPS = 60;

/**
 * Paketin bilgi kaydı: client-core'daki CosmeticSetInfo (renkler, açıklamalar) + ad + oynatma bilgisi.
 * Renkler istemcide CSS'e ve çizime olduğu gibi girer; biçimleri bu yüzden katıdır (bkz.
 * validateCosmeticPackInfo).
 */
export interface CosmeticPackInfo {
  id: CosmeticSetId;
  /** Setin adı (seçicide görünen) */
  label: string;
  /** Vurgu rengi ("#rrggbb") */
  accent: string;
  /** Degradenin iki rengi ("#rrggbb") */
  from: string;
  to: string;
  /** Sabit görünüm: iki degrade rengi ("#rrggbb") ve bir parıltı ("#rrggbb" ya da "rgba(r,g,b,a)") */
  fallback: [string, string, string];
  description: string;
  /** Parçaların tek satırlık açıklamaları: profil efekti, avatar dekorasyonu, isim plakası */
  pieces: [string, string, string];
  /** Döngünün süresi (saniye) ve kare hızı */
  loopSeconds: number;
  fps: number;
  /**
   * Paketin oynatıldığı platformlar. Listede olmayan platformda istemci paketi OYNATMAZ: bilgi renklerinden
   * sabit bir görünüm gösterir. Emniyet supabıdır: bir platformda oynatma sorun çıkarırsa sürüm çıkarmadan
   * sunucudan kapatılır (cosmetics-cli platforms).
   */
  platforms: CosmeticPlatform[];
}

/** Yayın paketindeki bir dosyanın bilgisi (içeriği hariç) */
export interface CosmeticPackFileInfo {
  piece: CosmeticPiece;
  kind: CosmeticAssetKind;
  name: string;
  /** Görünen karenin boyutu (piksel) */
  width: number;
  height: number;
  /** Yalnızca stacked-h264: videonun tam genişliği ve alfa yarısının başladığı sütun */
  stackedWidth?: number;
  alphaX?: number;
}

export interface CosmeticPackBundleFile extends CosmeticPackFileInfo {
  /** Dosyanın içeriği: standart base64 (boşluk ve satır sonu olmadan) */
  data: string;
}

/** Yayın paketi: sunucudaki komut satırı aracına (cosmetics-cli publish) standart girdiden verilir */
export interface CosmeticPackBundle {
  format: typeof COSMETIC_PACK_FORMAT;
  pack: CosmeticPackInfo;
  files: CosmeticPackBundleFile[];
}

/** Bildirimdeki bir dosya */
export interface CosmeticPackAsset {
  kind: CosmeticAssetKind;
  /** Sunucu köküne göre adres (/api/cosmetics/packs/<kimlik>/<sürüm>/<ad>); süresiz önbelleklenebilir */
  url: string;
  width: number;
  height: number;
  bytes: number;
  stackedWidth?: number;
  alphaX?: number;
}

/** Bildirimdeki bir paket */
export interface CosmeticPack extends CosmeticPackInfo {
  /** Dosyaların içerik özeti: dosyalar değişince değişir (adresler de) */
  version: string;
  assets: Record<CosmeticPiece, CosmeticPackAsset[]>;
}

/** GET /api/cosmetics/packs: yayınlanmış paketler, gösterim sırasıyla */
export interface CosmeticPackManifest {
  /** Bildirimin özeti (ETag'in de değeri): herhangi bir şey değişince değişir */
  version: string;
  packs: CosmeticPack[];
}

/** Paket dosyasının sunucu köküne göre adresi */
export const cosmeticPackFileUrl = (id: string, version: string, name: string): string =>
  `/api/cosmetics/packs/${id}/${version}/${name}`;

// ---------- Doğrulama ----------

export type CosmeticValidation<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const HEX = /^#[0-9a-f]{6}$/;
/** rgb(r,g,b) ya da rgba(r,g,b,a): yalnızca rakam, virgül, nokta ve boşluk (CSS'e olduğu gibi girer) */
const RGBA = /^rgba?\( ?(\d{1,3}) ?, ?(\d{1,3}) ?, ?(\d{1,3}) ?(?:, ?(0|1|0?\.\d{1,3}|1\.0{1,3}) ?)?\)$/;
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** "#rrggbb" (büyük harf de kabul edilir, küçüğe çevrilir); değilse null */
function hexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const lower = v.toLowerCase();
  return HEX.test(lower) ? lower : null;
}

/** "#rrggbb" ya da "rgb(a)(…)" (kanallar 0-255); değilse null */
function cssColor(v: unknown): string | null {
  const hex = hexColor(v);
  if (hex) return hex;
  if (typeof v !== 'string' || v.length > 40) return null;
  const lower = v.toLowerCase();
  const m = RGBA.exec(lower);
  if (!m) return null;
  if (lower.startsWith('rgba') !== (m[4] !== undefined)) return null;
  return [m[1], m[2], m[3]].every((c) => Number(c) <= 255) ? lower : null;
}

/** Kırpılmış, denetim ve yazı yönü karakteri içermeyen, en fazla `max` karakterlik metin; değilse null */
function text(v: unknown, max: number, allowEmpty = false): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (UNSAFE_TEXT.test(trimmed)) return null;
  const length = Array.from(trimmed).length;
  if (length > max || (!allowEmpty && length === 0)) return null;
  return trimmed;
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Platform listesi: tekrarsız, yalnızca bilinen platformlar; değilse null. Boş liste geçerlidir (hiçbir yerde oynatılmaz). */
export function parseCosmeticPlatforms(v: unknown): CosmeticPlatform[] | null {
  if (!Array.isArray(v) || v.length > COSMETIC_PLATFORMS.length) return null;
  const result: CosmeticPlatform[] = [];
  for (const p of v) {
    if (!(COSMETIC_PLATFORMS as readonly unknown[]).includes(p) || result.includes(p as CosmeticPlatform)) return null;
    result.push(p as CosmeticPlatform);
  }
  // Sıra anlam taşımaz: sabit sıraya getirilir (aynı içerik aynı bildirimi versin)
  return COSMETIC_PLATFORMS.filter((p) => result.includes(p));
}

/** Paketin bilgi kaydını doğrular; geçerliyse yalnızca bilinen alanlardan kurulmuş temiz bir kopya döner. */
export function validateCosmeticPackInfo(value: unknown): CosmeticValidation<CosmeticPackInfo> {
  if (!isRecord(value)) return fail('pack: nesne olmalı.');
  const { id } = value;
  if (typeof id === 'string' && (RESERVED_COSMETIC_SET_IDS.includes(id) || isObjectMember(id))) {
    return fail(`pack.id: "${id}" ayrılmış bir ad, kullanılamaz.`);
  }
  if (!isCosmeticSetId(id)) return fail('pack.id: küçük harfle başlamalı; 2-24 karakter; küçük harf, rakam ve tire.');
  const label = text(value.label, COSMETIC_PACK_LABEL_MAX_LENGTH);
  if (label === null) return fail(`pack.label: 1-${COSMETIC_PACK_LABEL_MAX_LENGTH} karakterlik metin olmalı.`);
  const accent = hexColor(value.accent);
  const from = hexColor(value.from);
  const to = hexColor(value.to);
  if (!accent || !from || !to) return fail('pack.accent / from / to: "#rrggbb" biçiminde renk olmalı.');
  const fb = value.fallback;
  if (!Array.isArray(fb) || fb.length !== 3) return fail('pack.fallback: üç renk olmalı.');
  const fallback = [hexColor(fb[0]), hexColor(fb[1]), cssColor(fb[2])];
  if (!fallback[0] || !fallback[1] || !fallback[2]) {
    return fail('pack.fallback: ilk iki renk "#rrggbb", üçüncüsü "#rrggbb" ya da "rgba(r,g,b,a)" olmalı.');
  }
  const description = text(value.description, COSMETIC_PACK_DESCRIPTION_MAX_LENGTH, true);
  if (description === null) {
    return fail(`pack.description: en fazla ${COSMETIC_PACK_DESCRIPTION_MAX_LENGTH} karakterlik metin olmalı.`);
  }
  const rawPieces = value.pieces;
  if (!Array.isArray(rawPieces) || rawPieces.length !== 3) return fail('pack.pieces: üç açıklama olmalı.');
  const pieces = rawPieces.map((p) => text(p, COSMETIC_PACK_PIECE_TEXT_MAX_LENGTH, true));
  if (pieces.some((p) => p === null)) {
    return fail(`pack.pieces: her biri en fazla ${COSMETIC_PACK_PIECE_TEXT_MAX_LENGTH} karakterlik metin olmalı.`);
  }
  const { loopSeconds, fps } = value;
  if (typeof loopSeconds !== 'number' || !Number.isFinite(loopSeconds) || loopSeconds < 1 || loopSeconds > COSMETIC_PACK_MAX_LOOP_SECONDS) {
    return fail(`pack.loopSeconds: 1-${COSMETIC_PACK_MAX_LOOP_SECONDS} arasında sayı olmalı.`);
  }
  if (!isInt(fps, 1, COSMETIC_PACK_MAX_FPS)) return fail(`pack.fps: 1-${COSMETIC_PACK_MAX_FPS} arasında tam sayı olmalı.`);
  const platforms = parseCosmeticPlatforms(value.platforms);
  if (!platforms) return fail(`pack.platforms: ${COSMETIC_PLATFORMS.join(', ')} değerlerinden tekrarsız bir liste olmalı.`);
  return {
    ok: true,
    value: {
      id,
      label,
      accent,
      from,
      to,
      fallback: fallback as [string, string, string],
      description,
      pieces: pieces as [string, string, string],
      loopSeconds,
      fps,
      platforms,
    },
  };
}

/** Bir dosyanın bilgisini (içeriği hariç) doğrular: parça, tür, ad, boyutlar. `where`: hata iletisindeki yer. */
export function validateCosmeticPackFileInfo(value: unknown, where = 'file'): CosmeticValidation<CosmeticPackFileInfo> {
  if (!isRecord(value)) return fail(`${where}: nesne olmalı.`);
  const { piece, kind, name, width, height, stackedWidth, alphaX } = value;
  if (!(COSMETIC_PIECES as readonly unknown[]).includes(piece)) {
    return fail(`${where}.piece: ${COSMETIC_PIECES.join(', ')} değerlerinden biri olmalı.`);
  }
  if (!(COSMETIC_ASSET_KINDS as readonly unknown[]).includes(kind)) {
    return fail(`${where}.kind: ${COSMETIC_ASSET_KINDS.join(', ')} değerlerinden biri olmalı.`);
  }
  const k = kind as CosmeticAssetKind;
  if (typeof name !== 'string' || !COSMETIC_PACK_FILE_NAME_PATTERN.test(name)) {
    return fail(`${where}.name: 1-40 karakter; küçük harf, rakam, nokta ve tire; harf ya da rakamla başlamalı.`);
  }
  const ext = COSMETIC_KIND_EXTENSION[k];
  if (!name.endsWith(ext) || name.length === ext.length) return fail(`${where}.name: "${k}" türünün uzantısı ${ext} olmalı.`);
  if (!isInt(width, COSMETIC_PACK_MIN_SIZE_PX, COSMETIC_PACK_MAX_SIZE_PX) || !isInt(height, COSMETIC_PACK_MIN_SIZE_PX, COSMETIC_PACK_MAX_SIZE_PX)) {
    return fail(`${where}.width / height: ${COSMETIC_PACK_MIN_SIZE_PX}-${COSMETIC_PACK_MAX_SIZE_PX} arasında tam sayı olmalı.`);
  }
  const info: CosmeticPackFileInfo = { piece: piece as CosmeticPiece, kind: k, name, width, height };
  if (k === 'stacked-h264') {
    // Renk yarısı solda [0, width), alfa yarısı [alphaX, alphaX + width): üst üste binmez, videodan taşmaz
    if (!isInt(stackedWidth, 2 * width, COSMETIC_PACK_MAX_STACKED_WIDTH_PX)) {
      return fail(`${where}.stackedWidth: en az 2 × width, en fazla ${COSMETIC_PACK_MAX_STACKED_WIDTH_PX} olan tam sayı olmalı.`);
    }
    if (!isInt(alphaX, width, stackedWidth - width)) {
      return fail(`${where}.alphaX: width ile stackedWidth - width arasında tam sayı olmalı.`);
    }
    info.stackedWidth = stackedWidth;
    info.alphaX = alphaX;
  } else if (stackedWidth !== undefined || alphaX !== undefined) {
    return fail(`${where}: stackedWidth ve alphaX yalnızca stacked-h264 türünde bulunur.`);
  }
  return { ok: true, value: info };
}

/**
 * Dosya listesinin bütününü doğrular: adlar tekrarsız, parça başına her türden en fazla bir dosya ve her
 * parçada (kart, dekorasyon, plaka) en az bir resim (poster, avif ya da webp: "hareketi azalt" ve yüklenme
 * anı için; yalnızca video yetmez). Bir parçanın bütün dosyaları aynı görünen boyutu bildirmelidir: oynatıcı
 * kutuyu hareketli dosyanın boyutundan kurar ve posteri aynı kutuda gösterir (farklı boyutlu poster esnerdi).
 * Hata varsa iletisi, yoksa null.
 */
export function cosmeticPackFileSetError(files: readonly CosmeticPackFileInfo[]): string | null {
  const names = new Set<string>();
  const slots = new Set<string>();
  for (const f of files) {
    if (names.has(f.name)) return `files: "${f.name}" adı birden çok kez geçiyor.`;
    names.add(f.name);
    const slot = `${f.piece}/${f.kind}`;
    if (slots.has(slot)) return `files: "${f.piece}" parçasında birden çok "${f.kind}" dosyası var.`;
    slots.add(slot);
  }
  for (const piece of COSMETIC_PIECES) {
    if (!files.some((f) => f.piece === piece && COSMETIC_IMAGE_KINDS.includes(f.kind))) {
      return `files: "${piece}" parçasında en az bir resim (poster, avif ya da webp) olmalı.`;
    }
    const [first, ...rest] = files.filter((f) => f.piece === piece);
    const other = first && rest.find((f) => f.width !== first.width || f.height !== first.height);
    if (first && other) {
      return (
        `files: "${piece}" parçasının dosyaları aynı görünen boyutu (width × height) bildirmeli: ` +
        `"${first.name}" ${first.width}×${first.height}, "${other.name}" ${other.width}×${other.height}.`
      );
    }
  }
  return null;
}

/**
 * Sunucudan gelen (ya da cihazda saklanmış) bildirimi okur. Hoşgörülüdür: tanınmayan tür ve platformlar
 * (ileride eklenebilir) atlanır, bilgisi geçersiz paket listeden düşer; bildirimin kendisi bozuksa null.
 * Dosya adresleri yalnızca paketin kendi klasörünü gösterebilir.
 */
export function parseCosmeticPackManifest(value: unknown): CosmeticPackManifest | null {
  if (!isRecord(value) || typeof value.version !== 'string' || !COSMETIC_PACK_VERSION_PATTERN.test(value.version)) return null;
  if (!Array.isArray(value.packs)) return null;
  const packs: CosmeticPack[] = [];
  const seen = new Set<string>();
  for (const raw of value.packs.slice(0, COSMETIC_PACK_MAX_COUNT)) {
    if (!isRecord(raw)) continue;
    const platforms = Array.isArray(raw.platforms)
      ? COSMETIC_PLATFORMS.filter((p) => (raw.platforms as unknown[]).includes(p))
      : [];
    const info = validateCosmeticPackInfo({ ...raw, platforms });
    const { version, assets } = raw;
    if (!info.ok || seen.has(info.value.id)) continue;
    if (typeof version !== 'string' || !COSMETIC_PACK_VERSION_PATTERN.test(version) || !isRecord(assets)) continue;
    const parsed: Record<CosmeticPiece, CosmeticPackAsset[]> = { card: [], deco: [], plate: [] };
    const prefix = cosmeticPackFileUrl(info.value.id, version, '');
    for (const piece of COSMETIC_PIECES) {
      const list = assets[piece];
      if (!Array.isArray(list)) continue;
      for (const a of list.slice(0, 16)) {
        if (!isRecord(a) || typeof a.url !== 'string' || !a.url.startsWith(prefix)) continue;
        const name = a.url.slice(prefix.length);
        const file = validateCosmeticPackFileInfo({
          piece,
          kind: a.kind,
          name,
          width: a.width,
          height: a.height,
          stackedWidth: a.stackedWidth,
          alphaX: a.alphaX,
        });
        if (!file.ok || !isInt(a.bytes, 1, COSMETIC_PACK_MAX_FILE_BYTES)) continue;
        if (parsed[piece].some((other) => other.kind === file.value.kind)) continue;
        const { kind, width, height, stackedWidth, alphaX } = file.value;
        parsed[piece].push({
          kind,
          url: a.url,
          width,
          height,
          bytes: a.bytes,
          ...(stackedWidth !== undefined && alphaX !== undefined ? { stackedWidth, alphaX } : {}),
        });
      }
    }
    seen.add(info.value.id);
    packs.push({ ...info.value, version, assets: parsed });
  }
  return { version: value.version, packs };
}
