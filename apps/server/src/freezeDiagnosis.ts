import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { summarizeRows, type SecondRow, type SecondSampler, type ServerSummary } from './netSeconds.js';
import type { TelemetryEntry } from './telemetry.js';

// Yayın donması tanısı: bir ses kanalında aynı sırada birden çok kullanıcı kayıp/donma bildirirse bunu tek
// bir olay olarak toplar, sunucunun saniyelik ağ kaydı ve dış sondalarla birlikte sınıflandırır:
//   ortak yol kaybı · yayıncının yükleme hattı · kodlayıcı/fps düşük · sunucu kaynağı · tek kullanıcı hattı
// Çıktı: en olası neden + kanıt cümleleri. Sınıflandırıcı (diagnose) saf bir fonksiyondur (testlenir).
//
// Zaman çözünürlüğü: istemci özetleri ~30 sn'lik pencerelerdir (kalite bozulunca 10 sn'de bir). Kullanıcıların
// pencereleri çakışıyorsa "aynı anda" sayılır; saniye düzeyinde hizalama sunucu satırlarından (±30 sn) görülür.

export type FreezeCause = 'ortak_yol' | 'yayinci_yukleme' | 'kodlayici' | 'sunucu_kaynak' | 'tek_kullanici' | 'belirsiz';

export const FREEZE_CAUSE_LABELS: Record<FreezeCause, string> = {
  ortak_yol: 'Ortak yol kaybı',
  yayinci_yukleme: 'Yayıncının yükleme hattı',
  kodlayici: 'Kodlayıcı / kare hızı düşük',
  sunucu_kaynak: 'Sunucu kaynağı',
  tek_kullanici: 'Tek kullanıcı hattı',
  belirsiz: 'Belirsiz',
};

/** Kayıp yüzdesi bu değerin üstündeyse kullanıcı "etkilendi" sayılır (assessReport uyarı eşiğiyle aynı) */
export const LOSS_PCT = 3;
/** Ping bu değerin altındaysa "normal" */
const RTT_NORMAL_MS = 150;
/** Yayın kare hızı bunun altındaysa kodlayıcı düşük (30 fps hedefinin %80'i) */
export const LOW_FPS = 24;

export type FreezeRole = 'yayıncı' | 'izleyici' | 'dinleyici';

/** Bir kullanıcının olay süresince özeti */
export interface FreezeUser {
  userId: string;
  role: FreezeRole;
  reports: number;
  /** En yüksek kayıp yüzdeleri */
  lossOut: number | null;
  lossIn: number | null;
  rttAvg: number | null;
  rttMax: number | null;
  /** İzlenen yayında donma sayısı ve toplam süresi (sn) */
  freezes: number;
  freezeSec: number;
  /** Yayıncıysa gönderdiği yayın */
  screen: {
    fpsMin: number | null;
    fpsMax: number | null;
    bitrate: number | null;
    width: number | null;
    height: number | null;
    encoder: string | null;
    hardware: boolean | null;
    limitation: string;
    limitedRatio: number | null;
    encodeMs: number | null;
  } | null;
  /** İzleyiciyse izlediği yayının en düşük kare hızı */
  watchFpsMin: number | null;
  platform: string;
}

export interface Diagnosis {
  cause: FreezeCause;
  label: string;
  confidence: 'yüksek' | 'orta' | 'düşük';
  /** Ana nedenin yanında görülen başka etkenler */
  factors: string[];
  /** İnsan okunur kanıt cümleleri */
  evidence: string[];
  /** Dış sondalar: sağlayıcı yolunda da kayıp var mıydı */
  probe: 'kayıp' | 'temiz' | 'yok';
}

const num = (v: number | null, digits = 0): string => (v === null ? '?' : v.toFixed(digits));
const maxNullable = (a: number | null, b: number | null | undefined): number | null => (b === null || b === undefined ? a : a === null ? b : Math.max(a, b));
const minNullable = (a: number | null, b: number | null | undefined): number | null => (b === null || b === undefined ? a : a === null ? b : Math.min(a, b));

