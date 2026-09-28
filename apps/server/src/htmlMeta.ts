// Sayfanın <head> bölümünden önizleme bilgileri: OpenGraph, Twitter kartı, <title>, description,
// theme-color. HTML ağacı kurulmaz; yalnızca <meta>/<link>/<title> etiketleri okunur (betik, stil ve
// yorumlar önceden çıkarılır). Metinler düz metindir: varlıklar (&amp; vb.) çözülür, kontrol ve yön
// değiştirme karakterleri atılır, boşluklar sadeleşir ve uzunluklar sınırlanır.

export interface PageMeta {
  title: string | null;
  description: string | null;
  siteName: string | null;
  author: string | null;
  color: string | null;
  /** Mutlak http(s) adresi */
  image: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  /** twitter:card (ör. "summary_large_image") */
  card: string | null;
}

export const TITLE_MAX = 256;
export const DESCRIPTION_MAX = 350;
export const NAME_MAX = 100;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  times: '×',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});?/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// Kontrol karakterleri (satır sonu hariç), yön değiştiriciler ve sıfır genişlikli biçim karakterleri
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F​‎‏‪-‮⁠-⁩﻿￹-￻]/g;

/** Kod noktası sayısına göre kısaltır ("…" ile) */
function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/** Tek satırlık metin (başlık, ad) */
export function cleanLine(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  const text = raw.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return text ? clip(text, max) : null;
}

/** Çok satırlı metin (açıklama): satır sonları korunur, en fazla iki boş satır */
export function cleanText(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(UNSAFE_CHARS, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? clip(text, max) : null;
}

/** #rgb / #rrggbb → #rrggbb (küçük harf); diğerleri null */
export function cleanColor(raw: string | null | undefined): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw?.trim() ?? '');
  if (!m) return null;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return `#${hex.toLowerCase()}`;
}

/** Göreli adresi sayfaya göre çözer; yalnızca http(s) ve kullanıcı bilgisi olmayanlar */
export function absoluteUrl(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim(), base);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    return url.href.length <= 2048 ? url.href : null;
  } catch {
    return null;
  }
}

function dimension(raw: string | undefined): number | null {
  const n = raw ? Number(raw.trim()) : Number.NaN;
  return Number.isInteger(n) && n > 0 && n <= 20_000 ? n : null;
}

const ATTR = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(ATTR)) {
    const name = m[1]!.toLowerCase();
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** <meta charset> ya da http-equiv Content-Type içindeki karakter kümesi (baştaki 2 KB'de) */
export function sniffCharset(head: string): string | null {
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_:.-]+)/i.exec(head.slice(0, 2048));
  return m ? m[1]!.toLowerCase() : null;
}

/** Gövdeyi metne çevirir: başlıktaki, yoksa sayfadaki karakter kümesiyle (bilinmiyorsa UTF-8) */
export function decodeHtml(data: Buffer, headerCharset: string | null): string {
  const charset = headerCharset ?? sniffCharset(data.subarray(0, 2048).toString('latin1')) ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(data);
  } catch {
    return new TextDecoder('utf-8').decode(data);
  }
}

// Tarama sınırı: 1 MB'lık gövdenin tamamı taranmaz; <head> bölgesi (ilk <body'ye kadar) en fazla bu
// kadar karakterdir. Büyük satır içi CSS/JS barındıran sayfalarda etiketler geride kalabildiği için
// sınır 64 KB'den geniş tutuldu; tarayıcı doğrusal olduğundan maliyeti küçüktür.
export const HEAD_SCAN_MAX = 256 * 1024;
// Tek bir <meta> etiketinin öznitelik metni bundan uzunsa yok sayılır (öznitelik ifadesi uzun ve
// kapanmamış tırnaklarda karesel çalışabilir; gerçek etiketler birkaç KB'yi geçmez)
const META_ATTRS_MAX = 8 * 1024;

/**
 * `pattern`in (g bayraklı) `from` konumundan sonraki ilk eşleşmesini bulur ve sonucu saklar: sonraki
 * aramalar önceki sonuca kadar yeniden taramaz. Eşleşme hiç yoksa bu bir kez öğrenilir; böylece art arda
 * gelen kapanmamış açılışlar (ör. binlerce "<!--") karesel değil doğrusal maliyetle geçilir.
 */
