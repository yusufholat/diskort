import fs from 'node:fs';
import path from 'node:path';
import { probeTcp, probeUdp } from './netProbe.js';

// Kısa kesinti dedektörü: ağ geçidine ve 1.1.1.1'e saniyede 10 küçük sonda (≈1 KB/sn). Saniyelik sondalar
// 100-300 ms'lik dalgaları kaçırır; burada art arda kayıp ve gecikme sıçramaları süreleriyle günlüğe yazılır.
// Disk: yalnızca kesinti olayları + dakikalık özet (hedef başına ~100 B/dk), 7 gün saklanır.

export interface MicroTarget {
  label: string;
  /** Tek sondayı gönderir; null: yanıt yok, undefined: bu sonda atlanır (ör. ağ geçidi yanıt vermiyor) */
  run: () => Promise<number | null | undefined>;
  /** Bu eşiğin (ms) üstündeki RTT "gecikme sıçraması" sayılır */
  spikeMs: number;
}

export interface MicroEvent {
  kind: 'kayip' | 'gecikme';
  target: string;
  /** Kesintinin ilk sondasının gönderildiği an (ms) */
  at: number;
  durationMs: number;
  /** kayip: art arda yanıtsız sonda sayısı; gecikme: en yüksek RTT (ms) */
  value: number;
}

export interface MicroMinute {
  kind: 'dakika';
  target: string;
  at: number;
  sent: number;
  lost: number;
  rttMax: number | null;
  /** Dakikadaki kesinti (≥2 art arda kayıp) sayısı ve en uzun süre (ms) */
  runs: number;
  longestMs: number;
}

export interface MicroProbeOptions {
  targets: MicroTarget[];
  intervalMs?: number;
  /** Boş: diske yazılmaz */
  dir?: string | null;
  /** Art arda bu kadar kayıp "kesinti" sayılır */
  minRun?: number;
  now?: () => number;
  onEvent?: (e: MicroEvent) => void;
  log?: { warn: (o: object, m: string) => void };
}

interface State {
  runStart: number;
  runLen: number;
  minute: number;
  sent: number;
  lost: number;
  rttMax: number | null;
  runs: number;
  longestMs: number;
}

const KEEP_DAYS = 7;

export class MicroProbe {
  private timers: NodeJS.Timeout[] = [];
  private state = new Map<string, State>();
  private lines: string[] = [];
  private writing: Promise<void> | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private warned = false;
  recent: MicroEvent[] = [];

  constructor(private readonly opts: MicroProbeOptions) {}

  private get interval(): number {
    return this.opts.intervalMs ?? 100;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  start(): void {
    if (this.timers.length > 0) return;
    this.opts.targets.forEach((t, i) => {
      const begin = setTimeout(() => {
        const iv = setInterval(() => void this.once(t), this.interval);
        iv.unref();
        this.timers.push(iv);
      }, (i * this.interval) / Math.max(1, this.opts.targets.length));
      begin.unref();
      this.timers.push(begin);
    });
    this.flushTimer = setInterval(() => void this.flush(), 15_000);
    this.flushTimer.unref();
    this.prune();
  }

  async stop(): Promise<void> {
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    await this.flush();
  }

  async once(target: MicroTarget, sentAt = this.now()): Promise<void> {
    const rtt = await target.run().catch(() => null);
    if (rtt === undefined) return;
    this.record(target, sentAt, rtt);
  }

  /** Bir sonda sonucunu işler (testler doğrudan çağırır) */
  record(target: MicroTarget, sentAt: number, rtt: number | null): void {
    const s = this.stateOf(target.label, sentAt);
    const minute = Math.floor(sentAt / 60_000);
    if (minute !== s.minute) {
      this.emitMinute(target.label, s);
      Object.assign(s, { minute, sent: 0, lost: 0, rttMax: null, runs: 0, longestMs: 0 });
    }
    s.sent++;
    if (rtt === null) {
      s.lost++;
      if (s.runLen === 0) s.runStart = sentAt;
      s.runLen++;
      return;
    }
    if (s.runLen >= (this.opts.minRun ?? 2)) {
      const durationMs = sentAt - s.runStart;
      s.runs++;
      s.longestMs = Math.max(s.longestMs, durationMs);
      this.emit({ kind: 'kayip', target: target.label, at: s.runStart, durationMs, value: s.runLen });
    }
    s.runLen = 0;
    s.rttMax = s.rttMax === null ? rtt : Math.max(s.rttMax, rtt);
    if (rtt >= target.spikeMs) {
      this.emit({ kind: 'gecikme', target: target.label, at: sentAt, durationMs: Math.round(rtt), value: Math.round(rtt) });
    }
  }

  private stateOf(label: string, at: number): State {
    let s = this.state.get(label);
    if (!s) {
      s = { runStart: 0, runLen: 0, minute: Math.floor(at / 60_000), sent: 0, lost: 0, rttMax: null, runs: 0, longestMs: 0 };
      this.state.set(label, s);
    }
    return s;
  }

  private emit(e: MicroEvent): void {
    this.recent.push(e);
    if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);
    this.queue(e);
    this.opts.onEvent?.(e);
  }