/** Sunucu tarafında kaynak sorunu var mı (NIC düşüşü, UDP tampon hatası, çekirdek kuyruğu, CPU) */
export function serverResourceProblems(s: ServerSummary | null): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (s.nicDrops >= 10) out.push(`NIC'te ${s.nicDrops} paket düştü/hatalı`);
  if (s.udpRcvbufErr + s.udpSndbufErr >= 5) out.push(`UDP tampon hatası (alma ${s.udpRcvbufErr}, gönderme ${s.udpSndbufErr}): net.core.rmem/wmem_max düşük olabilir`);
  if ((s.softnetDrops ?? 0) >= 5) out.push(`Çekirdek ağ kuyruğunda ${s.softnetDrops} paket düştü (softnet)`);
  if ((s.psiMax ?? 0) >= 50) out.push(`CPU baskısı %${num(s.psiMax)} (sunucu işlemci yetiştiremedi)`);
  if (s.livekitCpuMax !== null && s.livekitCpuMax / Math.max(1, s.cores) >= 0.85) {
    out.push(`LiveKit işlemcisi dolu (${num(s.livekitCpuMax * 100)}% / ${s.cores} çekirdek)`);
  }
  return out;
}

function probeVerdict(s: ServerSummary | null): { kind: Diagnosis['probe']; text: string } {
  if (!s || s.probeLossPct === null) return { kind: 'yok', text: 'Dış sonda verisi yok (sunucu ölçümü kapalı ya da yeni başladı).' };
  const worst = Object.entries(s.probes)
    .filter(([label]) => !label.startsWith('ağ geçidi'))
    .sort((a, b) => b[1].lossPct - a[1].lossPct)[0];
  if (s.probeLossPct >= 5) {
    return { kind: 'kayıp', text: `Sunucudan dış hedeflere de kayıp var (%${num(s.probeLossPct, 1)}${worst ? `, en kötü ${worst[0]} %${num(worst[1].lossPct, 1)}` : ''}): sağlayıcı/VPS ağ yolu.` };
  }
  const rtt = Object.values(s.probes)
    .map((p) => p.rttMax)
    .filter((v): v is number => v !== null);
  return {
    kind: 'temiz',
    text: `Dış sondalar temiz (kayıp %${num(s.probeLossPct, 1)}${rtt.length > 0 ? `, en yüksek RTT ${num(Math.max(...rtt))} ms` : ''}): genel internet yolu sağlam; kayıp medya (UDP) akışına özgü ya da istemci tarafı ortak bir noktada olabilir.`,
  };
}

