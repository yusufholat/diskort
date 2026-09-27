// Mesaj arama: Discord'daki gibi sorgu işleçleri (from:, in:, has:, önce:, sonra:, tarih:), Türkçeye
// uygun harf katlama ve eşleşen yerleri vurgulayan özet. Sunucu ve istemciler aynı kodu kullanır.

import type { Message, User } from './index';

/** Bir aramada en fazla sonuç (sayfa) */
export const SEARCH_PAGE_SIZE = 25;
export const SEARCH_MAX_PAGE_SIZE = 50;
/** Sorgu metninin en fazla uzunluğu */
export const SEARCH_MAX_QUERY_LENGTH = 200;
/** Toplam sayı bu kadara kadar sayılır (daha fazlası "1000+" gösterilir) */
export const SEARCH_TOTAL_CAP = 1000;
/** Özetin (snippet) en fazla uzunluğu */
export const SEARCH_SNIPPET_LENGTH = 180;

/** has: süzgeci */
export type SearchHas = 'link' | 'image' | 'video' | 'file';
export const SEARCH_HAS_VALUES: readonly SearchHas[] = ['link', 'image', 'video', 'file'];
export const SEARCH_HAS_LABELS: Record<SearchHas, string> = {
  link: 'bağlantı',
  image: 'resim',
  video: 'video',
  file: 'dosya',
};

/** has: değerinin Türkçe/İngilizce yazımları */
const HAS_ALIASES: Record<string, SearchHas> = {
  link: 'link',
  baglanti: 'link',
  url: 'link',
  image: 'image',
  resim: 'image',
  gorsel: 'image',
  foto: 'image',
  fotograf: 'image',
  video: 'video',
  file: 'file',
  dosya: 'file',
  ek: 'file',
};

/** İşleç anahtarları (katlanmış yazımıyla) */
const OPERATOR_KEYS: Record<string, 'from' | 'in' | 'has' | 'before' | 'after' | 'during'> = {
  from: 'from',
  kimden: 'from',
  in: 'in',
  kanal: 'in',
  has: 'has',
  iceren: 'has',
  icerir: 'has',
  before: 'before',
  once: 'before',
  after: 'after',
  sonra: 'after',
  during: 'during',
  on: 'during',
  tarih: 'during',
};

/** Arama sorgusunun çözümlenmiş hali */
export interface ParsedSearch {
  /** Serbest metin parçaları: sözcükler ve tırnak içindeki ifadeler */
  words: { text: string; phrase: boolean }[];
  /** from: değerleri (kullanıcı adı ya da görünen ad; baştaki @ atılır) */
  from: string[];
  /** in: değerleri (kanal adı; baştaki # atılır) */
  in: string[];
  has: SearchHas[];
  /** önce: / sonra: / tarih: değerleri (çözümlenmemiş) */
  before: string | null;
  after: string | null;
  during: string | null;
}

/**
 * Tek bir karakteri aramadaki karşılığına indirger: küçük harf, aksansız (ç→c, ş→s, ğ→g, ö→o, ü→u) ve
 * Türkçedeki I/ı/İ/i hepsi "i". Uzunluk korunur (bir karakter → bir karakter), böylece katlanmış metindeki
 * konumlar asıl metinde de geçerlidir. Sunucudaki FTS5 dizini de aynı katlamayı yapar (unicode61
 * remove_diacritics 2 + ı→i; bkz. sunucu db.ts).
 */
export function foldSearchChar(ch: string): string {
  if (ch === 'ı' || ch === 'I' || ch === 'İ') return 'i';
  const base = ch.normalize('NFD').charAt(0);
  const lower = base.toLowerCase();
  return lower.length === 1 ? lower : ch;
}

/** Metni aramadaki karşılığına indirger (uzunluk korunur, bkz. foldSearchChar) */
export function foldSearchText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += foldSearchChar(text[i]!);
  return out;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const NON_WORD = /[^\p{L}\p{N}]+/u;

/** Metnin arama sözcükleri (katlanmış; harf ve rakam dizileri) */
export function searchTokens(text: string): string[] {
  return foldSearchText(text).split(NON_WORD).filter(Boolean);
}

