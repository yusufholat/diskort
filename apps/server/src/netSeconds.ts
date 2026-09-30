import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dayKey } from './counters.js';
import { hostNetSample, parseDefaultGateway, readHostNet, type HostNetCounters } from './hostNetwork.js';

// Yayın donması tanısı: sunucu ağının saniyelik kaydı (uçuş kaydedicisi). hostNetwork.ts dakikalık özet
// tutar; bir yayın donduğunda "sunucu mu, sağlayıcı yolu mu" sorusunu yanıtlamak için saniye çözünürlüğü
// gerekir. Her saniye /proc'tan birkaç küçük dosya okunur (mikrosaniyeler):
// - net/dev, net/snmp: NIC hızı, NIC düşen/hatalı paket, UDP InErrors/RcvbufErrors/SndbufErrors
// - net/softnet_stat: çekirdek ağ kuyruğu düşüşleri
// - pressure/cpu: işlemci baskısı (PSI, "some" = en az bir iş beklemede olan sürenin yüzdesi)
// - LiveKit süreç CPU'su: Prometheus ölçümünden (en son değer; kapsayıcıdan başka sürecin /proc'u görünmez)
// Son 30 dk bellekte tutulur (halka). Diske yalnızca anormal saniyelerin çevresi (±30 sn) yazılır:
// sağlıklı bir sunucuda hiç dosya oluşmaz. Olay kayıtları kendi satırlarını ayrıca saklar (freezeEvents.ts).

/** Bir saniyelik satır. Anahtarlar dosya küçük kalsın diye kısa; eksik ölçüm null/yok */
export interface SecondRow {
  /** Ölçüm anı (ms) */
  t: number;
  /** NIC hızı (Mbit/sn) */
  rx: number | null;
  tx: number | null;
  /** NIC paket hızı (paket/sn) */
  rxp: number | null;
  txp: number | null;
  /** Bu aralıkta NIC'te düşen + hatalı paket (rx_drop + rx_err + tx_drop + tx_err) */
  nd: number;
  /** UDP hataları (paket): InErrors, RcvbufErrors, SndbufErrors */
  ue: number;
  ur: number;
  us: number;
  /** softnet: çekirdek kuyruğunda düşen paket; okunamadıysa null */
  sd: number | null;
  /** CPU baskısı (PSI some, %0-100); okunamadıysa null */
  psi: number | null;
  /** LiveKit süreci CPU'su (çekirdek oranı; 1 = bir çekirdek); bilinmiyorsa null */
  lk: number | null;
  /** Dış sondalar: hedef etiketi → RTT (ms) ya da -1 (yanıt gelmedi); yalnızca o saniyede gönderilenler */
  p?: Record<string, number>;
}

export interface SoftnetCounters {
  processed: number;
  dropped: number;
  squeezed: number;
}

/** /proc/net/softnet_stat: CPU başına satır, sütunlar onaltılık (işlenen, düşen, time_squeeze ...); toplamı */
export function parseSoftnetStat(text: string): SoftnetCounters | null {
  let processed = 0;
  let dropped = 0;
  let squeezed = 0;
  let rows = 0;
  for (const line of text.split('\n')) {
    const c = line.trim().split(/\s+/);
    if (c.length < 3) continue;
    const [a, b, d] = [c[0]!, c[1]!, c[2]!].map((x) => Number.parseInt(x, 16));
    if (![a, b, d].every((n) => Number.isFinite(n))) continue;
    processed += a!;
    dropped += b!;
    squeezed += d!;
    rows++;
  }
  return rows === 0 ? null : { processed, dropped, squeezed };
}