/** Saf sınıflandırıcı: kullanıcı kanıtları + sunucu özeti → en olası neden */
export function diagnose(users: FreezeUser[], server: ServerSummary | null): Diagnosis {
  const up = users.filter((u) => (u.lossOut ?? 0) >= LOSS_PCT);
  const down = users.filter((u) => (u.lossIn ?? 0) >= LOSS_PCT);
  const streamer = users.find((u) => u.role === 'yayıncı') ?? null;
  const freezers = users.filter((u) => u.freezes > 0);
  const affected = new Set([...up, ...down, ...freezers].map((u) => u.userId));
  const probe = probeVerdict(server);
  const evidence: string[] = [];
  const factors: string[] = [];

  const lossRange = (list: FreezeUser[], pick: (u: FreezeUser) => number | null): string => {
    const v = list.map(pick).filter((x): x is number => x !== null);
    return v.length === 0 ? '?' : `%${num(Math.min(...v))}–${num(Math.max(...v))}`;
  };
  const rttNote = (list: FreezeUser[]): string => {
    const r = list.map((u) => u.rttAvg).filter((x): x is number => x !== null);
    if (r.length === 0) return 'ping bilinmiyor';
    return Math.max(...r) < RTT_NORMAL_MS ? `ping normal (en çok ${num(Math.max(...r))} ms)` : `ping de yüksek (${num(Math.max(...r))} ms)`;
  };
  const freezeNote = (): string | null => {
    const n = freezers.reduce((s, u) => s + u.freezes, 0);
    return n > 0 ? `izleyicilerde toplam ${n} donma (${num(freezers.reduce((s, u) => s + u.freezeSec, 0), 1)} sn)` : null;
  };
  const encoderNote = (): string | null => {
    const s = streamer?.screen;
    if (!s) return null;
    const lowFps = s.fpsMin !== null && s.fpsMin > 0 && s.fpsMin < LOW_FPS;
    const limited = s.limitation !== 'none' && (s.limitedRatio ?? 0) >= 0.3;
    if (!lowFps && !limited) return null;
    return `yayıncı ${lowFps ? `${num(s.fpsMin)}–${num(s.fpsMax)} fps` : 'kısıtlı'}${s.limitation !== 'none' ? ` (kısıtlama: ${s.limitation})` : ''}${s.encoder ? `, ${s.encoder}` : ''}${s.bitrate ? `, ${num(s.bitrate / 1e6, 1)} Mbps` : ''}`;
  };
  const enc = encoderNote();
  const resource = serverResourceProblems(server);
  if (resource.length > 0) evidence.push(...resource);

  // 1) Sunucu kaynağı: sunucuda açık bir kaynak sorunu varken kayıp gören en az bir kullanıcı
  if (resource.length > 0 && (up.length > 0 || down.length > 0 || freezers.length > 0)) {
    if (up.length > 0) evidence.push(`${up.length} kullanıcıda giden kayıp ${lossRange(up, (u) => u.lossOut)}`);
    if (down.length > 0) evidence.push(`${down.length} kullanıcıda gelen kayıp ${lossRange(down, (u) => u.lossIn)}`);
    const f = freezeNote();
    if (f) evidence.push(f);
    if (enc) factors.push(enc);
    return { cause: 'sunucu_kaynak', label: FREEZE_CAUSE_LABELS.sunucu_kaynak, confidence: 'yüksek', factors, evidence, probe: probe.kind };
  }

  // 2) Ortak yol: birden çok kullanıcının kendi yükleme hatları birlikte kaybediyor (bağımsız hatlar aynı anda
  // bozulmaz), ya da yayıncı temizken birden çok izleyici gelen kayıp görüyor (sunucu çıkışı)
  const streamerUp = streamer !== null && up.some((u) => u.userId === streamer.userId);
  const commonUp = up.length >= 2;
  const commonDown = down.length >= 2 && !streamerUp;
  if (commonUp || commonDown) {
    const who = commonUp ? up : down;
    const dir = commonUp ? 'giden' : 'gelen';
    evidence.push(
      `${who.length} kullanıcıda aynı sırada ${dir} kayıp ${lossRange(who, (u) => (commonUp ? u.lossOut : u.lossIn))}; ${rttNote(who)}`,
    );
    if (commonUp && down.length > 0) evidence.push(`${down.length} kullanıcıda gelen kayıp ${lossRange(down, (u) => u.lossIn)}`);
    const f = freezeNote();
    if (f) evidence.push(f);
    evidence.push(probe.text);
    if (server) {
      evidence.push(
        `Sunucu ağı: en yüksek giden ${server.txMbpsMax === null ? '?' : `${num(server.txMbpsMax, 1)} Mbps`}, NIC düşüşü ${server.nicDrops}, UDP tampon hatası ${server.udpRcvbufErr + server.udpSndbufErr}, sunucu kaynak sorunu yok.`,
      );
    } else evidence.push('Sunucu ağ kaydı yok.');
    if (enc) factors.push(enc);
    if (probe.kind === 'kayıp') factors.push('sağlayıcı/VPS ağ yolu');
    else if (probe.kind === 'temiz') factors.push('dış sondalar temiz: UDP medya akışına özgü süzgeç/hız sınırı ya da istemciler arası ortak hat olabilir');
    return {
      cause: 'ortak_yol',
      label: FREEZE_CAUSE_LABELS.ortak_yol,
      confidence: who.length >= 3 || probe.kind === 'kayıp' ? 'yüksek' : 'orta',
      factors,
      evidence,
      probe: probe.kind,
    };
  }

  // 3) Tek kullanıcının yükleme hattı
  if (up.length === 1) {
    const u = up[0]!;
    evidence.push(`Yalnızca bir kullanıcıda giden kayıp %${num(u.lossOut)}; ${rttNote([u])}`);
    if (down.length > 0) evidence.push(`${down.length} kullanıcıda gelen kayıp ${lossRange(down, (x) => x.lossIn)} (bu kullanıcının gönderdiği akışı alanlar)`);
    const f = freezeNote();
    if (f) evidence.push(f);
    evidence.push(probe.text);
    if (enc) factors.push(enc);
    if (streamer && u.userId === streamer.userId) {
      return { cause: 'yayinci_yukleme', label: FREEZE_CAUSE_LABELS.yayinci_yukleme, confidence: down.length > 0 || freezers.length > 0 ? 'yüksek' : 'orta', factors, evidence, probe: probe.kind };
    }
    return { cause: 'tek_kullanici', label: FREEZE_CAUSE_LABELS.tek_kullanici, confidence: 'orta', factors, evidence, probe: probe.kind };
  }

  // 4) Ağda kayıp yok: kodlayıcı / kare hızı
  const networkLoss = down.length > 0;
  const limitedByNetwork = streamer?.screen?.limitation === 'bandwidth';
  if (!networkLoss && enc && !limitedByNetwork) {
    evidence.push(`Kimsede paket kaybı yok; ${enc}`);
    const f = freezeNote();
    if (f) evidence.push(f);
    evidence.push(probe.text);
    return { cause: 'kodlayici', label: FREEZE_CAUSE_LABELS.kodlayici, confidence: freezers.length > 0 ? 'yüksek' : 'orta', factors, evidence, probe: probe.kind };
  }

  // 5) Tek kullanıcıda gelen kayıp / donma (yayıncı ve diğerleri temiz)
  if (affected.size === 1 || (down.length === 1 && up.length === 0)) {
    const u = down[0] ?? freezers[0] ?? users[0]!;
    evidence.push(`Yalnızca bir kullanıcı etkilendi${u.lossIn !== null ? ` (gelen kayıp %${num(u.lossIn)})` : ''}; ${rttNote([u])}; yayıncı ve diğer kullanıcılar temiz`);
    const f = freezeNote();
    if (f) evidence.push(f);
    if (enc) factors.push(enc);
    return { cause: 'tek_kullanici', label: FREEZE_CAUSE_LABELS.tek_kullanici, confidence: 'orta', factors, evidence, probe: probe.kind };
  }

  // 6) Belirsiz
  const f = freezeNote();
  if (f) evidence.push(f);
  if (enc) evidence.push(enc);
  if (evidence.length === 0) evidence.push('Belirgin bir ağ, kaynak ya da kodlayıcı işareti yok.');
  evidence.push(probe.text);
  return { cause: 'belirsiz', label: FREEZE_CAUSE_LABELS.belirsiz, confidence: 'düşük', factors, evidence, probe: probe.kind };
}

