// Döngü gölgelendiricilerinin testleri için: bir GLSL kaynağında zamanın (`t`) geçtiği her yeri sınıflandırır.
// Döngü biçiminde zaman yalnızca döngüye sığan biçimlerde kullanılabilir; başka her kullanım `other`a düşer.

/** Metnin (UTF-8) SHA-256 özeti, onaltılık (Web Crypto: bu pakette Node tipleri yok) */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface TimeTerms {
  /** `fract(t/P...` : döngünün kesri; P'ler */
  fractions: number[];
  /** `t*SAYI` : sabit hız (açısal hızsa SAYI × P / 2π, hücre hızıysa SAYI × P tam sayı olmalı) */
  rates: number[];
  /** `t*max(1.,floor(...*A+.5))*B` : yıldız başına tam tura yuvarlanan hız; [A, B] */
  rounded: [number, number][];
  /** Tanınmayan kullanım (çevresiyle birlikte): döngü biçiminde boş olmalı */
  other: string[];
}

export function timeTerms(src: string): TimeTerms {
  const out: TimeTerms = { fractions: [], rates: [], rounded: [], other: [] };
  const re = /(?<![\w.])t(?![\w(])/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const before = src.slice(Math.max(0, m.index - 8), m.index);
    const after = src.slice(m.index + 1, m.index + 120);
    // tanım ve aktarım: `float t=u_time`, `float t)`, `float t,`, `f(x,t)`, `f(x,t,y)`
    if (after.startsWith('=u_time')) continue;
    if (/float $/.test(before) && /^[),]/.test(after)) continue;
    if (/[,(]$/.test(before) && /^[),]/.test(after)) continue;
    let k: RegExpExecArray | null;
    if ((k = /^\/([0-9.]+)/.exec(after)) && before.endsWith('fract(')) out.fractions.push(Number(k[1]));
    else if ((k = /^\*max\(1\.,floor\(\([^;]*?\)\*([0-9.]+)\+\.5\)\)\*([0-9.]+)/.exec(after))) out.rounded.push([Number(k[1]), Number(k[2])]);
    else if ((k = /^\*([0-9]+\.?[0-9]*|\.[0-9]+)(?![\w.])/.exec(after))) out.rates.push(Number(k[1]));
    else out.other.push(src.slice(Math.max(0, m.index - 20), m.index + 30));
  }
  return out;
}

/** x bir tam sayıya yeterince yakın mı (GLSL sabitleri 6 basamağa yuvarlanır) */
export const isWhole = (x: number): boolean => Math.abs(x - Math.round(x)) < 1e-4 && Math.round(x) !== 0;