/** /proc/pressure/cpu: "some ... total=<µs>" (en az bir işin CPU beklediği toplam süre, µs); yoksa null */
export function parsePsiCpu(text: string): number | null {
  const m = /^some\b.*\btotal=(\d+)/m.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** Bir anda okunan ham ham sayaçlar */
export interface RawSecond {
  net: HostNetCounters | null;
  softnet: SoftnetCounters | null;
  /** PSI some toplamı (µs) */
  psiUs: number | null;
  at: number;
}

export interface ProcFiles {
  dev: string | null;
  route: string | null;
  snmp: string | null;
  softnet: string | null;
  psi: string | null;
}

export function readRaw(files: ProcFiles, at: number): RawSecond {
  return {
    at,
    net: readHostNet(files, at),
    softnet: files.softnet ? parseSoftnetStat(files.softnet) : null,
    psiUs: files.psi ? parsePsiCpu(files.psi) : null,
  };
}

const round = (v: number | null, digits = 1): number | null => (v === null ? null : Number(v.toFixed(digits)));

/** İki ham okumadan bir saniyelik satır; aralık anlamsızsa (arayüz değişti, sayaç geri gitti) ilgili alanlar boş */
export function rowBetween(cur: RawSecond, prev: RawSecond, livekitCpu: number | null): SecondRow | null {
  const dt = (cur.at - prev.at) / 1000;
  if (dt <= 0 || dt > 10) return null;
  const pos = (c: number | undefined, p: number | undefined): number | null =>
    c === undefined || p === undefined || c < p ? null : c - p;
  let rx: number | null = null;
  let tx: number | null = null;
  let rxp: number | null = null;
  let txp: number | null = null;
  let nd = 0;
  let ue = 0;
  let ur = 0;
  let us = 0;
  if (cur.net && prev.net) {
    const s = hostNetSample(cur.net, prev.net);
    if (s) {
      rx = round(s.rxMbps);
      tx = round(s.txMbps);
      rxp = round(s.rxPps, 0);
      txp = round(s.txPps, 0);
    }
    if (cur.net.iface === prev.net.iface) {
      const c = cur.net.dev;
      const p = prev.net.dev;
      nd = (pos(c.rxDrop, p.rxDrop) ?? 0) + (pos(c.rxErrs, p.rxErrs) ?? 0) + (pos(c.txDrop, p.txDrop) ?? 0) + (pos(c.txErrs, p.txErrs) ?? 0);
    }
    if (cur.net.udp && prev.net.udp) {
      ue = pos(cur.net.udp.inErrors, prev.net.udp.inErrors) ?? 0;
      ur = pos(cur.net.udp.rcvbufErrors, prev.net.udp.rcvbufErrors) ?? 0;
      us = pos(cur.net.udp.sndbufErrors, prev.net.udp.sndbufErrors) ?? 0;
    }
  }
  const sd = cur.softnet && prev.softnet ? pos(cur.softnet.dropped, prev.softnet.dropped) : null;
  const psiDelta = pos(cur.psiUs ?? undefined, prev.psiUs ?? undefined);
  const psi = psiDelta === null ? null : Math.min(100, round((psiDelta / (dt * 1_000_000)) * 100, 1)!);
  return { t: cur.at, rx, tx, rxp, txp, nd, ue, ur, us, sd, psi, lk: round(livekitCpu, 2) };
}

// ---------- Özetler (olay kanıtı) ----------

export interface ProbeSummary {
  sent: number;
  lost: number;
  lossPct: number;
  rttMed: number | null;
  rttMax: number | null;
}

/** Bir zaman aralığındaki sunucu ağı özeti (olay kanıtı) */
export interface ServerSummary {
  /** Aralıkta kaç saniyelik satır var (beklenen: süre) ve süre (sn) */
  seconds: number;
  expectedSeconds: number;
  txMbpsMax: number | null;
  rxMbpsMax: number | null;
  /** NIC düşen+hatalı paket toplamı */
  nicDrops: number;
  udpInErr: number;
  udpRcvbufErr: number;
  udpSndbufErr: number;
  /** softnet düşüşü; okunamadıysa null */
  softnetDrops: number | null;
  /** CPU baskısı en yüksek (%); okunamadıysa null */
  psiMax: number | null;
  /** LiveKit CPU'su en yüksek (çekirdek oranı) ve makinedeki çekirdek sayısı */
  livekitCpuMax: number | null;
  cores: number;
  /** Hedef etiketi → sonda özeti */
  probes: Record<string, ProbeSummary>;
  /** Dış hedeflerin (ağ geçidi dışındakiler) toplam kayıp yüzdesi; yeterli sonda yoksa null */
  probeLossPct: number | null;
}

/** Bu etiket ağ geçidi sondası mı (kayıp yargısına katılmaz: yanıt vermeyebilir) */
export const GATEWAY_LABEL = 'ağ geçidi';

const median = (v: number[]): number | null => {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const maxOf = (v: (number | null)[]): number | null => {
  const x = v.filter((n): n is number => n !== null);
  return x.length === 0 ? null : Math.max(...x);
};

export function summarizeRows(rows: SecondRow[], from: number, to: number, cores = os.availableParallelism?.() ?? 1): ServerSummary {
  const probes: Record<string, { sent: number; lost: number; rtts: number[] }> = {};
  for (const r of rows) {
    for (const [label, v] of Object.entries(r.p ?? {})) {
      const p = (probes[label] ??= { sent: 0, lost: 0, rtts: [] });
      p.sent++;
      if (v < 0) p.lost++;
      else p.rtts.push(v);
    }
  }
  const out: Record<string, ProbeSummary> = {};
  let sent = 0;
  let lost = 0;
  for (const [label, p] of Object.entries(probes)) {
    out[label] = {
      sent: p.sent,
      lost: p.lost,
      lossPct: p.sent === 0 ? 0 : round((p.lost / p.sent) * 100, 1)!,
      rttMed: round(median(p.rtts)),
      rttMax: round(p.rtts.length === 0 ? null : Math.max(...p.rtts)),
    };
    if (label !== GATEWAY_LABEL) {
      sent += p.sent;
      lost += p.lost;
    }
  }
  const sum = (pick: (r: SecondRow) => number): number => rows.reduce((n, r) => n + pick(r), 0);
  const sdRows = rows.filter((r) => r.sd !== null);
  return {
    seconds: rows.length,
    expectedSeconds: Math.max(0, Math.round((to - from) / 1000)),
    txMbpsMax: maxOf(rows.map((r) => r.tx)),
    rxMbpsMax: maxOf(rows.map((r) => r.rx)),
    nicDrops: sum((r) => r.nd),
    udpInErr: sum((r) => r.ue),
    udpRcvbufErr: sum((r) => r.ur),
    udpSndbufErr: sum((r) => r.us),
    softnetDrops: sdRows.length === 0 ? null : sdRows.reduce((n, r) => n + (r.sd ?? 0), 0),
    psiMax: maxOf(rows.map((r) => r.psi)),
    livekitCpuMax: maxOf(rows.map((r) => r.lk)),
    cores,
    probes: out,
    probeLossPct: sent >= 5 ? round((lost / sent) * 100, 1) : null,
  };
}

// ---------- Halka + kalıcı kayıt ----------

export interface SamplerOptions {
  procRoot: string;
  /** Anormal saniyelerin yazıldığı klasör (netsec-YYYY-AA-GG.jsonl); null: yazılmaz */
  dir: string | null;
  offsetMin?: number;
  /** LiveKit süreç CPU'su (çekirdek oranı) */
  livekitCpu?: () => number | null;
  /** Testler: /proc okuması yerine */
  readFiles?: () => ProcFiles;
  log?: { warn(obj: object, msg: string): void };
}

const RING_MS = 30 * 60_000;
/** Bir satır kalıcı yazılmadan önce beklenen süre: sonda yanıtları (zaman aşımı ≤ 1.2 sn) satıra işlensin */
const PERSIST_LAG_MS = 3_000;
const PERSIST_AROUND_MS = 30_000;
const DAY_MAX_BYTES = 40 * 1024 * 1024;
const RETENTION_DAYS = 7;

/** Bir satır "anormal" mi (çevresi diske yazılır) */
export function isAbnormalRow(r: SecondRow, recent: SecondRow[]): boolean {
  if (r.nd >= 5 || r.ue > 0 || r.ur > 0 || r.us > 0 || (r.sd ?? 0) > 0) return true;
  if ((r.psi ?? 0) >= 30) return true;
  // Sonda kaybı: son 10 saniyede dış sondaların en az %30'u yanıtsız (tek tük kayıp normaldir) ya da çok yüksek RTT
  let sent = 0;
  let lost = 0;
  for (const x of recent) {
    for (const [label, v] of Object.entries(x.p ?? {})) {
      if (label === GATEWAY_LABEL) continue;
      sent++;
      if (v < 0) lost++;
    }
  }
  if (sent >= 4 && lost / sent >= 0.3) return true;
  return Object.entries(r.p ?? {}).some(([label, v]) => label !== GATEWAY_LABEL && v >= 400);
}

export class SecondSampler {
  private rows: SecondRow[] = [];
  private prev: RawSecond | null = null;
  private timer: NodeJS.Timeout | null = null;
  private evaluatedT = 0;
  private writtenT = 0;
  private keepUntil = 0;
  private buffer: string[] = [];
  private dayBytes = new Map<string, number>();
  private flushing: Promise<void> | null = null;
  private lastCleanup = 0;
  private warned = false;
  /** Hangi /proc dosyaları okunabiliyor (panel için) */
  readable = { net: false, snmp: false, softnet: false, psi: false };
  iface: string | null = null;
  gateway: string | null = null;
  dropped = 0;
  persistedRows = 0;

  constructor(private readonly opts: SamplerOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1_000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  private files(): ProcFiles {
    if (this.opts.readFiles) return this.opts.readFiles();
    const root = this.opts.procRoot;
    const read = (file: string): string | null => {
      try {
        return fs.readFileSync(path.join(root, file), 'utf8');
      } catch {
        return null;
      }
    };
    return { dev: read('net/dev'), route: read('net/route'), snmp: read('net/snmp'), softnet: read('net/softnet_stat'), psi: read('pressure/cpu') };
  }

  /** Bir ölçüm al (her saniye; testler `files` ve `now` verir) */
  tick(now = Date.now(), files = this.files()): SecondRow | null {
    const cur = readRaw(files, now);
    this.readable = { net: files.dev !== null && cur.net !== null, snmp: cur.net?.udp != null, softnet: cur.softnet !== null, psi: cur.psiUs !== null };
    this.iface = cur.net?.iface ?? null;
    if (files.route) this.gateway = parseDefaultGateway(files.route);
    const prev = this.prev;
    this.prev = cur;
    if (!prev) return null;
    const row = rowBetween(cur, prev, this.opts.livekitCpu?.() ?? null);
    if (!row) return null;
    this.rows.push(row);
    const from = now - RING_MS;
    let cut = 0;
    while (cut < this.rows.length && this.rows[cut]!.t < from) cut++;
    if (cut > 0) this.rows.splice(0, cut);
    this.persistPass(now);
    return row;
  }

  /** Bir sondanın sonucu: gönderildiği saniyenin satırına işlenir (rtt null: yanıt yok) */
  addProbe(label: string, sentAt: number, rttMs: number | null): void {
    for (let i = this.rows.length - 1; i >= 0 && i >= this.rows.length - 6; i--) {
      const r = this.rows[i]!;
      if (r.t <= sentAt) {
        (r.p ??= {})[label] = rttMs === null ? -1 : Number(rttMs.toFixed(1));
        return;
      }
    }
  }

  /** [from, to] aralığındaki satırlar (halkadan) */
  window(from: number, to: number): SecondRow[] {
    return this.rows.filter((r) => r.t >= from && r.t <= to);
  }

  /** Halkadaki en son satır (panel) */
  latest(): SecondRow | null {
    return this.rows[this.rows.length - 1] ?? null;
  }

  /** Halkanın son n saniyesi */
  recent(seconds: number, now = Date.now()): SecondRow[] {
    return this.window(now - seconds * 1000, now);
  }

  /** Gecikmeli değerlendirme: anormal satırın ±30 sn çevresini diske yazar */
  private persistPass(now: number): void {
    if (!this.opts.dir) return;
    const limit = now - PERSIST_LAG_MS;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i]!;
      if (r.t <= this.evaluatedT) continue;
      if (r.t > limit) break;
      this.evaluatedT = r.t;
      const recent = this.rows.slice(Math.max(0, i - 9), i + 1);
      if (isAbnormalRow(r, recent)) {
        // Önce geriye dönük çevre (henüz yazılmamış satırlar)
        for (let j = 0; j < i; j++) {
          const b = this.rows[j]!;
          if (b.t > this.writtenT && b.t >= r.t - PERSIST_AROUND_MS) this.write(b);
        }
        this.keepUntil = r.t + PERSIST_AROUND_MS;
      }
      if (r.t <= this.keepUntil && r.t > this.writtenT) this.write(r);
    }
    if (this.buffer.length >= 30) void this.flush(now);
  }

  private write(r: SecondRow): void {
    this.writtenT = r.t;
    this.buffer.push(JSON.stringify(r));
    this.persistedRows++;
  }

  flush(now = Date.now()): Promise<void> {
    const dir = this.opts.dir;
    if (!dir || this.buffer.length === 0) return this.flushing ?? Promise.resolve();
    const run = async (): Promise<void> => {
      const lines = this.buffer;
      this.buffer = [];
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        const byDay = new Map<string, string[]>();
        for (const line of lines) {
          const t = Number(/"t":(\d+)/.exec(line)?.[1] ?? now);
          const day = dayKey(t, this.opts.offsetMin ?? 180);
          const l = byDay.get(day);
          if (l) l.push(line);
          else byDay.set(day, [line]);
        }
        for (const [day, dayLines] of byDay) {
          const file = path.join(dir, `netsec-${day}.jsonl`);
          let size = this.dayBytes.get(day);
          if (size === undefined) size = (await fs.promises.stat(file).catch(() => null))?.size ?? 0;
          const kept: string[] = [];
          for (const line of dayLines) {
            const bytes = Buffer.byteLength(line) + 1;
            if (size + bytes > DAY_MAX_BYTES) {
              this.dropped++;
              continue;
            }
            size += bytes;
            kept.push(line);
          }
          this.dayBytes.set(day, size);
          if (kept.length > 0) await fs.promises.appendFile(file, kept.join('\n') + '\n');
        }
        if (now - this.lastCleanup > 6 * 3_600_000) {
          this.lastCleanup = now;
          await this.removeOldFiles(now);
        }
      } catch (err) {
        if (!this.warned) this.opts.log?.warn({ err: String(err) }, 'saniyelik ağ kaydı yazılamadı');
        this.warned = true;
      }
    };
    const p: Promise<void> = (this.flushing ?? Promise.resolve()).then(run).finally(() => {
      if (this.flushing === p) this.flushing = null;
    });
    this.flushing = p;
    return p;
  }

  async removeOldFiles(now = Date.now()): Promise<void> {
    const dir = this.opts.dir;
    if (!dir) return;
    const oldest = dayKey(now - (RETENTION_DAYS - 1) * 86_400_000, this.opts.offsetMin ?? 180);
    const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      const m = /^netsec-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (m && m[1]! < oldest) await fs.promises.rm(path.join(dir, name), { force: true }).catch(() => undefined);
    }
  }
}