// ---------- Olay toplayıcı ----------

export interface FreezeEvent extends Diagnosis {
  id: string;
  channelId: string;
  guildId: string | null;
  start: number;
  end: number;
  users: FreezeUser[];
  /** Etkilenen kullanıcı sayısı ve izleyicilerdeki toplam donma */
  affected: number;
  freezes: number;
  freezeSec: number;
  /** Yayın var mıydı */
  streaming: boolean;
  server: ServerSummary | null;
}

interface OpenEvent {
  id: string;
  channelId: string;
  guildId: string | null;
  start: number;
  end: number;
  lastRelevantAt: number;
  relevantUsers: Set<string>;
}

/** Olay bu kadar süre yeni ilgili özet gelmezse kapanır (başka kullanıcıların özetleri de gelsin) */
const QUIET_MS = 75_000;
/** Bir olay en fazla bu kadar sürer (sonra bölünür) */
const MAX_EVENT_MS = 10 * 60_000;
const RECENT_MS = 12 * 60_000;
const CHART_BEFORE_MS = 30_000;
const CHART_AFTER_MS = 10_000;
const CHART_MAX_ROWS = 300;
const EVENTS_MAX = 300;
const EVENT_FILE_MAX_LINES = 1_000;
const ROWS_FILE_MAX_LINES = 150;