  private emitMinute(label: string, s: State): void {
    if (s.sent === 0) return;
    const row: MicroMinute = {
      kind: 'dakika',
      target: label,
      at: s.minute * 60_000,
      sent: s.sent,
      lost: s.lost,
      rttMax: s.rttMax === null ? null : Math.round(s.rttMax * 10) / 10,
      runs: s.runs,
      longestMs: s.longestMs,
    };
    this.queue(row);
  }

  private queue(row: MicroEvent | MicroMinute): void {
    if (this.opts.dir) this.lines.push(JSON.stringify(row));
  }

  private file(): string {
    return path.join(this.opts.dir!, `micro-${new Date(this.now()).toISOString().slice(0, 10)}.jsonl`);
  }

  flush(): Promise<void> {
    const dir = this.opts.dir;
    if (!dir || this.lines.length === 0) return this.writing ?? Promise.resolve();
    const lines = this.lines;
    this.lines = [];
    const file = this.file();
    const run = async (): Promise<void> => {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.appendFile(file, lines.join('\n') + '\n');
      } catch (err) {
        if (!this.warned) this.opts.log?.warn({ err: String(err) }, 'kısa kesinti kaydı yazılamadı');
        this.warned = true;
      }
    };
    const p: Promise<void> = (this.writing ?? Promise.resolve()).then(run).finally(() => {
      if (this.writing === p) this.writing = null;
    });
    this.writing = p;
    return p;
  }

  private prune(): void {
    const dir = this.opts.dir;
    if (!dir) return;
    void (async () => {
      try {
        const cutoff = this.now() - KEEP_DAYS * 86_400_000;
        for (const f of await fs.promises.readdir(dir)) {
          if (!/^micro-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue;
          const day = Date.parse(f.slice(6, 16));
          if (Number.isFinite(day) && day < cutoff) await fs.promises.unlink(path.join(dir, f)).catch(() => undefined);
        }
      } catch {
        /* klasör henüz yok */
      }
    })();
  }
}

/** Üretimdeki hedefler: 1.1.1.1 ve 8.8.8.8 UDP DNS; ağ geçidi (TCP 80, "reddedildi" de yanıt) yalnızca yanıt verirse */
export function defaultMicroTargets(gateway: () => string | null): MicroTarget[] {
  let gwSent = 0;
  let gwReplied = 0;
  return [
    { label: 'udp 1.1.1.1', run: () => probeUdp('1.1.1.1', 53, 300), spikeMs: 100 },
    { label: 'udp 8.8.8.8', run: () => probeUdp('8.8.8.8', 53, 300), spikeMs: 120 },
    {
      label: 'ağ geçidi',
      run: async () => {
        const host = gateway();
        // İlk 30 denemede hiç yanıt yoksa ağ geçidi bu yöntemle yoklanamaz: kayıp saymadan bırak
        if (!host || (gwSent >= 30 && gwReplied === 0)) return undefined;
        const rtt = await probeTcp(host, 80, 300, true);
        gwSent++;
        if (rtt !== null) gwReplied++;
        return gwSent <= 30 && gwReplied === 0 ? undefined : rtt;
      },
      spikeMs: 30,
    },
  ];
}
