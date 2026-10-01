import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type {
  ClientPlatform,
  TelemetryAudioIn,
  TelemetryDevice,
  TelemetryJsLag,
  TelemetryMic,
  TelemetryQuality,
  TelemetryScreen,
  TelemetryVoiceSettings,
  TelemetryWatch,
  VoiceTelemetryReport,
} from '@diskort/shared';
import { dayKey } from './counters.js';

// Ses kalitesi ölçümleri (yönetim paneli). İstemciler sesliyken ~30 sn'de bir özet gönderir
// (POST /api/telemetry/voice). Sunucu:
// - her kullanıcının son özetini (canlı tablo) ve son bir saatini (grafikler) bellekte tutar,
// - her özeti günlük JSONL dosyasına ekler (<dataDir>/telemetry/YYYY-AA-GG.jsonl; 14 gün, gün başına boyut
//   sınırlı) ki geçmişteki sorunlar sonradan incelenebilsin,
// - "kötü" geçen dönemleri olay (incident) olarak kaydeder: kim, ne zaman, ne kadar, olası neden
//   (<dataDir>/telemetry/incidents.jsonl).

export type TelemetrySeverity = 'ok' | 'warn' | 'poor';

/** Saklanan özet: istemcinin gönderdiği + sunucunun eklediği */
export interface TelemetryEntry {
  at: number;
  userId: string;
  /** Sunucunun bildiği ses kanalı (istemci bildirmişse ve seste değilse null) */
  channelId: string | null;
  guildId: string | null;
  platform: ClientPlatform;
  version: string;
  windowSec: number;
  quality: TelemetryQuality;
  poorSec: number;
  serverQuality: string | null;
  rttAvg: number | null;
  rttMax: number | null;
  jitterIn: number | null;
  jitterOut: number | null;
  lossOut: number | null;
  lossIn: number | null;
  concealed: number | null;
  bitrateOut: number | null;
  bitrateIn: number | null;
  availableOut: number | null;
  candidate: string | null;
  protocol: string | null;
  reconnects: number;
  mic: TelemetryMic | null;
  screen: TelemetryScreen | null;
  /** İzlenen yayının çözücüsü ve çözme maliyeti; cihaz durumu (eski özetlerde yok) */
  watch?: TelemetryWatch | null;
  device?: TelemetryDevice | null;
  /** Gelen seslerin ayrıntısı, JS takılması ve ses ayarları (eski özetlerde yok) */
  audioIn?: TelemetryAudioIn | null;
  jsLag?: TelemetryJsLag | null;
  settings?: TelemetryVoiceSettings | null;
  /** Giden kayıp (%), ses ve görüntü ayrı (yeni istemciler) */
  lossOutAudio?: number | null;
  lossOutVideo?: number | null;
  /**
   * Özetin kapsadığı aralığın bittiği an, SUNUCU saatiyle (yeni istemciler): istemcinin bildirdiği bitiş +
   * saat farkı. `at` ulaşma anıdır; geç ulaşan özet (kesinti, yavaş yükleme) bununla doğru zamana yerleşir.
   */
  endAt?: number;
  severity: TelemetrySeverity;
  causes: string[];
}

export interface Incident {
  id: string;
  userId: string;
  channelId: string | null;
  guildId: string | null;
  platform: ClientPlatform;
  version: string;
  start: number;
  end: number;
  /** "Kötü" geçen toplam süre (sn; özetlerin toplamı) */
  poorSec: number;
  reports: number;
  /** Neden → kaç özette görüldü; ilk sıradaki olası ana neden */
  causes: { cause: string; count: number }[];
  worst: { rttMs: number | null; lossOutPct: number | null; lossInPct: number | null; concealedPct: number | null; jitterMs: number | null };
  candidate: string | null;
  protocol: string | null;
  open: boolean;
}

const MINUTE = 60_000;
/** Canlı tabloda gösterilecek en eski özet */
export const TELEMETRY_LIVE_MS = 90_000;
/** Bellekte tutulan geçmiş (kullanıcı başına) */
const HISTORY_MS = 65 * MINUTE;
const HISTORY_MAX = 400;
/** Olay bu kadar süre yeni "kötü" özet gelmezse kapanır */
const INCIDENT_GAP_MS = 75_000;
const INCIDENTS_MAX = 500;
/** Olay dosyası bu kadar satırı geçince açılışta kısaltılır */
const INCIDENT_FILE_MAX_LINES = 2_000;
/** Eski gün dosyalarının silinme aralığı */
const CLEANUP_INTERVAL_MS = 6 * 3_600_000;
/** Geçmiş gün okumasında en fazla dönen özet */
const DAY_READ_MAX = 3_000;

