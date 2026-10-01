import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { counterRate, PromSnapshot } from './promText.js';

// Yönetim paneli: altyapı ölçümleri.
// - LiveKit: Prometheus ölçümleri (livekit.yaml'da `prometheus.port` açıkken; kapalıysa panel "metrikler kapalı"
//   der). Toplam bayt/paket, NACK/PLI, kayıp, oda/katılımcı/iz sayıları ve LiveKit sürecinin CPU/belleği.
// - Kapsayıcılar: API kendi cgroup'undan (kapsayıcının kendi görünümü; bağlama gerekmez), Caddy yönetim
//   ucunun ölçümlerinden (127.0.0.1:2019/metrics), LiveKit kendi ölçümlerinden. Docker soketi kullanılmaz.
// - Veritabanı yedekleri (salt okunur bağlanan yedek klasörü), TLS sertifikalarının bitiş tarihleri.
// Ana makinenin ağı burada ölçülmez: tek ağ örnekleyicisi netSeconds.ts'tedir (SecondSampler).

type Log = { warn(obj: object, msg: string): void };

async function fetchText(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function errorText(err: unknown): string {
  const e = err as { cause?: { code?: string }; code?: string; name?: string; message?: string };
  const code = e?.cause?.code ?? e?.code;
  if (code === 'ECONNREFUSED') return 'bağlantı reddedildi (ölçüm ucu kapalı)';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'zaman aşımı';
  return String(e?.message ?? err).slice(0, 200);
}

// ---------- LiveKit ----------

export interface LiveKitMetricSample {
  at: number;
  rooms: number | null;
  participants: number | null;
  tracksPublished: Record<string, number>;
  tracksSubscribed: Record<string, number>;
  /** Saniyede bayt / paket (in: yayıncılardan gelen, out: izleyicilere giden) */
  bytesIn: number | null;
  bytesOut: number | null;
  packetsIn: number | null;
  packetsOut: number | null;
  /** Saniyede NACK (yeniden gönderme isteği), PLI/FIR (anahtar kare isteği) */
  nack: number | null;
  pli: number | null;
  fir: number | null;
  /** Kayıp paketler (saniyede) ve oranı (%) */
  lossIn: number | null;
  lossOut: number | null;
  lossInPct: number | null;
  lossOutPct: number | null;
  /** Aralıktaki ortalama gidiş-dönüş (ms) ve titreşim (ms) */
  rttMs: number | null;
  jitterMs: number | null;
  /** Dakikada katılım */
  joinsPerMin: number | null;
  /** LiveKit süreci: tek çekirdek oranı (0..çekirdek) ve bellek */
  cpu: number | null;
  rss: number | null;
  goroutines: number | null;
}

export interface LiveKitMetricsStatus {
  /** Adres yapılandırıldı mı (LIVEKIT_METRICS_URL) */
  configured: boolean;
  ok: boolean;
  error: string | null;
  lastOkAt: number | null;
  latest: LiveKitMetricSample | null;
  /** Ölçümlerin ham toplamları (ad → değer; histogram kovaları hariç); ad değişirse de görülebilsin */
  raw: { name: string; value: number }[];
}

const direction = (want: 'in' | 'out') => (labels: Record<string, string>) =>
  (labels.direction ?? '').toLowerCase().startsWith(want);

/** İki Prometheus ölçümünden panelin değerleri */
export function liveKitSample(cur: PromSnapshot, prev: PromSnapshot | null): LiveKitMetricSample {
  const dt = prev ? (cur.at - prev.at) / 1000 : 0;
  const rate = (name: string, filter?: (l: Record<string, string>) => boolean): number | null =>
    prev ? counterRate(cur.sum(name, filter), prev.sum(name, filter), dt) : null;
  const packetsIn = rate('livekit_packet_total', direction('in'));
  const packetsOut = rate('livekit_packet_total', direction('out'));
  const lossIn = rate('livekit_packet_loss_total', direction('in'));
  const lossOut = rate('livekit_packet_loss_total', direction('out'));
  const lossPct = (lost: number | null, packets: number | null): number | null =>
    lost === null || packets === null || lost + packets <= 0 ? null : (lost / (lost + packets)) * 100;
  const histAvg = (name: string): number | null => {
    const sum = rate(`${name}_sum`);
    const count = rate(`${name}_count`);
    return sum !== null && count !== null && count > 0 ? sum / count : null;
  };
  const jitterUs = histAvg('livekit_jitter_us');
  const joins = rate('livekit_participant_join_total');
  return {
    at: cur.at,
    rooms: cur.sum('livekit_room_total'),
    participants: cur.sum('livekit_participant_total'),
    tracksPublished: cur.sumBy('livekit_track_published_total', 'kind'),
    tracksSubscribed: cur.sumBy('livekit_track_subscribed_total', 'kind'),
    bytesIn: rate('livekit_packet_bytes', direction('in')),
    bytesOut: rate('livekit_packet_bytes', direction('out')),
    packetsIn,
    packetsOut,
    nack: rate('livekit_nack_total'),
    pli: rate('livekit_pli_total'),
    fir: rate('livekit_fir_total'),
    lossIn,
    lossOut,
    lossInPct: lossPct(lossIn, packetsIn),
    lossOutPct: lossPct(lossOut, packetsOut),
    rttMs: histAvg('livekit_rtt_ms'),
    jitterMs: jitterUs === null ? null : jitterUs / 1000,
    joinsPerMin: joins === null ? null : joins * 60,
    cpu: rate('process_cpu_seconds_total'),
    rss: cur.sum('process_resident_memory_bytes'),
    goroutines: cur.sum('go_goroutines'),
  };
}

/** Olay kanıtı için küçültülmüş LiveKit ölçümü (düğüm geneli toplamlar; LiveKit katılımcı başına ölçüm vermez) */
export interface LkRow {
  t: number;
  /** Paket/sn: yayıncılardan gelen, izleyicilere giden */
  pin: number | null;
  pout: number | null;
  /** Saniyede NACK, PLI, FIR */
  nack: number | null;
  pli: number | null;
  fir: number | null;
  /** Kayıp yüzdesi: gelen, giden */
  lin: number | null;
  lout: number | null;
  parts: number | null;
  cpu: number | null;
}

const r2 = (v: number | null): number | null => (v === null ? null : Number(v.toFixed(2)));

export const lkRow = (s: LiveKitMetricSample): LkRow => ({
  t: s.at,
  pin: r2(s.packetsIn),
  pout: r2(s.packetsOut),
  nack: r2(s.nack),
  pli: r2(s.pli),
  fir: r2(s.fir),
  lin: r2(s.lossInPct),
  lout: r2(s.lossOutPct),
  parts: s.participants,
  cpu: r2(s.cpu),
});

/** Olağan ölçüm aralığı ve bir olay açıkken (boost) kullanılan sık aralık */
const SCRAPE_MS = 10_000;
const SCRAPE_FAST_MS = 2_000;

export interface ScrapeOptions {
  url: string | null;
  fetchImpl?: typeof fetch;
  historySize?: number;
  log?: Log;
}

/**
 * LiveKit'in Prometheus ucunu düzenli okur (açıkken 10 sn, kapalıyken dakikada bir dener). Bir yayın donması
 * olayı açıkken (boost) 2 sn'de bir okur: olay penceresinin NACK/PLI/kayıp oranları daha ince görülür.
 */
export class LiveKitMetrics {
  private prev: PromSnapshot | null = null;
  private latest: LiveKitMetricSample | null = null;
  private readonly history: LiveKitMetricSample[] = [];
  private raw: { name: string; value: number }[] = [];
  private error: string | null = null;
  private lastOkAt: number | null = null;
  private lastTryAt = 0;
  private inflight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private fastUntil = 0;
  private stopped = false;
  private looping = false;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ScrapeOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return this.opts.url !== null;
  }

  private readonly loop = (): void => {
    // Zamanlayıcı ateşlendi: ölçüm sürerken yeni bir zamanlayıcı kurulmaz (bkz. boost)
    this.timer = null;
    this.looping = true;
    void this.scrape().finally(() => {
      this.looping = false;
      if (this.stopped) return;
      this.timer = setTimeout(this.loop, this.error ? 60_000 : Date.now() < this.fastUntil ? SCRAPE_FAST_MS : SCRAPE_MS);
      this.timer.unref();
    });
  };

  start(): void {
    if (!this.configured || this.timer || this.looping) return;
    this.stopped = false;
    this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Verilen ana kadar sık ölç (olay açıkken); bekleyen bir sonraki ölçüm de öne alınır */
  boost(until: number, now = Date.now()): void {
    const wasFast = now < this.fastUntil;
    this.fastUntil = Math.max(this.fastUntil, until);
    // Döngünün ölçümü sürüyorsa bir sonraki aralığı zaten o belirler: ikinci bir döngü başlatılmaz
    if (wasFast || this.looping || !this.timer || this.stopped || this.error) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(this.loop, SCRAPE_FAST_MS);
    this.timer.unref();
  }

  /** Bir ölçüm alır (aynı anda gelenler aynı ölçümü bekler) */
  scrape(now = Date.now()): Promise<void> {
    if (!this.opts.url) return Promise.resolve();
    this.inflight ??= this.doScrape(this.opts.url, now).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doScrape(url: string, now: number): Promise<void> {
    this.lastTryAt = now;
    try {
      const snap = PromSnapshot.parse(await fetchText(url, 3_000, this.fetchImpl), now);
      if (!snap.has('livekit_room_total') && !snap.has('livekit_packet_total')) throw new Error('LiveKit ölçümü değil');
      // Aradan çok zaman geçtiyse (kapalıydı) oranlar anlamsız: yeni başlangıç
      const prev = this.prev && now - this.prev.at <= 120_000 ? this.prev : null;
      const sample = liveKitSample(snap, prev);
      this.prev = snap;
      this.latest = sample;
      if (prev) {
        this.history.push(sample);
        // 30 dk: olağan aralıkta 180 ölçüm; sık ölçümde daha çok yer gerekir
        const max = this.opts.historySize ?? 900;
        while (this.history.length > 0 && this.history[0]!.at < now - 30 * 60_000) this.history.shift();
        if (this.history.length > max) this.history.splice(0, this.history.length - max);
      }
      this.raw = snap
        .names()
        .filter((n) => n.startsWith('livekit_') && !/_bucket$/.test(n))
        .sort()
        .map((name) => ({ name, value: snap.sum(name) ?? 0 }));
      this.error = null;
      this.lastOkAt = now;
    } catch (err) {
      this.error = errorText(err);
    }
  }

  /** Paneldeki durum: son ölçüm eskiyse (ölçüm döngüsü çalışmıyorsa, ör. testler) şimdi ölçer */
  async status(now = Date.now()): Promise<LiveKitMetricsStatus> {
    if (this.configured && this.timer === null && !this.looping && now - this.lastTryAt > 15_000) await this.scrape(now);
    const ok = this.configured && this.error === null && this.lastOkAt !== null;
    return {
      configured: this.configured,
      ok,
      error: this.configured ? this.error : 'LIVEKIT_METRICS_URL ayarlı değil',
      lastOkAt: this.lastOkAt,
      latest: ok ? this.latest : null,
      raw: ok ? this.raw : [],
    };
  }

  /** Geçmiş; en az aralık (minGapMs) verilirse sık ölçümler seyreltilir (panel grafikleri için) */
  historySince(since: number, minGapMs = 0): LiveKitMetricSample[] {
    let last = -Infinity;
    return this.history.filter((s) => {
      if (s.at < since || s.at - last < minGapMs) return false;
      last = s.at;
      return true;
    });
  }

  /** [from, to] aralığındaki ölçümler, olay kanıtı biçiminde */
  window(from: number, to: number): LkRow[] {
    return this.history.filter((s) => s.at >= from && s.at <= to).map(lkRow);
  }

  /** Kapsayıcı tablosu için LiveKit sürecinin son CPU/bellek ölçümü */
  process(): { cpu: number | null; rss: number | null; ok: boolean } {
    const ok = this.error === null && this.latest !== null;
    return { cpu: ok ? this.latest!.cpu : null, rss: ok ? this.latest!.rss : null, ok };
  }
}

// ---------- Kapsayıcılar, yedekler, sertifikalar ----------

export interface ContainerStats {
  name: 'api' | 'livekit' | 'caddy';
  /** Tek çekirdek oranı (1 = bir çekirdeğin tamamı) */
  cpu: number | null;
  memory: number | null;
  memoryLimit: number | null;
  /** Değerin kaynağı: cgroup, süreç (Node), prometheus */
  source: string;
  ok: boolean;
  error: string | null;
}

export interface CaddyStats {
  ok: boolean;
  error: string | null;
  /** TURN/TLS (443) üzerinden LiveKit'e aktarılan bağlantılar: şu an açık ve dakikadaki yeni */
  turnActive: number | null;
  turnPerMin: number | null;
  turnTotal: number | null;
  /** Arka uçlar (API, LiveKit) sağlıklı mı */
  upstreams: { upstream: string; healthy: boolean }[];
}

export interface BackupInfo {
  configured: boolean;
  error: string | null;
  count: number;
  totalBytes: number;
  latest: { name: string; at: number; size: number } | null;
  /** Ek ve profil fotoğrafı anlık görüntülerinin son değişikliği */
  attachmentsAt: number | null;
  avatarsAt: number | null;
  recent: { name: string; at: number; size: number }[];
}

export interface TlsInfo {
  domain: string;
  ok: boolean;
  validTo: number | null;
  daysLeft: number | null;
  issuer: string | null;
  /** Sertifika zinciri doğrulandı mı */
  authorized: boolean;
  error: string | null;
  checkedAt: number;
}

export interface ContainerSample {
  at: number;
  api: number | null;
  livekit: number | null;
  caddy: number | null;
}

export interface InfraOptions {
  /** API kapsayıcısının cgroup kökü (kapsayıcının içinden bakınca kendi cgroup'u) */
  cgroupRoot: string;
  caddyMetricsUrl: string | null;
  backupDir: string | null;
  tlsDomains: string[];
  /** TLS el sıkışmasının yapılacağı adres (host ağında Caddy: 127.0.0.1) */
  tlsHost: string;
  tlsPort?: number;
  fetchImpl?: typeof fetch;
  log?: Log;
}

const TLS_CHECK_MS = 6 * 3_600_000;
const BACKUP_SCAN_MS = 5 * 60_000;
const BACKUP_FILE = /^diskort-.*\.db\.gz$/;

/** TLS el sıkışmasıyla sertifikanın bitiş tarihi (geçersiz olsa da okunur) */
export function checkTls(domain: string, host: string, port = 443, timeoutMs = 5_000): Promise<Omit<TlsInfo, 'checkedAt'>> {
  return new Promise((resolve) => {
    const done = (info: Omit<TlsInfo, 'checkedAt'>): void => {
      socket.destroy();
      resolve(info);
    };
    const fail = (err: unknown): void =>
      done({ domain, ok: false, validTo: null, daysLeft: null, issuer: null, authorized: false, error: errorText(err) });
    const socket = tls.connect({ host, port, servername: domain, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) return fail(new Error('sertifika yok'));
      const validTo = Date.parse(cert.valid_to);
      done({
        domain,
        ok: true,
        validTo: Number.isFinite(validTo) ? validTo : null,
        daysLeft: Number.isFinite(validTo) ? Math.floor((validTo - Date.now()) / 86_400_000) : null,
        issuer: (cert.issuer?.O || cert.issuer?.CN || null) as string | null,
        authorized: socket.authorized,
        error: socket.authorized ? null : String(socket.authorizationError ?? ''),
      });
    });
    socket.on('timeout', () => fail(new Error('zaman aşımı')));
    socket.on('error', fail);
  });
}

async function readNumber(file: string): Promise<number | null> {
  const text = await fs.promises.readFile(file, 'utf8').catch(() => null);
  if (text === null) return null;
  const v = Number(text.trim());
  return Number.isFinite(v) ? v : null;
}

export class InfraMonitor {
  private readonly fetchImpl: typeof fetch;
  private prevApiCpu: { at: number; usec: number } | null = null;
  private prevProcessCpu: { at: number; usec: number } | null = null;
  private prevCaddy: PromSnapshot | null = null;
  private api: ContainerStats = { name: 'api', cpu: null, memory: null, memoryLimit: null, source: 'cgroup', ok: false, error: null };
  private caddyProc: ContainerStats = { name: 'caddy', cpu: null, memory: null, memoryLimit: null, source: 'prometheus', ok: false, error: null };
  private caddy: CaddyStats = { ok: false, error: null, turnActive: null, turnPerMin: null, turnTotal: null, upstreams: [] };
  private backups: BackupInfo | null = null;
  private backupsAt = 0;
  private tlsInfo: TlsInfo[] = [];
  private tlsAt = 0;
  private readonly history: ContainerSample[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  private lastSample = 0;

  constructor(
    private readonly opts: InfraOptions,
    private readonly livekit: LiveKitMetrics,
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    void this.sample();
    this.timer = setInterval(() => void this.sample(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  sample(now = Date.now()): Promise<void> {
    this.inflight ??= this.doSample(now).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doSample(now: number): Promise<void> {
    this.lastSample = now;
    await Promise.all([this.sampleApi(now), this.sampleCaddy(now)]);
    const lk = this.livekit.process();
    this.history.push({ at: now, api: this.api.cpu, livekit: lk.cpu, caddy: this.caddyProc.cpu });
    if (this.history.length > 120) this.history.splice(0, this.history.length - 120);
    if (now - this.backupsAt >= BACKUP_SCAN_MS) {
      this.backupsAt = now;
      this.backups = await this.scanBackups();
    }
    if (this.opts.tlsDomains.length > 0 && now - this.tlsAt >= TLS_CHECK_MS) {
      this.tlsAt = now;
      this.tlsInfo = await Promise.all(
        this.opts.tlsDomains.map(async (d) => ({
          ...(await checkTls(d, this.opts.tlsHost, this.opts.tlsPort ?? 443)),
          checkedAt: now,
        })),
      );
    }
  }

  /** API kapsayıcısı: cgroup v2 (memory.current, cpu.stat); okunamazsa Node sürecinin kendisi */
  private async sampleApi(now: number): Promise<void> {
    const root = this.opts.cgroupRoot;
    const [memory, max, stat] = await Promise.all([
      readNumber(path.join(root, 'memory.current')),
      fs.promises.readFile(path.join(root, 'memory.max'), 'utf8').catch(() => null),
      fs.promises.readFile(path.join(root, 'cpu.stat'), 'utf8').catch(() => null),
    ]);
    const usec = stat ? Number(/^usage_usec\s+(\d+)/m.exec(stat)?.[1] ?? NaN) : NaN;
    if (memory !== null && Number.isFinite(usec)) {
      const prev = this.prevApiCpu;
      this.prevApiCpu = { at: now, usec };
      const limit = max && /^\d+$/.test(max.trim()) ? Number(max.trim()) : null;
      this.api = {
        name: 'api',
        cpu: prev && now > prev.at && usec >= prev.usec ? (usec - prev.usec) / 1000 / (now - prev.at) : this.api.cpu,
        memory,
        memoryLimit: limit,
        source: 'cgroup',
        ok: true,
        error: null,
      };
      return;
    }
    const cpu = process.cpuUsage();
    const total = cpu.user + cpu.system;
    const prev = this.prevProcessCpu;
    this.prevProcessCpu = { at: now, usec: total };
    this.api = {
      name: 'api',
      cpu: prev && now > prev.at ? (total - prev.usec) / 1000 / (now - prev.at) : null,
      memory: process.memoryUsage().rss,
      memoryLimit: null,
      source: 'süreç',
      ok: true,
      error: null,
    };
  }

  private async sampleCaddy(now: number): Promise<void> {
    const url = this.opts.caddyMetricsUrl;
    if (!url) {
      this.caddyProc = { ...this.caddyProc, ok: false, error: 'CADDY_METRICS_URL ayarlı değil', cpu: null, memory: null };
      this.caddy = { ok: false, error: 'CADDY_METRICS_URL ayarlı değil', turnActive: null, turnPerMin: null, turnTotal: null, upstreams: [] };
      return;
    }
    try {
      const snap = PromSnapshot.parse(await fetchText(url, 3_000, this.fetchImpl), now);
      const prev = this.prevCaddy && now - this.prevCaddy.at <= 120_000 ? this.prevCaddy : null;
      this.prevCaddy = snap;
      const dt = prev ? (now - prev.at) / 1000 : 0;
      const cpu = prev ? counterRate(snap.sum('process_cpu_seconds_total'), prev.sum('process_cpu_seconds_total'), dt) : null;
      this.caddyProc = {
        name: 'caddy',
        cpu: cpu ?? this.caddyProc.cpu,
        memory: snap.sum('process_resident_memory_bytes'),
        memoryLimit: null,
        source: 'prometheus',
        ok: true,
        error: null,
      };
      const turnRate = prev
        ? counterRate(snap.sum('caddy_layer4_proxy_connections_total'), prev.sum('caddy_layer4_proxy_connections_total'), dt)
        : null;
      this.caddy = {
        ok: true,
        error: null,
        turnActive: snap.sum('caddy_layer4_proxy_active_connections'),
        turnPerMin: turnRate === null ? null : turnRate * 60,
        turnTotal: snap.sum('caddy_layer4_proxy_connections_total'),
        upstreams: snap
          .series('caddy_reverse_proxy_upstreams_healthy')
          .map((s) => ({ upstream: s.labels.upstream ?? '?', healthy: s.value === 1 })),
      };
    } catch (err) {
      const error = errorText(err);
      this.caddyProc = { ...this.caddyProc, ok: false, error, cpu: null, memory: null };
      this.caddy = { ok: false, error, turnActive: null, turnPerMin: null, turnTotal: null, upstreams: [] };
    }
  }

  private async scanBackups(): Promise<BackupInfo> {
    const dir = this.opts.backupDir;
    const empty: BackupInfo = {
      configured: dir !== null,
      error: null,
      count: 0,
      totalBytes: 0,
      latest: null,
      attachmentsAt: null,
      avatarsAt: null,
      recent: [],
    };
    if (!dir) return { ...empty, error: 'BACKUP_DIR ayarlı değil (yedek klasörü bağlanmadı)' };
    try {
      const names = (await fs.promises.readdir(dir)).filter((n) => BACKUP_FILE.test(n));
      const files = (
        await Promise.all(
          names.map(async (name) => {
            const st = await fs.promises.lstat(path.join(dir, name)).catch(() => null);
            return st?.isFile() ? { name, at: st.mtimeMs, size: st.size } : null;
          }),
        )
      ).filter((f): f is { name: string; at: number; size: number } => f !== null);
      files.sort((a, b) => b.at - a.at);
      const dirTime = async (sub: string): Promise<number | null> =>
        (await fs.promises.stat(path.join(dir, sub)).catch(() => null))?.mtimeMs ?? null;
      return {
        ...empty,
        count: files.length,
        totalBytes: files.reduce((n, f) => n + f.size, 0),
        latest: files[0] ?? null,
        attachmentsAt: await dirTime('attachments'),
        avatarsAt: await dirTime('avatars'),
        recent: files.slice(0, 10),
      };
    } catch (err) {
      return { ...empty, error: errorText(err) };
    }
  }

  /** Panel: son ölçüm eskiyse (düzenli ölçüm kapalıysa) şimdi ölçer */
  async snapshot(now = Date.now()): Promise<{
    containers: ContainerStats[];
    history: ContainerSample[];
    caddy: CaddyStats;
    backups: BackupInfo | null;
    tls: TlsInfo[];
  }> {
    if (now - this.lastSample > 20_000) await this.sample(now);
    const lk = this.livekit.process();
    const livekit: ContainerStats = {
      name: 'livekit',
      cpu: lk.cpu,
      memory: lk.rss,
      memoryLimit: null,
      source: 'prometheus',
      ok: lk.ok,
      error: lk.ok ? null : 'LiveKit ölçümleri kapalı',
    };
    return {
      containers: [this.api, livekit, this.caddyProc],
      history: [...this.history],
      caddy: this.caddy,
      backups: this.backups,
      tls: this.tlsInfo,
    };
  }
}