/** Sorguyu boşluklardan böler; tırnak içindeki kısımlar tek parçadır ("iki sözcük", from:"Ali Veli") */
function splitQuery(query: string): { raw: string; quoted: boolean }[] {
  const parts: { raw: string; quoted: boolean }[] = [];
  const re = /(\S*?)"([^"]*)"?|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    if (m[3] !== undefined) parts.push({ raw: m[3], quoted: false });
    else parts.push({ raw: `${m[1] ?? ''}${m[2] ?? ''}`, quoted: !m[1] });
  }
  return parts;
}

/** Arama sorgusunu işleçlerine ve serbest metnine ayırır. Bilinmeyen işleçler metin sayılır. */
export function parseSearchQuery(query: string): ParsedSearch {
  const parsed: ParsedSearch = { words: [], from: [], in: [], has: [], before: null, after: null, during: null };
  for (const part of splitQuery(query.slice(0, SEARCH_MAX_QUERY_LENGTH))) {
    const colon = part.quoted ? -1 : part.raw.indexOf(':');
    const key = colon > 0 ? OPERATOR_KEYS[foldSearchText(part.raw.slice(0, colon))] : undefined;
    const value = colon > 0 ? part.raw.slice(colon + 1).trim() : '';
    if (!key || !value) {
      if (part.raw.trim()) parsed.words.push({ text: part.raw.trim(), phrase: part.quoted });
      continue;
    }
    if (key === 'from') parsed.from.push(value.replace(/^@/, ''));
    else if (key === 'in') parsed.in.push(value.replace(/^#/, ''));
    else if (key === 'has') {
      const has = HAS_ALIASES[foldSearchText(value)];
      if (has && !parsed.has.includes(has)) parsed.has.push(has);
      else if (!has) parsed.words.push({ text: part.raw, phrase: false });
    } else parsed[key] = value;
  }
  return parsed;
}

/** Sorguda metin ya da süzgeç var mı (boş arama yapılmaz) */
export function isSearchEmpty(p: ParsedSearch): boolean {
  return (
    p.words.every((w) => searchTokens(w.text).length === 0) &&
    p.from.length === 0 &&
    p.in.length === 0 &&
    p.has.length === 0 &&
    !p.before &&
    !p.after &&
    !p.during
  );
}

/** Vurgulanacak sözcükler (katlanmış) */
export function searchHighlightTerms(p: ParsedSearch): string[] {
  return [...new Set(p.words.flatMap((w) => searchTokens(w.text)))];
}

/**
 * Tarih değerini (GG.AA.YYYY, YYYY-AA-GG, "bugün", "dün") o günün başına (yerel saat) çevirir.
 * `tzOffsetMinutes`: istemcinin Date#getTimezoneOffset() değeri (Türkiye için -180); verilmezse bu
 * ortamın saat dilimi. Geçersizse null.
 */
export function parseSearchDate(value: string, tzOffsetMinutes?: number, now = Date.now()): number | null {
  const v = foldSearchText(value.trim());
  const offset = tzOffsetMinutes ?? new Date(now).getTimezoneOffset();
  // Yerel "şimdi"nin takvim günü: UTC'ye göre kaydırılmış saatten okunur
  const localNow = new Date(now - offset * 60_000);
  let y: number;
  let mo: number;
  let d: number;
  let m: RegExpMatchArray | null;
  if (v === 'bugun' || v === 'today' || v === 'dun' || v === 'yesterday') {
    y = localNow.getUTCFullYear();
    mo = localNow.getUTCMonth() + 1;
    d = localNow.getUTCDate() - (v === 'dun' || v === 'yesterday' ? 1 : 0);
  } else if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else return null;
  if (mo < 1 || mo > 12 || d < 0 || d > 31 || y < 2000 || y > 2100) return null;
  // Date.UTC taşmaları düzeltir (ör. ayın 0. günü = önceki ayın sonu)
  return Date.UTC(y, mo - 1, d) + offset * 60_000;
}

const DAY_MS = 86_400_000;

/**
 * Sorgunun tarih süzgeçleri: [sonra, önce) aralığı (ms). önce:G → G gününün başından önce; sonra:G → G
 * gününün sonundan sonra; tarih:G → yalnızca G günü. Çözümlenemeyen tarih "geçersiz" döner.
 */
export function searchDateRange(
  p: Pick<ParsedSearch, 'before' | 'after' | 'during'>,
  tzOffsetMinutes?: number,
  now?: number,
): { before: number | null; after: number | null } | 'invalid' {
  let before: number | null = null;
  let after: number | null = null;
  const parse = (v: string) => parseSearchDate(v, tzOffsetMinutes, now);
  if (p.before) {
    const t = parse(p.before);
    if (t === null) return 'invalid';
    before = t;
  }
  if (p.after) {
    const t = parse(p.after);
    if (t === null) return 'invalid';
    after = t + DAY_MS;
  }
  if (p.during) {
    const t = parse(p.during);
    if (t === null) return 'invalid';
    after = Math.max(after ?? t, t);
    before = Math.min(before ?? t + DAY_MS, t + DAY_MS);
  }
  return { before, after };
}

/** Metin içinde vurgulanacak aralıklar ([başlangıç, bitiş), sıralı, çakışmasız): sözcük başındaki eşleşmeler */
export function highlightRanges(text: string, terms: readonly string[]): [number, number][] {
  if (terms.length === 0 || !text) return [];
  const folded = foldSearchText(text);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    for (;;) {
      const at = folded.indexOf(term, from);
      if (at < 0) break;
      from = at + 1;
      if (at > 0 && WORD_CHAR.test(folded[at - 1]!)) continue;
      // Önek eşleşmesi: sözcüğün geri kalanı da vurgulanır (Discord gibi, "kitap" → "kitaplar")
      let end = at + term.length;
      while (end < folded.length && WORD_CHAR.test(folded[end]!)) end++;
      ranges.push([at, end]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Sonuçta gösterilen özet: mesajın eşleşen kısmı ve vurgulanacak aralıklar */
export interface SearchSnippet {
  text: string;
  highlights: [number, number][];
}

/**
 * Mesaj metninden özet: kısa metin olduğu gibi; uzun metinde ilk eşleşmenin çevresi ("…" ile).
 * Satır sonları boşluğa çevrilir.
 */
export function searchSnippet(content: string, terms: readonly string[], max = SEARCH_SNIPPET_LENGTH): SearchSnippet {
  const flat = content.replace(/\s/g, ' ');
  const all = highlightRanges(flat, terms);
  if (flat.length <= max) return { text: flat, highlights: all };
  const first = all[0]?.[0] ?? 0;
  let start = Math.max(0, first - Math.floor(max / 4));
  // Sözcük ortasından başlamasın
  if (start > 0) {
    const space = flat.lastIndexOf(' ', start);
    if (space >= 0 && start - space < 20) start = space + 1;
  }
  let end = Math.min(flat.length, start + max);
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > start + max / 2) end = space;
  }
  const prefix = start > 0 ? '…' : '';
  const suffix = end < flat.length ? '…' : '';
  const shift = prefix.length - start;
  const highlights = all
    .filter(([a, b]) => b > start && a < end)
    .map(([a, b]): [number, number] => [Math.max(a, start) + shift, Math.min(b, end) + shift]);
  return { text: prefix + flat.slice(start, end) + suffix, highlights };
}

/** Aramanın kapsamı: bir sunucu (isteğe bağlı tek kanalı) ya da bir direkt mesaj konuşması */
export type SearchScope = { guildId: string; channelId?: string } | { dmId: string };

/** GET /api/search sonucundaki bir mesaj */
export interface SearchResult {
  message: Message;
  /** Mesajın kanalı; DM'de guildId boştur (konuşmanın adı istemcide hesaplanır) */
  channel: { id: string; name: string; guildId: string | null };
  snippet: SearchSnippet;
}

/** GET /api/search yanıtı */
export interface SearchResponse {
  results: SearchResult[];
  /** Eşleşen mesaj sayısı (en fazla SEARCH_TOTAL_CAP; `totalCapped` ise daha fazlası var) */
  total: number;
  totalCapped: boolean;
  /** Sonraki sayfa için `cursor`; yoksa son sayfa */
  nextCursor: string | null;
  /** Vurgulanan sözcükler (katlanmış) */
  terms: string[];
  /** Sonuçlardaki yazarlar (istemcinin tanımadığı eski üyeler de) */
  users: User[];
}