const r = (v: number | null | undefined, digits = 0): number | null => {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** İstemcinin ölçtüğü saat farkı, gönderim anından tahminle bu kadardan fazla ayrışıyorsa güvenilmez */
const OFFSET_TOLERANCE_MS = 30_000;
/** Bundan eski bitiş anı (ör. bozuk istemci saati) yok sayılır */
const END_MAX_AGE_MS = 15 * 60_000;

/**
 * Özetin aralığının bitişi sunucu saatiyle: istemcinin bildirdiği bitiş + saat farkı (istemcinin ölçümü,
 * yoksa ya da tutarsızsa gönderim anından tahmin). Eski istemci bildirmez: alan eklenmez.
 */
export function alignedEnd(
  report: Pick<VoiceTelemetryReport, 'endAt' | 'sentAt' | 'offsetMs'>,
  now: number,
): { endAt?: number } {
  if (report.endAt === undefined || report.sentAt === undefined) return {};
  const estimated = now - report.sentAt;
  const client = report.offsetMs ?? null;
  const offset = client !== null && Math.abs(client - estimated) <= OFFSET_TOLERANCE_MS ? client : estimated;
  const endAt = Math.round(Math.min(now, report.endAt + offset));
  return now - endAt > END_MAX_AGE_MS ? {} : { endAt };
}

const STALL_CAUSE = 'Uygulama takıldı (JS iş parçacığı)';
const LOSS_IN_CAUSE = 'Gelen paket kaybı (indirme hattı)';
const LOSS_IN_UNSURE_CAUSE = 'Gelen paket kaybı (kaynağı belirsiz: konuşanın bağlantısı olabilir)';

/**
 * Özetin ne kadar kötü olduğu ve olası nedenleri. Eşikler Discord'un "bağlantı kötü" uyarısına yakın:
 * 250 ms ve üstü gecikme ya da %10 üstü kayıp sesi bozar; %3 / 120 ms "idare eder".
 */
export function assessReport(
  e: Omit<TelemetryEntry, 'severity' | 'causes'>,
  prev?: Pick<TelemetryEntry, 'mic'> | null,
): { severity: TelemetrySeverity; causes: string[] } {
  const poor: string[] = [];
  const warn: string[] = [];
  const add = (list: string[], text: string): void => {
    if (!list.includes(text)) list.push(text);
  };
  const check = (value: number | null, bad: number, meh: number, text: string): void => {
    if (value === null) return;
    if (value >= bad) add(poor, text);
    else if (value >= meh) add(warn, text);
  };
  check(e.rttAvg !== null && e.rttMax !== null ? Math.max(e.rttAvg, e.rttMax * 0.6) : e.rttAvg, 250, 120, 'Yüksek gecikme (ping)');
  check(e.lossOut, 10, 3, 'Giden paket kaybı (yükleme hattı)');
  check(e.lossIn, 10, 3, LOSS_IN_CAUSE);
  check(e.concealed, 8, 3, 'Gelen seste kesilme (kayıp ses sentezlendi)');
  check(e.jitterIn, 60, 30, 'Yüksek titreşim (jitter)');
  // Yalnızca ses paketlerinin kaybı (yeni istemciler): kayıp konuşanın yükleme hattında da olabilir
  // (SFU boşluğu olduğu gibi iletir). Duyulur bozulma (kesilme ya da titreşim) yoksa en fazla uyarı.
  const audioLoss = e.audioIn?.lossPct ?? null;
  if (audioLoss !== null && audioLoss >= 3) {
    const audible = (e.concealed ?? 0) >= 3 || (e.jitterIn ?? 0) >= 30;
    if (audible) check(audioLoss, 10, 3, LOSS_IN_CAUSE);
    else if (!poor.includes(LOSS_IN_CAUSE) && !warn.includes(LOSS_IN_CAUSE)) add(warn, LOSS_IN_UNSURE_CAUSE);
  }
  // Uygulama (JS) 1 sn'den uzun takıldı: tek başına uyarı (olay açmaz); kötü dönemde ek neden (kopmaların sebebi olabilir)
  const stalled = (e.jsLag?.maxMs ?? 0) >= 1_000;
  if (stalled) warn.push(STALL_CAUSE);
  if (e.reconnects > 0) poor.push('Bağlantı koptu, yeniden bağlandı');
  if (e.serverQuality === 'lost') poor.push('LiveKit bağlantıyı kayıp gördü');
  const s = e.screen;
  if (s && s.limitation !== 'none' && (s.limitedRatio ?? 0) >= 0.3) {
    const text =
      s.limitation === 'cpu'
        ? 'Yayın kodlayıcısına işlemci yetmiyor'
        : s.limitation === 'bandwidth'
          ? 'Yayın için bant genişliği yetmiyor'
          : 'Yayın kalitesi kısıtlandı';
    ((s.limitedRatio ?? 0) >= 0.5 ? poor : warn).push(text);
  }
  const m = e.mic;
  if (m) {
    check(m.load, 0.8, 0.6, 'Gürültü engelleyici işlemciyi zorluyor');
    const before = prev?.mic?.underruns;
    if (m.underruns !== null && before !== null && before !== undefined && m.underruns > before) {
      warn.push('Mikrofon işlemede takılma');
    }
  }
  const bad = poor.length > 0 || e.quality === 'poor' || e.poorSec >= 4;
  if (bad) {
    const causes = poor.length > 0 ? poor : ['Bağlantı kalitesi kötü'];
    if (stalled) causes.push(STALL_CAUSE);
    if (e.candidate === 'relay') causes.push(`TURN aktarıcısı üzerinden (${e.protocol ?? '?'})`);
    return { severity: 'poor', causes };
  }
  if (warn.length > 0 || e.quality === 'fair') return { severity: 'warn', causes: warn.length > 0 ? warn : ['Bağlantı idare eder'] };
  return { severity: 'ok', causes: [] };
}

function isIncident(v: unknown): v is Incident {
  const i = v as Partial<Incident> | null;
  return !!i && typeof i.id === 'string' && typeof i.userId === 'string' && typeof i.start === 'number' && typeof i.end === 'number';
}

export interface TelemetryStoreOptions {
  /** JSONL klasörü; null: yalnızca bellekte (testler) */
  dir: string | null;
  retentionDays?: number;
  /** Bir günün dosyasının en büyük boyutu (bayt); aşılırsa o gün kaydedilmez (bellekte yine görünür) */
  maxDayBytes?: number;
  /** Günlerin saat dilimi (dk) */
  offsetMin?: number;
  log?: { warn(obj: object, msg: string): void };
}

export class VoiceTelemetryStore {
  private readonly live = new Map<string, TelemetryEntry>();
  private readonly history = new Map<string, TelemetryEntry[]>();
  private readonly openIncidents = new Map<string, Incident>();
  private incidents: Incident[] = [];
  private buffer: string[] = [];
  private incidentBuffer: string[] = [];
  private readonly dayBytes = new Map<string, number>();
  private flushing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private warned = false;
  private seq = 0;
  private lastCleanup = 0;
  /** Sunucu açıldığından beri alınan / boyut sınırı yüzünden dosyaya yazılmayan özetler */
  received = 0;
  dropped = 0;
  readonly retentionDays: number;
  private readonly maxDayBytes: number;
  private readonly offsetMin: number;

  constructor(private readonly opts: TelemetryStoreOptions) {
    this.retentionDays = opts.retentionDays ?? 14;
    this.maxDayBytes = opts.maxDayBytes ?? 30 * 1024 * 1024;
    this.offsetMin = opts.offsetMin ?? 180;
    this.loadIncidents();
  }

  private file(day: string): string {
    return path.join(this.opts.dir!, `${day}.jsonl`);
  }

  private get incidentFile(): string {
    return path.join(this.opts.dir!, 'incidents.jsonl');
  }

  private loadIncidents(): void {
    if (!this.opts.dir) return;
    let text: string;
    try {
      text = fs.readFileSync(this.incidentFile, 'utf8');
    } catch {
      return;
    }
    const lines = text.split('\n').filter(Boolean);
    const since = Date.now() - 30 * 86_400_000;
    const loaded: Incident[] = [];
    for (const line of lines) {
      try {
        const v = JSON.parse(line) as unknown;
        if (isIncident(v) && v.end >= since) loaded.push({ ...v, open: false });
      } catch {
        // bozuk satır atlanır
      }
    }
    this.incidents = loaded.slice(-INCIDENTS_MAX);
    if (lines.length > INCIDENT_FILE_MAX_LINES) {
      try {
        fs.writeFileSync(this.incidentFile, this.incidents.map((i) => JSON.stringify(i)).join('\n') + '\n');
      } catch {
        // kısaltılamazsa bir sonraki açılışta
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), 10_000);
    this.timer.unref();
    this.lastCleanup = Date.now();
    void this.removeOldFiles();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const userId of [...this.openIncidents.keys()]) this.closeIncident(userId);
    await this.flush();
  }

  /** Yeni özet (rota doğrulamasından sonra) */
  ingest(
    userId: string,
    report: VoiceTelemetryReport,
    where: { channelId: string | null; guildId: string | null },
    now = Date.now(),
  ): TelemetryEntry {
    const base: Omit<TelemetryEntry, 'severity' | 'causes'> = {
      at: now,
      userId,
      channelId: where.channelId,
      guildId: where.guildId,
      platform: report.platform,
      version: report.version,
      windowSec: report.windowSec,
      quality: report.quality,
      poorSec: report.poorSec,
      serverQuality: report.serverQuality,
      rttAvg: r(report.rttMs.avg),
      rttMax: r(report.rttMs.max),
      jitterIn: r(report.jitterInMs, 1),
      jitterOut: r(report.jitterOutMs, 1),
      lossOut: r(report.lossOutPct, 2),
      lossIn: r(report.lossInPct, 2),
      concealed: r(report.concealedPct, 2),
      bitrateOut: r(report.bitrateOut),
      bitrateIn: r(report.bitrateIn),
      availableOut: r(report.availableOut),
      candidate: report.candidate,
      protocol: report.protocol,
      reconnects: report.reconnects,
      mic: report.mic
        ? {
            ...report.mic,
            load: r(report.mic.load, 3),
            avgFrameMs: r(report.mic.avgFrameMs, 2),
            p99FrameMs: r(report.mic.p99FrameMs, 2),
            maxFrameMs: r(report.mic.maxFrameMs, 2),
          }
        : null,
      screen: report.screen
        ? {
            ...report.screen,
            fps: r(report.screen.fps, 1),
            bitrate: r(report.screen.bitrate),
            ...(report.screen.encodeMs !== undefined && { encodeMs: r(report.screen.encodeMs, 2) }),
          }
        : null,
      watch: report.watch
        ? {
            ...report.watch,
            fps: r(report.watch.fps, 1),
            decodeMs: r(report.watch.decodeMs, 2),
            decodeMsMax: r(report.watch.decodeMsMax, 2),
            bitrate: r(report.watch.bitrate),
            freezeSec: r(report.watch.freezeSec, 1),
            jitterBufferMs: r(report.watch.jitterBufferMs, 1),
          }
        : null,
      device: report.device ?? null,
      audioIn: report.audioIn
        ? {
            ...report.audioIn,
            jitterMaxMs: r(report.audioIn.jitterMaxMs, 1),
            lossPct: r(report.audioIn.lossPct, 2),
            concealEvents: r(report.audioIn.concealEvents),
            jitterBufferMs: r(report.audioIn.jitterBufferMs, 1),
            bitrate: r(report.audioIn.bitrate),
          }
        : null,
      jsLag: report.jsLag ? { ...report.jsLag, maxMs: r(report.jsLag.maxMs), p95Ms: r(report.jsLag.p95Ms) } : null,
      settings: report.settings ?? null,
      ...(report.lossOutAudioPct !== undefined && { lossOutAudio: r(report.lossOutAudioPct, 2) }),
      ...(report.lossOutVideoPct !== undefined && { lossOutVideo: r(report.lossOutVideoPct, 2) }),
      ...alignedEnd(report, now),
    };
    const entry: TelemetryEntry = { ...base, ...assessReport(base, this.live.get(userId)) };
    this.received++;
    this.live.set(userId, entry);
    const list = this.history.get(userId) ?? [];
    list.push(entry);
    const from = now - HISTORY_MS;
    while (list.length > 0 && (list[0]!.at < from || list.length > HISTORY_MAX)) list.shift();
    this.history.set(userId, list);
    this.trackIncident(entry);
    if (this.opts.dir) this.buffer.push(JSON.stringify(entry));
    return entry;
  }

  private trackIncident(e: TelemetryEntry): void {
    const open = this.openIncidents.get(e.userId);
    if (e.severity !== 'poor') {
      if (open) this.closeIncident(e.userId);
      return;
    }
    let incident = open;
    if (incident && (e.at - incident.end > INCIDENT_GAP_MS || incident.channelId !== e.channelId)) {
      this.closeIncident(e.userId);
      incident = undefined;
    }
    if (!incident) {
      incident = {
        id: `${e.at.toString(36)}-${(this.seq++).toString(36)}`,
        userId: e.userId,
        channelId: e.channelId,
        guildId: e.guildId,
        platform: e.platform,
        version: e.version,
        // Kötü dönem özetin aralığı içinde bir yerde başladı: en kötü tahminle aralığın başı
        start: e.at - Math.max(e.poorSec, Math.min(e.windowSec, 30)) * 1000,
        end: e.at,
        poorSec: 0,
        reports: 0,
        causes: [],
        worst: { rttMs: null, lossOutPct: null, lossInPct: null, concealedPct: null, jitterMs: null },
        candidate: e.candidate,
        protocol: e.protocol,
        open: true,
      };
      this.openIncidents.set(e.userId, incident);
    }
    incident.end = e.at;
    incident.reports++;
    // İstemci kötü süreyi ölçtüyse o; kötülük başka bir nedenden (ör. gelen kayıp) geliyorsa aralığın tamamı
    incident.poorSec += e.poorSec > 0 ? e.poorSec : e.windowSec;
    for (const cause of e.causes) {
      const c = incident.causes.find((x) => x.cause === cause);
      if (c) c.count++;
      else incident.causes.push({ cause, count: 1 });
    }
    incident.causes.sort((a, b) => b.count - a.count);
    const worse = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));
    const w = incident.worst;
    w.rttMs = worse(w.rttMs, e.rttMax ?? e.rttAvg);
    w.lossOutPct = worse(w.lossOutPct, e.lossOut);
    w.lossInPct = worse(w.lossInPct, e.lossIn);
    w.concealedPct = worse(w.concealedPct, e.concealed);
    w.jitterMs = worse(w.jitterMs, e.jitterIn);
    // Bağlantı yolu: dönem içinde TURN aktarıcısına düştüyse o (sorunun parçası olabilir)
    if (e.candidate && (e.candidate === 'relay' || incident.candidate === null)) {
      incident.candidate = e.candidate;
      incident.protocol = e.protocol;
    }
  }

  private closeIncident(userId: string): void {
    const incident = this.openIncidents.get(userId);
    if (!incident) return;
    this.openIncidents.delete(userId);
    const closed = { ...incident, open: false };
    this.incidents.push(closed);
    if (this.incidents.length > INCIDENTS_MAX) this.incidents.splice(0, this.incidents.length - INCIDENTS_MAX);
    if (this.opts.dir) this.incidentBuffer.push(JSON.stringify(closed));
  }

  /** Düzenli: sessiz kalan olayları kapatır, dosyalara yazar */
  async sweep(now = Date.now()): Promise<void> {
    for (const [userId, incident] of this.openIncidents) {
      if (now - incident.end > INCIDENT_GAP_MS) this.closeIncident(userId);
    }
    for (const [userId, entry] of this.live) {
      if (now - entry.at > HISTORY_MS) {
        this.live.delete(userId);
        this.history.delete(userId);
      }
    }
    await this.flush(now);
    // Saklama süresi: günde birkaç kez eski gün dosyaları silinir
    if (now - this.lastCleanup >= CLEANUP_INTERVAL_MS) {
      this.lastCleanup = now;
      await this.removeOldFiles(now);
    }
  }

  /** Bekleyen satırları dosyalara ekler (gün başına boyut sınırıyla) */
  flush(now = Date.now()): Promise<void> {
    if (!this.opts.dir || (this.buffer.length === 0 && this.incidentBuffer.length === 0)) return Promise.resolve();
    this.flushing ??= this.doFlush(now).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(now: number): Promise<void> {
    const dir = this.opts.dir!;
    const lines = this.buffer;
    const incidents = this.incidentBuffer;
    this.buffer = [];
    this.incidentBuffer = [];
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      // Satırlar kendi günlerinin dosyasına (gece yarısını aşan tampon da doğru güne gider)
      const byDay = new Map<string, string[]>();
      for (const line of lines) {
        const at = Number(/"at":(\d+)/.exec(line)?.[1] ?? now);
        const day = dayKey(at, this.offsetMin);
        const list = byDay.get(day);
        if (list) list.push(line);
        else byDay.set(day, [line]);
      }
      for (const [day, dayLines] of byDay) {
        let size = this.dayBytes.get(day);
        if (size === undefined) size = (await fs.promises.stat(this.file(day)).catch(() => null))?.size ?? 0;
        const kept: string[] = [];
        for (const line of dayLines) {
          const bytes = Buffer.byteLength(line) + 1;
          if (size + bytes > this.maxDayBytes) {
            this.dropped++;
            continue;
          }
          size += bytes;
          kept.push(line);
        }
        this.dayBytes.set(day, size);
        if (kept.length > 0) await fs.promises.appendFile(this.file(day), kept.join('\n') + '\n');
      }
      if (incidents.length > 0) await fs.promises.appendFile(this.incidentFile, incidents.join('\n') + '\n');
    } catch (err) {
      if (!this.warned) this.opts.log?.warn({ err: String(err) }, 'ses kalitesi ölçümleri kaydedilemedi');
      this.warned = true;
    }
  }

  /** Saklama süresini aşan günlük dosyaları siler */
  async removeOldFiles(now = Date.now()): Promise<void> {
    if (!this.opts.dir) return;
    const oldest = dayKey(now - (this.retentionDays - 1) * 86_400_000, this.offsetMin);
    const names = await fs.promises.readdir(this.opts.dir).catch(() => [] as string[]);
    for (const name of names) {
      const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (m && m[1]! < oldest) await fs.promises.rm(path.join(this.opts.dir, name), { force: true }).catch(() => undefined);
    }
    for (const day of this.dayBytes.keys()) if (day < oldest) this.dayBytes.delete(day);
  }

  // ---------- Okuma ----------

  /** Kullanıcı başına son özet (canlı tablo) */
  liveEntries(now = Date.now()): TelemetryEntry[] {
    return [...this.live.values()].filter((e) => now - e.at <= TELEMETRY_LIVE_MS);
  }

  historyOf(userId: string, since: number): TelemetryEntry[] {
    return (this.history.get(userId) ?? []).filter((e) => e.at >= since);
  }

  /** Olaylar (açık olanlar dahil), en yeniler önce */
  incidentList(since: number): Incident[] {
    const all = [...this.incidents, ...[...this.openIncidents.values()].map((i) => ({ ...i }))];
    return all.filter((i) => i.end >= since).sort((a, b) => b.end - a.end);
  }

  /** Gün listesi (dosyası olan, yeniden eskiye) */
  async days(): Promise<{ day: string; size: number }[]> {
    if (!this.opts.dir) return [];
    const names = await fs.promises.readdir(this.opts.dir).catch(() => [] as string[]);
    const out: { day: string; size: number }[] = [];
    for (const name of names) {
      const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (!m) continue;
      const st = await fs.promises.stat(path.join(this.opts.dir, name)).catch(() => null);
      if (st) out.push({ day: m[1]!, size: st.size });
    }
    return out.sort((a, b) => (a.day < b.day ? 1 : -1));
  }

  /** Geçmiş bir günün (dosyadan) bir kullanıcıya ait özetleri */
  async readDay(userId: string, day: string): Promise<{ entries: TelemetryEntry[]; truncated: boolean }> {
    const entries: TelemetryEntry[] = [];
    if (!this.opts.dir || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { entries, truncated: false };
    await this.flush();
    const file = this.file(day);
    if (!fs.existsSync(file)) return { entries, truncated: false };
    const needle = `"userId":${JSON.stringify(userId)}`;
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    let truncated = false;
    for await (const line of rl) {
      if (!line.includes(needle)) continue;
      try {
        entries.push(JSON.parse(line) as TelemetryEntry);
      } catch {
        continue;
      }
      if (entries.length >= DAY_READ_MAX) {
        truncated = true;
        rl.close();
        break;
      }
    }
    return { entries, truncated };
  }
}