/** Bu özet bir kayıp/donma işareti taşıyor mu */
export function isRelevantEntry(e: Pick<TelemetryEntry, 'lossOut' | 'lossIn' | 'watch'>): boolean {
  const w = e.watch;
  return (e.lossOut ?? 0) >= LOSS_PCT || (e.lossIn ?? 0) >= LOSS_PCT || (w?.freezes ?? 0) >= 2 || (w?.freezeSec ?? 0) >= 1;
}

/** Özetlerden kullanıcı kanıtı (saf) */
export function buildUsers(entries: TelemetryEntry[]): FreezeUser[] {
  const byUser = new Map<string, FreezeUser>();
  for (const e of entries) {
    let u = byUser.get(e.userId);
    if (!u) {
      u = {
        userId: e.userId,
        role: 'dinleyici',
        reports: 0,
        lossOut: null,
        lossIn: null,
        rttAvg: null,
        rttMax: null,
        freezes: 0,
        freezeSec: 0,
        screen: null,
        watchFpsMin: null,
        platform: e.platform,
      };
      byUser.set(e.userId, u);
    }
    u.reports++;
    u.lossOut = maxNullable(u.lossOut, e.lossOut);
    u.lossIn = maxNullable(u.lossIn, e.lossIn);
    u.rttAvg = maxNullable(u.rttAvg, e.rttAvg);
    u.rttMax = maxNullable(u.rttMax, e.rttMax);
    const w = e.watch;
    if (w) {
      u.freezes += w.freezes ?? 0;
      u.freezeSec += w.freezeSec ?? 0;
      if ((w.fps ?? 0) > 0 || (w.bitrate ?? 0) > 0) {
        if (u.role === 'dinleyici') u.role = 'izleyici';
        u.watchFpsMin = minNullable(u.watchFpsMin, (w.fps ?? 0) > 0 ? w.fps : null);
      }
    }
    const s = e.screen;
    if (s && ((s.fps ?? 0) > 0 || (s.bitrate ?? 0) > 0)) {
      u.role = 'yayıncı';
      const prev = u.screen;
      u.screen = {
        fpsMin: minNullable(prev?.fpsMin ?? null, (s.fps ?? 0) > 0 ? s.fps : null),
        fpsMax: maxNullable(prev?.fpsMax ?? null, s.fps),
        bitrate: maxNullable(prev?.bitrate ?? null, s.bitrate),
        width: s.width,
        height: s.height,
        encoder: s.encoder ?? prev?.encoder ?? null,
        hardware: s.hardware ?? prev?.hardware ?? null,
        limitation: s.limitation !== 'none' ? s.limitation : (prev?.limitation ?? 'none'),
        limitedRatio: maxNullable(prev?.limitedRatio ?? null, s.limitedRatio),
        encodeMs: maxNullable(prev?.encodeMs ?? null, s.encodeMs),
      };
    }
  }
  return [...byUser.values()];
}

function isFreezeEvent(v: unknown): v is FreezeEvent {
  const e = v as Partial<FreezeEvent> | null;
  return !!e && typeof e.id === 'string' && typeof e.channelId === 'string' && typeof e.start === 'number' && typeof e.cause === 'string';
}

export interface FreezeOptions {
  /** <dataDir>/telemetry; null: yalnızca bellekte */
  dir: string | null;
  sampler: SecondSampler | null;
  /** Olay kapanıp sınıflandığında (kalıcı kayıttan sonra) */
  onEvent?: (event: FreezeEvent) => void;
  log?: { warn(obj: object, msg: string): void };
}

