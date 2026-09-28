import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { RingLog } from './activity.js';

// Yönetim paneli: API sağlığı. Dakika başına istek sayıları (durum sınıflarına göre), yol başına gecikme
// yüzdelikleri (son 15 dk), 429 (sınır aşımı) kayıtları, olay döngüsü gecikmesi, gateway mesaj hızı ve
// sunucu günlüğündeki hata/ölümcül kayıtlar (pino düzeyi ≥ 50). Hepsi yalnızca bellekte.

const MINUTE = 60_000;
const MINUTES_KEPT = 60;
const LATENCY_WINDOW_MS = 15 * MINUTE;
const LATENCY_MAX_PER_ROUTE = 600;
const GATEWAY_HISTORY = 180;
/** Olay döngüsü ölçümünün zamanlayıcı aralığı (ms) */
const LOOP_RESOLUTION_MS = 20;

interface MinuteBucket {
  minute: number;
  total: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
  /** 429 yanıtları */
  limited: number;
}

export interface RateLimitEntry {
  at: number;
  method: string;
  route: string;
  ip: string;
  user: string | null;
}

export interface LogEntry {
  at: number;
  /** pino düzeyi: 50 error, 60 fatal */
  level: number;
  msg: string;
  err: string | null;
  stack: string | null;
}

/** Gateway'in kendi sayaçları (bkz. Gateway.traffic) */
export interface GatewayTraffic {
  messagesIn: number;
  messagesOut: number;
  bytesOut: number;
  connections: number;
  identified: number;
  /** Aynı hesabın son bağlantısı kapandıktan sonraki 60 sn içinde yeniden bağlanması */
  reconnects: number;
  authFailures: number;
  updateRequired: number;
  /** Kapanış kodu → sayı */
  closes: Record<string, number>;
}

export interface GatewaySample {
  at: number;
  inPerSec: number | null;
  outPerSec: number | null;
  bytesOutPerSec: number | null;
  sockets: number;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

/** Yolu gruplar: /api/channels/:channelId/messages → /api/channels */
export function routeGroup(route: string): string {
  if (!route.startsWith('/api/')) return `/${route.split('/')[1] ?? ''}`;
  const parts = route.split('/');
  return `/api/${parts[2] ?? ''}`;
}

export class ApiStats {
  readonly startedAt = Date.now();
  private readonly minutes: MinuteBucket[] = [];
  private readonly latency = new Map<string, { at: number; ms: number }[]>();
  readonly rateLimited = new RingLog<RateLimitEntry>(200);
  readonly logs = new RingLog<LogEntry>(200);
  totals = { requests: 0, s4: 0, s5: 0, limited: 0 };
  private loop: IntervalHistogram | null = null;
  private loopLast: { p50: number; p99: number; max: number } | null = null;
  private readonly gatewayHistory: GatewaySample[] = [];
  private prevGateway: { at: number; traffic: GatewayTraffic } | null = null;

  /** Olay döngüsü gecikmesi ölçümü (düzenli ölçüm açıkken) */
  startLoopMonitor(): void {
    if (this.loop) return;
    this.loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
    this.loop.enable();
  }

  stop(): void {
    this.loop?.disable();
    this.loop = null;
  }

  record(method: string, route: string, status: number, ms: number, now = Date.now()): void {
    const minute = Math.floor(now / MINUTE) * MINUTE;
    let bucket = this.minutes.at(-1);
    if (!bucket || bucket.minute !== minute) {
      bucket = { minute, total: 0, s2: 0, s3: 0, s4: 0, s5: 0, limited: 0 };
      this.minutes.push(bucket);
      if (this.minutes.length > MINUTES_KEPT) this.minutes.shift();
    }
    bucket.total++;
    this.totals.requests++;
    if (status >= 500) {
      bucket.s5++;
      this.totals.s5++;
    } else if (status >= 400) {
      bucket.s4++;
      this.totals.s4++;
    } else if (status >= 300) bucket.s3++;
    else bucket.s2++;
    if (status === 429) {
      bucket.limited++;
      this.totals.limited++;
    }
    // Uzun yaşayan bağlantılar (gateway) gecikmeye katılmaz
    if (route === '/gateway') return;
    const key = `${method} ${route}`;
    const list = this.latency.get(key) ?? [];
    list.push({ at: now, ms });
    if (list.length > LATENCY_MAX_PER_ROUTE) list.shift();
    this.latency.set(key, list);
  }

  recordRateLimit(entry: RateLimitEntry): void {
    this.rateLimited.push(entry);
  }

  /** pino'nun logMethod kancası: hata ve ölümcül kayıtlar (≥ 50) panele */
  captureLog(level: number, args: unknown[], now = Date.now()): void {
    if (level < 50) return;
    try {
      let msg = '';
      let err: string | null = null;
      let stack: string | null = null;
      const [first, second] = args;
      const describe = (e: unknown): void => {
        if (e instanceof Error) {
          err = e.message;
          stack = e.stack ?? null;
        } else if (e && typeof e === 'object' && 'message' in e) {
          err = String((e as { message: unknown }).message);
          if ('stack' in e) stack = String((e as { stack: unknown }).stack);
        } else if (e !== undefined) err = String(e);
      };
      if (first instanceof Error) {
        describe(first);
        msg = typeof second === 'string' ? second : first.message;
      } else if (first && typeof first === 'object') {
        const obj = first as { err?: unknown; error?: unknown; msg?: unknown };
        describe(obj.err ?? obj.error);
        msg = typeof second === 'string' ? second : typeof obj.msg === 'string' ? obj.msg : '';
      } else {
        msg = String(first ?? '');
      }
      this.logs.push({
        at: now,
        level,
        msg: msg.slice(0, 500),
        err: err === null ? null : (err as string).slice(0, 500),
        stack: stack === null ? null : (stack as string).split('\n').slice(0, 8).join('\n').slice(0, 1500),
      });
    } catch {
      // günlük yakalama asla günlüğü bozmaz
    }
  }