function forwardFinder(text: string, pattern: RegExp): (from: number) => { at: number; end: number } | null {
  let cachedFrom = -1;
  let cached: { at: number; end: number } | null = null;
  return (from) => {
    if (cachedFrom >= 0 && from >= cachedFrom && (cached === null || cached.at >= from)) return cached;
    pattern.lastIndex = from;
    const m = pattern.exec(text);
    cachedFrom = from;
    cached = m ? { at: m.index, end: m.index + m[0].length } : null;
    return cached;
  };
}

const OPEN_TAG = /<(!--|script\b|style\b|noscript\b|meta\b|title\b|body[\s>])/iy;

/** Sayfanın önizleme bilgileri; `base` göreli adreslerin çözüleceği (son) adres */
export function parseHtmlMeta(html: string, base: string): PageMeta {
  // Doğrusal tarayıcı (tembel [\s\S]*? ifadeleri kapanmamış açılışlarda olay döngüsünü kilitliyordu):
  // yorumlar ve betik/stil/noscript blokları atlanır, ilk <body'de durulur. Kapanmamış yorum/blok
  // eskisi gibi olduğu yerde bırakılır (arkasındaki etiketler okunmaya devam eder).
  const text = html.length > HEAD_SCAN_MAX ? html.slice(0, HEAD_SCAN_MAX) : html;
  const closers = {
    comment: forwardFinder(text, /-->/g),
    script: forwardFinder(text, /<\/script\s*>/gi),
    style: forwardFinder(text, /<\/style\s*>/gi),
    noscript: forwardFinder(text, /<\/noscript\s*>/gi),
    title: forwardFinder(text, /<\/title\s*>/gi),
  };
  const nextGt = forwardFinder(text, />/g);

  const metaAttrs: string[] = [];
  let titleOpenEnd = -1;
  let stopAt = text.length;
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    OPEN_TAG.lastIndex = lt;
    const m = OPEN_TAG.exec(text);
    if (!m) {
      i = lt + 1;
      continue;
    }
    const kind = m[1]!.toLowerCase();
    const after = lt + m[0].length;
    if (kind === '!--') {
      const close = closers.comment(after);
      i = close ? close.end : lt + 1;
    } else if (kind === 'script' || kind === 'style' || kind === 'noscript') {
      const close = closers[kind](after);
      i = close ? close.end : lt + 1;
    } else if (kind === 'meta' || kind === 'title') {
      const gt = nextGt(after);
      if (!gt) break; // ileride hiç ">" yok: okunacak etiket kalmadı
      if (kind === 'meta') {
        const attrs = text.slice(after, gt.at);
        if (attrs.length <= META_ATTRS_MAX) metaAttrs.push(attrs);
      } else if (titleOpenEnd < 0) {
        titleOpenEnd = gt.end;
      }
      i = gt.end;
    } else {
      // <body: en baştaki gövde etiketi eskisi gibi kesmez
      if (lt > 0) {
        stopAt = lt;
        break;
      }
      i = lt + 1;
    }
  }
  let titleTag: string | undefined;
  if (titleOpenEnd >= 0) {
    const close = closers.title(titleOpenEnd);
    if (close && close.end <= stopAt) titleTag = text.slice(titleOpenEnd, close.at);
  }

  const meta = new Map<string, string>();
  for (const source of metaAttrs) {
    const attrs = attributes(source);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? '').trim().toLowerCase();
    const value = attrs.content;
    if (!key || value === undefined || meta.has(key)) continue;
    meta.set(key, value);
  }
  const get = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = meta.get(k)?.trim();
      if (v) return v;
    }
    return null;
  };

  const image = absoluteUrl(
    get('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src', 'image'),
    base,
  );
  return {
    title: cleanLine(get('og:title', 'twitter:title') ?? (titleTag ? decodeEntities(titleTag) : null), TITLE_MAX),
    description: cleanText(get('og:description', 'twitter:description', 'description'), DESCRIPTION_MAX),
    siteName: cleanLine(get('og:site_name', 'application-name'), NAME_MAX),
    author: cleanLine(get('author'), NAME_MAX),
    color: cleanColor(get('theme-color', 'msapplication-tilecolor')),
    image,
    imageWidth: image ? dimension(get('og:image:width') ?? undefined) : null,
    imageHeight: image ? dimension(get('og:image:height') ?? undefined) : null,
    card: get('twitter:card')?.toLowerCase() ?? null,
  };
}
