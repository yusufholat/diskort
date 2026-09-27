// Dışarıya (kullanıcıların yazdığı adreslere) güvenli istek: bağlantı önizlemeleri ve önizleme resimleri.
// SSRF'e karşı: yalnızca http/https ve 80/443 kapıları; ad çözülür ve adreslerden biri bile özel ağdaysa
// (yerel, özel, bağlantı-yerel, CGNAT, çok noktaya yayın, IPv6 ULA...) istek yapılmaz. Bağlantı, denetlenen
// adrese sabitlenir (DNS yeniden bağlama işe yaramaz). Yönlendirmeler elle izlenir ve her adımda aynı
// denetimden geçer (en fazla 5). Toplam süre sınırı gövde okunurken de geçerlidir; gövde sınırı aşılınca
// okuma durur (sıkıştırılmış gövdede açılmış boyut sayılır).

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';

export const BOT_USER_AGENT = 'Mozilla/5.0 (compatible; DiskortBot/1.0; +https://diskort.ziroo.net)';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_REDIRECTS = 5;

export class FetchError extends Error {
  constructor(
    /** blocked: izin verilmeyen adres; http: başarısız durum kodu; too_large; timeout; network; redirects */
    readonly code: 'blocked' | 'http' | 'too_large' | 'timeout' | 'network' | 'redirects' | 'type',
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

// ---------- Adres denetimi ----------

function parseV4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** Engellenen IPv4 aralıkları: [başlangıç, önek uzunluğu] */
const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // "bu ağ"
  ['10.0.0.0', 8], // özel
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // yerel
  ['169.254.0.0', 16], // bağlantı-yerel (bulut üst veri servisi dahil)
  ['172.16.0.0', 12], // özel
  ['192.0.0.0', 24], // IETF
  ['192.0.2.0', 24], // belgeleme
  ['192.88.99.0', 24], // 6to4 aktarımı
  ['192.168.0.0', 16], // özel
  ['198.18.0.0', 15], // kıyaslama
  ['198.51.100.0', 24], // belgeleme
  ['203.0.113.0', 24], // belgeleme
  ['224.0.0.0', 4], // çok noktaya yayın
  ['240.0.0.0', 4], // ayrılmış + yayın
];
const V4_RANGES = V4_BLOCKED.map(([base, bits]) => {
  const size = 2 ** (32 - bits);
  const start = parseV4(base)!;
  return { start, end: start + size - 1 };
});

function blockedV4(n: number): boolean {
  return V4_RANGES.some((r) => n >= r.start && n <= r.end);
}

/** IPv6 adresini 8 adet 16 bitlik gruba açar (gömülü IPv4 ve bölge kimliği desteklenir) */
function parseV6(raw: string): number[] | null {
  let ip = raw.toLowerCase();
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  // Sondaki gömülü IPv4 (::ffff:1.2.3.4) iki onaltılık gruba çevrilir
  const lastColon = ip.lastIndexOf(':');
  if (ip.slice(lastColon + 1).includes('.')) {
    const v4 = parseV4(ip.slice(lastColon + 1));
    if (v4 === null) return null;
    ip = `${ip.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string): number[] | null => {
    if (!s) return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]!);
  const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (!head || !rest) return null;
  const known = head.length + rest.length;
  if (halves.length === 2) {
    if (known > 7) return null;
    return [...head, ...new Array<number>(8 - known).fill(0), ...rest];
  }
  return known === 8 ? head : null;
}

function blockedV6(g: number[]): boolean {
  const v4At = (i: number): number => g[i]! * 65536 + g[i + 1]!;
  // ::ffff:a.b.c.d (IPv4 eşlemeli): içindeki IPv4'e göre
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return blockedV4(v4At(6));
  // 64:ff9b::/96 (NAT64): içindeki IPv4'e göre
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blockedV4(v4At(6));
  // 2002::/16 (6to4): içindeki IPv4'e göre
  if (g[0] === 0x2002) return blockedV4(v4At(1));
  // Yalnızca genel tek noktaya yayın (2000::/3): ::, ::1, fc00::/7 (ULA), fe80::/10, ff00::/8, 100::/64,
  // 64:ff9b:1::/48 vb. dışarıda kalır
  if ((g[0]! & 0xe000) !== 0x2000) return true;
  // 2001::/23 (Teredo, ORCHID, IETF), 2001:db8::/32 ve 3fff::/20 (belgeleme)
  if (g[0] === 0x2001 && g[1]! < 0x200) return true;
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;
  if (g[0] === 0x3fff && g[1]! < 0x1000) return true;
  return false;
}

/** Adres dışarıdan erişilebilir genel bir adres değilse (ya da okunamıyorsa) true */
export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip.split('%')[0]!);
  if (kind === 4) {
    const n = parseV4(ip);
    return n === null || blockedV4(n);
  }
  if (kind === 6) {
    const groups = parseV6(ip);
    return groups === null || blockedV6(groups);
  }
  return true;
}

// ---------- İstek ----------

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

export interface SafeFetchOptions {
  /** Accept başlığı */
  accept?: string;
  /** Tüm yönlendirmeler ve gövde okuması dahil toplam süre */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Testler için */
  resolve?: Resolver;
  isBlocked?: (ip: string) => boolean;
  allowedPorts?: readonly number[];
}

export interface SafeResponse {
  /** Yönlendirmelerden sonraki son adres */
  url: string;
  status: number;
  /** Küçük harf, parametresiz (ör. "text/html") */
  contentType: string;
  /** Content-Type'taki charset (varsa) */
  charset: string | null;
  headers: http.IncomingHttpHeaders;
  /** Açılmış (sıkıştırması çözülmüş) gövde */
  body: Readable;
  /** Gövdeyi okumadan bağlantıyı kapatır */
  close(): void;
  /** Toplam süre sınırının sinyali (gövde okunurken de geçerli) */
  signal: AbortSignal;
}

/** Adresi denetler; izin verilen, sabitlenecek adresi döner */
async function checkTarget(url: URL, opts: Required<Pick<SafeFetchOptions, 'resolve' | 'isBlocked' | 'allowedPorts'>>): Promise<ResolvedAddress> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('blocked', 'Yalnızca http ve https.');
  if (url.username || url.password) throw new FetchError('blocked', 'Adreste kullanıcı bilgisi var.');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!opts.allowedPorts.includes(port)) throw new FetchError('blocked', 'Bu kapıya istek yapılmaz.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new FetchError('blocked', 'Adres yok.');
  const literal = net.isIP(host);
  if (literal) {
    if (opts.isBlocked(host)) throw new FetchError('blocked', 'Özel ağ adresi.');
    return { address: host, family: literal };
  }
  if (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) {
    throw new FetchError('blocked', 'Yerel ad.');
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await opts.resolve(host);
  } catch {
    throw new FetchError('network', 'Ad çözülemedi.');
  }
  if (addresses.length === 0) throw new FetchError('network', 'Ad çözülemedi.');
  // Adreslerden biri bile özel ağdaysa hiç bağlanılmaz
  if (addresses.some((a) => opts.isBlocked(a.address))) throw new FetchError('blocked', 'Özel ağ adresi.');
  return addresses[0]!;
}

function decoded(res: http.IncomingMessage): Readable {
  const encoding = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (encoding === 'deflate') return res.pipe(zlib.createInflate());
  if (encoding === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

/**
 * GET isteği. 2xx dışındaki son yanıtlar FetchError('http') olur. Dönen gövde okunmalı ya da close()
 * çağrılmalıdır.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const opts = {
    resolve: options.resolve ?? systemResolver,
    isBlocked: options.isBlocked ?? isBlockedAddress,
    allowedPorts: options.allowedPorts ?? [80, 443],
  };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new FetchError('timeout', 'Süre doldu.')),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  timer.unref();
  const signal = controller.signal;
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  const fail = (err: unknown): never => {
    clearTimeout(timer);
    if (!signal.aborted) controller.abort();
    if (err instanceof FetchError) throw err;
    if (signal.reason instanceof FetchError) throw signal.reason;
    throw new FetchError('network', err instanceof Error ? err.message : String(err));
  };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail(new FetchError('blocked', 'Geçersiz adres.'));
  }
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  for (let hop = 0; ; hop++) {
    try {
      const target = await checkTarget(url, opts);
      const res = await request(url, target, options.accept ?? '*/*', signal);
      const location = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
        res.resume();
        res.destroy();
        if (hop >= maxRedirects) throw new FetchError('redirects', 'Çok fazla yönlendirme.');
        url = new URL(location, url);
        continue;
      }
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        res.destroy();
        throw new FetchError('http', `HTTP ${status}`, status);
      }
      const [type = '', ...params] = String(res.headers['content-type'] ?? '').split(';');
      const charsetParam = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith('charset='));
      const body = decoded(res);
      const close = (): void => {
        clearTimeout(timer);
        res.destroy();
        if (body !== res) body.destroy();
      };
      body.once('end', () => clearTimeout(timer));
      body.once('error', () => clearTimeout(timer));
      signal.addEventListener('abort', () => body.destroy(signal.reason as Error), { once: true });
      return {
        url: url.href,
        status,
        contentType: type.trim().toLowerCase(),
        charset: charsetParam ? charsetParam.slice(8).replace(/"/g, '').trim().toLowerCase() : null,
        headers: res.headers,
        body,
        close,
        signal,
      };
    } catch (err) {
      return fail(err);
    }
  }
}

function request(url: URL, target: ResolvedAddress, accept: string, signal: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'GET',
        // Her istek kendi bağlantısıyla: havuzdaki başka bir adrese bağlı soket kullanılmaz
        agent: false,
        signal,
        // Denetlenen adrese sabitlenir (ad yeniden çözülmez)
        lookup: ((_host: string, lookupOpts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
          if (lookupOpts?.all) cb(null, [{ address: target.address, family: target.family }]);
          else cb(null, target.address, target.family);
        }) as unknown as typeof dns.lookup,
        headers: {
          'User-Agent': BOT_USER_AGENT,
          Accept: accept,
          'Accept-Language': 'tr,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      resolve,
    );
    req.once('error', reject);
    req.end();
  });
}

/**
 * Gövdeyi en fazla `max` bayta kadar okur. Aşılırsa `truncate` ise o ana kadarki kısım (truncated:
 * true), değilse FetchError('too_large'). Her durumda bağlantı kapanır.
 */
export async function readCapped(
  res: Pick<SafeResponse, 'body' | 'close'>,
  max: number,
  truncate = false,
): Promise<{ data: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of res.body) {
      const buf = chunk as Buffer;
      if (size + buf.length > max) {
        if (!truncate) throw new FetchError('too_large', 'Yanıt çok büyük.');
        chunks.push(buf.subarray(0, max - size));
        size = max;
        return { data: Buffer.concat(chunks, size), truncated: true };
      }
      chunks.push(buf);
      size += buf.length;
    }
    return { data: Buffer.concat(chunks, size), truncated: false };
  } catch (err) {
    if (err instanceof FetchError) throw err;
    const reason = (err as { cause?: unknown })?.cause ?? err;
    if (reason instanceof FetchError) throw reason;
    throw new FetchError('network', err instanceof Error ? err.message : String(err));
  } finally {
    res.close();
  }
}