  /** Gateway sayaçlarını (düzenli ölçümde) hıza çevirir */
  sampleGateway(traffic: GatewayTraffic, sockets: number, now = Date.now()): void {
    const prev = this.prevGateway;
    const copy = { ...traffic, closes: { ...traffic.closes } };
    this.prevGateway = { at: now, traffic: copy };
    const dt = prev ? (now - prev.at) / 1000 : 0;
    const rate = (cur: number, old: number | undefined): number | null =>
      prev && dt > 0 && old !== undefined && cur >= old ? (cur - old) / dt : null;
    this.gatewayHistory.push({
      at: now,
      inPerSec: rate(traffic.messagesIn, prev?.traffic.messagesIn),
      outPerSec: rate(traffic.messagesOut, prev?.traffic.messagesOut),
      bytesOutPerSec: rate(traffic.bytesOut, prev?.traffic.bytesOut),
      sockets,
    });
    if (this.gatewayHistory.length > GATEWAY_HISTORY) this.gatewayHistory.shift();
    if (this.loop) {
      // Ölçülen süre zamanlayıcı aralığını da içerir: gecikme = ölçülen - aralık
      const ms = (ns: number): number => Math.max(0, Math.round((ns / 1e6 - LOOP_RESOLUTION_MS) * 10) / 10);
      this.loopLast = { p50: ms(this.loop.percentile(50)), p99: ms(this.loop.percentile(99)), max: ms(this.loop.max) };
      this.loop.reset();
    }
  }

  /** Son bir saatin durum sınıfı toplamları (5 sn'lik özet için; yüzdelik hesabı yok) */
  lastHour(now = Date.now()): { total: number; s2: number; s3: number; s4: number; s5: number; limited: number } {
    const from = now - MINUTES_KEPT * MINUTE;
    const out = { total: 0, s2: 0, s3: 0, s4: 0, s5: 0, limited: 0 };
    for (const m of this.minutes) {
      if (m.minute <= from) continue;
      out.total += m.total;
      out.s2 += m.s2;
      out.s3 += m.s3;
      out.s4 += m.s4;
      out.s5 += m.s5;
      out.limited += m.limited;
    }
    return out;
  }

  snapshot(now = Date.now()): {
    since: number;
    totals: ApiStats['totals'];
    perMinute: MinuteBucket[];
    lastHour: { total: number; s2: number; s3: number; s4: number; s5: number; limited: number };
    routes: { route: string; group: string; count: number; p50: number | null; p95: number | null; max: number | null }[];
    groups: { group: string; count: number; p50: number | null; p95: number | null }[];
    eventLoop: { p50: number; p99: number; max: number } | null;
    gatewayHistory: GatewaySample[];
  } {
    const from = now - MINUTES_KEPT * MINUTE;
    const perMinute: MinuteBucket[] = [];
    // Boş dakikalar da (grafikte sıfır) dizide olsun
    const byMinute = new Map(this.minutes.map((m) => [m.minute, m]));
    const first = Math.floor(from / MINUTE) * MINUTE + MINUTE;
    for (let m = first; m <= now; m += MINUTE) {
      perMinute.push(byMinute.get(m) ?? { minute: m, total: 0, s2: 0, s3: 0, s4: 0, s5: 0, limited: 0 });
    }
    const lastHour = perMinute.reduce(
      (acc, m) => ({
        total: acc.total + m.total,
        s2: acc.s2 + m.s2,
        s3: acc.s3 + m.s3,
        s4: acc.s4 + m.s4,
        s5: acc.s5 + m.s5,
        limited: acc.limited + m.limited,
      }),
      { total: 0, s2: 0, s3: 0, s4: 0, s5: 0, limited: 0 },
    );
    const since = now - LATENCY_WINDOW_MS;
    const routes: { route: string; group: string; count: number; p50: number | null; p95: number | null; max: number | null }[] = [];
    const groupSamples = new Map<string, number[]>();
    for (const [key, list] of this.latency) {
      const recent = list.filter((x) => x.at >= since).map((x) => x.ms);
      if (recent.length === 0) continue;
      recent.sort((a, b) => a - b);
      const route = key.slice(key.indexOf(' ') + 1);
      const group = routeGroup(route);
      routes.push({ route: key, group, count: recent.length, p50: percentile(recent, 50), p95: percentile(recent, 95), max: recent.at(-1)! });
      const g = groupSamples.get(group) ?? [];
      g.push(...recent);
      groupSamples.set(group, g);
    }
    routes.sort((a, b) => b.count - a.count);
    const round = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
    const groups = [...groupSamples.entries()]
      .map(([group, samples]) => {
        samples.sort((a, b) => a - b);
        return { group, count: samples.length, p50: round(percentile(samples, 50)), p95: round(percentile(samples, 95)) };
      })
      .sort((a, b) => b.count - a.count);
    return {
      since: this.startedAt,
      totals: this.totals,
      perMinute,
      lastHour,
      routes: routes.slice(0, 25).map((x) => ({ ...x, p50: round(x.p50), p95: round(x.p95), max: round(x.max) })),
      groups,
      eventLoop: this.loopLast,
      gatewayHistory: [...this.gatewayHistory],
    };
  }
}
