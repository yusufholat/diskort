// Prometheus metin biçimi (text/plain; version=0.0.4) okuyucusu: yönetim paneli LiveKit'in ve Caddy'nin
// ölçümlerini buradan okur. Yalnızca ihtiyaç duyulan kadarı: "ad{etiket="değer",...} sayı [zaman]" satırları;
// yorumlar (# HELP, # TYPE) atlanır.

export interface PromSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)(?:\s+\S+)?$/;
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

function parseValue(raw: string): number {
  if (raw === '+Inf') return Number.POSITIVE_INFINITY;
  if (raw === '-Inf') return Number.NEGATIVE_INFINITY;
  return Number(raw);
}

export function parsePromText(text: string): PromSample[] {
  const out: PromSample[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    const value = parseValue(m[3]!);
    if (Number.isNaN(value)) continue;
    const labels: Record<string, string> = {};
    if (m[2]) {
      for (const l of m[2].matchAll(LABEL)) labels[l[1]!] = l[2]!.replace(/\\(.)/g, (_s, c: string) => (c === 'n' ? '\n' : c));
    }
    out.push({ name: m[1]!, labels, value });
  }
  return out;
}

/** Ada göre gruplanmış ölçümler (sorgular için) */
export class PromSnapshot {
  private readonly byName = new Map<string, PromSample[]>();

  constructor(
    samples: PromSample[],
    readonly at: number,
  ) {
    for (const s of samples) {
      const list = this.byName.get(s.name);
      if (list) list.push(s);
      else this.byName.set(s.name, [s]);
    }
  }

  static parse(text: string, at: number): PromSnapshot {
    return new PromSnapshot(parsePromText(text), at);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  /** Adın (etiket süzgeciyle) tüm serilerinin toplamı; hiç seri yoksa null */
  sum(name: string, filter?: (labels: Record<string, string>) => boolean): number | null {
    const list = this.byName.get(name);
    if (!list) return null;
    let total = 0;
    let found = false;
    for (const s of list) {
      if (filter && !filter(s.labels)) continue;
      if (!Number.isFinite(s.value)) continue;
      total += s.value;
      found = true;
    }
    return found ? total : filter ? 0 : null;
  }

  /** Bir etikete göre toplamlar (ör. kind → audio/video) */
  sumBy(name: string, label: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.byName.get(name) ?? []) {
      if (!Number.isFinite(s.value)) continue;
      const key = s.labels[label] ?? '';
      out[key] = (out[key] ?? 0) + s.value;
    }
    return out;
  }

  series(name: string): PromSample[] {
    return this.byName.get(name) ?? [];
  }
}

/** İki ölçüm arasında sayacın saniyedeki artışı; sayaç sıfırlandıysa (yeniden başlatma) null */
export function counterRate(cur: number | null, prev: number | null, seconds: number): number | null {
  if (cur === null || prev === null || seconds <= 0 || cur < prev) return null;
  return (cur - prev) / seconds;
}