export class FreezeCorrelator {
  private readonly recent = new Map<string, TelemetryEntry[]>();
  private readonly open = new Map<string, OpenEvent>();
  private events: FreezeEvent[] = [];
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private warned = false;

  constructor(private readonly opts: FreezeOptions) {
    this.load();
  }

  private get eventFile(): string {
    return path.join(this.opts.dir!, 'freeze-events.jsonl');
  }

  private get rowsFile(): string {
    return path.join(this.opts.dir!, 'freeze-rows.jsonl');
  }

  private load(): void {
    if (!this.opts.dir) return;
    let text: string;
    try {
      text = fs.readFileSync(this.eventFile, 'utf8');
    } catch {
      return;
    }
    const lines = text.split('\n').filter(Boolean);
    const since = Date.now() - 30 * 86_400_000;
    const loaded: FreezeEvent[] = [];
    for (const line of lines) {
      try {
        const v = JSON.parse(line) as unknown;
        if (isFreezeEvent(v) && v.end >= since) loaded.push(v);
      } catch {
        // bozuk satır atlanır
      }
    }
    this.events = loaded.slice(-EVENTS_MAX);
    if (lines.length > EVENT_FILE_MAX_LINES) {
      try {
        fs.writeFileSync(this.eventFile, this.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      } catch {
        // bir sonraki açılışta
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), 10_000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sweep(Date.now(), true);
    await this.writing;
  }

  /** Yeni telemetri özeti (TelemetryStore.ingest'ten sonra) */
  observe(e: TelemetryEntry): void {
    if (!e.channelId) return;
    const list = this.recent.get(e.channelId) ?? [];
    list.push(e);
    const from = e.at - RECENT_MS;
    while (list.length > 0 && list[0]!.at < from) list.shift();
    this.recent.set(e.channelId, list);
    if (!isRelevantEntry(e)) return;
    const windowStart = e.at - Math.max(1, e.windowSec) * 1000;
    let ev = this.open.get(e.channelId);
    if (ev && e.at - ev.start > MAX_EVENT_MS) {
      this.finalize(ev);
      ev = undefined;
    }
    if (!ev) {
      ev = {
        id: `${e.at.toString(36)}-${(this.seq++).toString(36)}`,
        channelId: e.channelId,
        guildId: e.guildId,
        start: windowStart,
        end: e.at,
        lastRelevantAt: e.at,
        relevantUsers: new Set(),
      };
      this.open.set(e.channelId, ev);
    }
    ev.start = Math.min(ev.start, windowStart);
    ev.end = Math.max(ev.end, e.at);
    ev.lastRelevantAt = e.at;
    ev.relevantUsers.add(e.userId);
  }

  /** Düzenli: sessiz kalan olayları kapatır; eski özetleri atar */
  sweep(now = Date.now(), all = false): void {
    for (const ev of [...this.open.values()]) {
      if (all || now - ev.lastRelevantAt > QUIET_MS) this.finalize(ev);
    }
    for (const [channelId, list] of this.recent) {
      const from = now - RECENT_MS;
      while (list.length > 0 && list[0]!.at < from) list.shift();
      if (list.length === 0 && !this.open.has(channelId)) this.recent.delete(channelId);
    }
  }

  private finalize(ev: OpenEvent): FreezeEvent | null {
    this.open.delete(ev.channelId);
    // Pencereleri olayla çakışan tüm özetler (temiz çıkanlar dahil: yayıncı fps'i, "kimse etkilenmedi" bilgisi)
    const entries = (this.recent.get(ev.channelId) ?? []).filter((e) => e.at - Math.max(1, e.windowSec) * 1000 <= ev.end && e.at >= ev.start);
    const users = buildUsers(entries);
    const relevant = users.filter((u) => (u.lossOut ?? 0) >= LOSS_PCT || (u.lossIn ?? 0) >= LOSS_PCT || u.freezes > 0);
    const streaming = users.some((u) => u.role === 'yayıncı');
    // Tek başına sesli bir kullanıcının kaybı zaten "Kalite sorunları"nda; burada ≥2 kullanıcı ya da yayın aranır
    if (relevant.length === 0 || (relevant.length < 2 && !streaming)) return null;
    const sampler = this.opts.sampler;
    const rows = sampler ? sampler.window(ev.start - CHART_BEFORE_MS, ev.end + CHART_AFTER_MS) : [];
    const server = sampler ? summarizeRows(sampler.window(ev.start, ev.end), ev.start, ev.end) : null;
    const d = diagnose(users, server && server.seconds > 0 ? server : null);
    const event: FreezeEvent = {
      ...d,
      id: ev.id,
      channelId: ev.channelId,
      guildId: ev.guildId,
      start: ev.start,
      end: ev.end,
      users,
      affected: relevant.length,
      freezes: users.reduce((n, u) => n + u.freezes, 0),
      freezeSec: Number(users.reduce((n, u) => n + u.freezeSec, 0).toFixed(1)),
      streaming,
      server: server && server.seconds > 0 ? server : null,
    };
    this.events.push(event);
    if (this.events.length > EVENTS_MAX) this.events.splice(0, this.events.length - EVENTS_MAX);
    this.persist(event, rows);
    try {
      this.opts.onEvent?.(event);
    } catch (err) {
      this.opts.log?.warn({ err: String(err) }, 'yayın donması bildirimi başarısız');
    }
    return event;
  }

  private persist(event: FreezeEvent, rows: SecondRow[]): void {
    if (!this.opts.dir) return;
    const dir = this.opts.dir;
    const stride = Math.max(1, Math.ceil(rows.length / CHART_MAX_ROWS));
    const sampled = stride === 1 ? rows : rows.filter((_, i) => i % stride === 0);
    this.writing = this.writing
      .then(async () => {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.appendFile(this.eventFile, JSON.stringify(event) + '\n');
        await fs.promises.appendFile(this.rowsFile, JSON.stringify({ id: event.id, rows: sampled }) + '\n');
        await this.trimRows();
      })
      .catch((err: unknown) => {
        if (!this.warned) this.opts.log?.warn({ err: String(err) }, 'yayın donması olayı kaydedilemedi');
        this.warned = true;
      });
  }

  /** Satır dosyası çok uzadıysa en yeni satırları tutar */
  private async trimRows(): Promise<void> {
    const text = await fs.promises.readFile(this.rowsFile, 'utf8').catch(() => '');
    const lines = text.split('\n').filter(Boolean);
    if (lines.length <= ROWS_FILE_MAX_LINES * 2) return;
    await fs.promises.writeFile(this.rowsFile, lines.slice(-ROWS_FILE_MAX_LINES).join('\n') + '\n');
  }

  /** Bekleyen yazımlar bitince çözülür (testler) */
  flushed(): Promise<void> {
    return this.writing;
  }

  // ---------- Okuma ----------

  /** Olaylar, en yeniler önce */
  list(since: number): FreezeEvent[] {
    return this.events.filter((e) => e.end >= since).sort((a, b) => b.end - a.end);
  }

  /** Bir olayın saniyelik satırları (dosyadan); yoksa boş */
  async rowsOf(id: string): Promise<SecondRow[]> {
    if (!this.opts.dir || !/^[0-9a-z-]{1,40}$/.test(id)) return [];
    await this.writing;
    if (!fs.existsSync(this.rowsFile)) return [];
    const rl = readline.createInterface({ input: fs.createReadStream(this.rowsFile, 'utf8'), crlfDelay: Infinity });
    let found: SecondRow[] = [];
    for await (const line of rl) {
      if (!line.includes(`"id":"${id}"`)) continue;
      try {
        const v = JSON.parse(line) as { id: string; rows: SecondRow[] };
        if (v.id === id) found = v.rows;
      } catch {
        continue;
      }
    }
    return found;
  }
}
