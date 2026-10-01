import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import { nanoid } from 'nanoid';
import { buildPlan, type LineMode, type LinePlan, type LineProfile, type LineTransport, type PlanStep } from './plan.js';
import { LineTokens, type LineToken, type SecondStat } from './protocol.js';
import { LineTestServer, type LineFinish, type LineSession, type OpenError } from './udpServer.js';
import { classify, type Finding, type TcpSecond, type VerdictRun } from './verdict.js';

/** Sunucuda saklanan kısa süreli "test kodu": yönetici arkadaşlarına verir, parolasız hat testi çalıştırılır */
export interface LineCode {
  code: string;
  label: string;
  expiresAt: number;
  uses: number;
  maxUses: number;
}

export interface LineWho {
  kind: 'user' | 'code';
  userId: string | null;
  name: string;
}

export interface ClientContext {
  os?: string;
  arch?: string;
  node?: string;
  app?: string;
  tool?: string;
  /** yerel IP türü: private | cgnat | public | unknown */
  localIp?: string;
  tracert?: string;
  note?: string;
  /** istemcinin ölçtüğü sunucu saat farkı ve HTTPS gidiş-dönüş süresi (ms) */
  clockOffsetMs?: number;
  rttMs?: number;
}

export interface LineRun {
  id: string;
  suite: string;
  at: number;
  end: number;
  who: LineWho;
  ip: string | null;
  transport: LineTransport;
  profile: LineProfile;
  mode: LineMode;
  steps: PlanStep[];
  streaming: { start: boolean; end: boolean; channels: string[] };
  serverTxMbps: number | null;
  up: SecondStat[] | null;
  down: SecondStat[] | null;
  downSent: number[] | null;
  downErrors: number[] | null;
  tcpUp: TcpSecond[] | null;
  tcpDown: TcpSecond[] | null;
  client: ClientContext | null;
  /** İstemci raporu gelmedi (yalnızca sunucu tarafı ölçüm) */
  partial: boolean;
  /** UDP el sıkışması tamamlanamadı: sunucuya hiç ulaşılamadı (kayıp sayılmaz) */
  unreachable?: boolean;
}

export interface LineServiceOptions {
  secret: string;
  dir: string | null;
  ports: number[];
  maxBps: number;
  now?: () => number;
  /** O an yayın var mı ve hangi kanallarda */
  streamInfo: () => { live: boolean; channels: string[] };
  serverTxMbps: () => number | null;
  log?: { warn(obj: object, msg: string): void; info(obj: object, msg: string): void };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RUNS_MAX = 400;
const FILE_MAX_LINES = 1_000;
const KEEP_MS = 30 * 86_400_000;
const START_WINDOW_MS = 120_000;

/** TCP oturumunun saniye başına bayt sayaçları; her yön oturum başına yalnızca bir kez açılabilir */
export interface TcpState {
  t0: number;
  up: number[];
  down: number[];
  upStarted: boolean;
  downStarted: boolean;
}

export type MintResult =
  | { ok: true; token: string; session: LineSession; plan: LinePlan; port: number | null; expiresAt: number }
  | { ok: false; error: OpenError | 'bad_profile' };

function tcpSeconds(bytes: readonly number[], plan: LinePlan): TcpSecond[] {
  return plan.seconds.map((p, i) => ({ bytes: bytes[i] ?? 0, target: Math.round((p.pps * p.size) ) }));
}

export class LineTestService {
  readonly tokens: LineTokens;
  readonly server: LineTestServer;
  private readonly codes = new Map<string, LineCode>();
  private runs: LineRun[] = [];
  /** TCP oturumlarının saniye başına bayt sayaçları (sid -> yön -> dizi) */
  private readonly tcp = new Map<number, TcpState>();
  private readonly now: () => number;

  constructor(private readonly opts: LineServiceOptions) {
    this.now = opts.now ?? Date.now;
    this.tokens = new LineTokens(opts.secret);
    this.server = new LineTestServer({
      tokens: this.tokens,
      ports: opts.ports,
      maxBps: opts.maxBps,
      now: this.now,
      ...(opts.log ? { log: opts.log } : {}),
      onAbandon: (s, f) => this.record(s, f, null, null, null, null, true),
    });
    this.load();
  }

  private get file(): string | null {
    return this.opts.dir ? path.join(this.opts.dir, 'line-tests.jsonl') : null;
  }

  private load(): void {
    const file = this.file;
    if (!file) return;
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const lines = text.split('\n').filter(Boolean);
    const since = this.now() - KEEP_MS;
    const loaded: LineRun[] = [];
    for (const line of lines) {
      try {
        const r = JSON.parse(line) as LineRun;
        if (typeof r.id === 'string' && typeof r.at === 'number' && r.at >= since && Array.isArray(r.steps)) loaded.push(r);
      } catch {
        // bozuk satır atlanır
      }
    }
    this.runs = loaded.slice(-RUNS_MAX);
    if (lines.length > FILE_MAX_LINES) {
      try {
        fs.writeFileSync(file, this.runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
      } catch {
        // sonraki açılışta
      }
    }
  }

  async start(): Promise<number | null> {
    const port = await this.server.start();
    if (port === null) this.opts.log?.warn({ ports: this.opts.ports }, 'hat testi UDP portu açılamadı; hat testi kapalı');
    else this.opts.log?.info({ port }, 'hat testi UDP ucu açık');
    return port;
  }

  stop(): void {
    this.server.stop();
  }

  streamLive(): boolean {
    return this.opts.streamInfo().live;
  }

  get port(): number | null {
    return this.server.port;
  }

  // ---------- Test kodları ----------

  createCode(label: string, hours: number, maxUses: number): LineCode {
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    const entry: LineCode = { code, label: label.slice(0, 40), expiresAt: this.now() + hours * 3_600_000, uses: 0, maxUses };
    this.codes.set(code, entry);
    for (const [k, c] of this.codes) if (c.expiresAt < this.now()) this.codes.delete(k);
    return entry;
  }

  /** Kodu tüketmeden doğrular (kullanım, oturum açılınca sayılır) */
  checkCode(code: string): LineCode | null {
    const c = this.codes.get(code.trim().toUpperCase());
    return c && c.expiresAt > this.now() && c.uses < c.maxUses ? c : null;
  }

  listCodes(): LineCode[] {
    return [...this.codes.values()].filter((c) => c.expiresAt > this.now());
  }

  // ---------- Oturum açma ----------

  mint(who: LineWho, code: LineCode | null, profile: LineProfile, mode: LineMode, transport: LineTransport, ip: string): MintResult {
    let plan: LinePlan;
    try {
      plan = buildPlan(profile, profile === 'quick' ? 'both' : mode);
    } catch {
      return { ok: false, error: 'bad_profile' };
    }
    const now = this.now();
    const sid = (randomBytes(4).readUInt32BE(0) % 0xfffffffe) + 1;
    const identity = who.kind === 'user' ? `u:${who.userId}` : `c:${code?.code}:${who.name.toLowerCase()}`;
    const expiresAt = now + START_WINDOW_MS + plan.durationMs + 30_000;
    const token: LineToken = { s: sid, i: identity, n: who.name, t: transport, p: profile, m: plan.mode, x: expiresAt };
    const session = this.server.open(token, plan, ip);
    if (typeof session === 'string') return { ok: false, error: session };
    session.expiresAt = now + START_WINDOW_MS;
    if (code) code.uses++;
    if (transport === 'tcp') this.tcp.set(sid, { t0: 0, up: [], down: [], upStarted: false, downStarted: false });
    return { ok: true, token: this.tokens.sign(token), session, plan, port: this.server.port, expiresAt };
  }

  /** Jetonla oturumu bulur (HTTP uçlarının kimlik doğrulaması) */
  sessionOf(tokenText: string | undefined): LineSession | null {
    const t = tokenText ? this.tokens.verify(tokenText, this.now()) : null;
    if (!t) return null;
    const s = this.server.get(t.s);
    return s && s.token.i === t.i ? s : null;
  }

  // ---------- TCP ölçümü ----------

  tcpState(sid: number): TcpState | undefined {
    const s = this.tcp.get(sid);
    if (s && s.t0 === 0) s.t0 = this.now();
    return s;
  }

  // ---------- Bitiş ve kayıt ----------

  finish(session: LineSession, clientDown: SecondStat[] | null, tcp: { up: number[] | null; down: number[] | null } | null, client: ClientContext | null, suite: string | null): LineRun | null {
    const f = this.server.finish(session.sid);
    if (!f) return null;
    return this.record(session, f, clientDown, tcp, client, suite, false);
  }

  private record(
    s: LineSession,
    f: LineFinish,
    clientDown: SecondStat[] | null,
    tcp: { up: number[] | null; down: number[] | null } | null,
    client: ClientContext | null,
    suite: string | null,
    partial: boolean,
  ): LineRun | null {
    const transport = s.token.t;
    const tcpState = this.tcp.get(s.sid);
    this.tcp.delete(s.sid);
    const info = this.opts.streamInfo();
    const startedAt = f.startedAt ?? tcpState?.t0 ?? this.now() - s.plan.durationMs;
    // UDP el sıkışması hiç tamamlanmadıysa (port/güvenlik duvarı): "ulaşılamadı" olarak kaydedilir
    const unreachable = transport === 'udp' && f.startedAt === null;
    const live = info.live;
    const run: LineRun = {
      id: nanoid(10),
      suite: suite ?? `s${s.sid.toString(36)}`,
      at: startedAt,
      end: this.now(),
      who: { kind: s.token.i.startsWith('u:') ? 'user' : 'code', userId: s.token.i.startsWith('u:') ? s.token.i.slice(2) : null, name: s.token.n },
      ip: s.ip,
      transport,
      profile: s.plan.profile,
      mode: s.plan.mode,
      steps: s.plan.steps,
      streaming: { start: live, end: live, channels: info.channels },
      serverTxMbps: this.opts.serverTxMbps(),
      up: transport === 'udp' ? f.up : null,
      down: transport === 'udp' ? clientDown : null,
      downSent: transport === 'udp' ? f.downSent : null,
      downErrors: transport === 'udp' ? f.downErrors : null,
      tcpUp: transport === 'tcp' && tcpState ? tcpSeconds(tcpState.up, s.plan) : null,
      tcpDown: transport === 'tcp' && tcp?.down ? tcpSeconds(tcp.down, s.plan) : null,
      client,
      partial,
      ...(unreachable ? { unreachable: true } : {}),
    };
    // TCP'de yukarı yönü sunucu, aşağı yönü istemci ölçer
    if (transport === 'tcp' && run.tcpUp && s.plan.mode === 'down') run.tcpUp = null;
    this.runs.push(run);
    if (this.runs.length > RUNS_MAX) this.runs.splice(0, this.runs.length - RUNS_MAX);
    const file = this.file;
    if (file) {
      fs.promises.appendFile(file, JSON.stringify(run) + '\n').catch((err: unknown) => this.opts.log?.warn({ err: String(err) }, 'hat testi kaydı yazılamadı'));
    }
    return run;
  }

  /** Yayın durumunu bitişte yeniden okuyup ilk okumayla birleştirir */
  markStreamingEnd(run: LineRun): void {
    const info = this.opts.streamInfo();
    run.streaming.end = info.live;
    run.streaming.channels = [...new Set([...run.streaming.channels, ...info.channels])];
  }

  list(since: number): LineRun[] {
    return this.runs.filter((r) => r.at >= since);
  }

  runsOfSuite(suite: string): LineRun[] {
    return this.runs.filter((r) => r.suite === suite);
  }
}

// ---------- Aşamaları test (suite) olarak toplama ----------

export interface LineSuite {
  id: string;
  who: LineWho;
  ip: string | null;
  at: number;
  end: number;
  streaming: boolean;
  runs: LineRun[];
  findings: Finding[];
  /** Çakışan donma olaylarının kimlikleri */
  freezeIds: string[];
}

export const toVerdictRun = (r: LineRun): VerdictRun => ({
  transport: r.transport,
  mode: r.mode,
  profile: r.profile,
  steps: r.steps,
  up: r.up,
  down: r.down,
  downSent: r.downSent,
  tcpUp: r.tcpUp,
  tcpDown: r.tcpDown,
  streaming: r.streaming.start || r.streaming.end,
  ...(r.unreachable ? { unreachable: true } : {}),
});

export function groupSuites(runs: LineRun[], freezes: { id: string; start: number; end: number }[] = []): LineSuite[] {
  const map = new Map<string, LineRun[]>();
  for (const r of runs) {
    const key = `${r.who.kind}:${r.who.userId ?? r.who.name}:${r.suite}`;
    (map.get(key) ?? map.set(key, []).get(key)!).push(r);
  }
  const out: LineSuite[] = [];
  for (const list of map.values()) {
    list.sort((a, b) => a.at - b.at);
    const first = list[0]!;
    const at = first.at;
    const end = Math.max(...list.map((r) => r.end));
    out.push({
      id: first.suite,
      who: first.who,
      ip: first.ip,
      at,
      end,
      streaming: list.some((r) => r.streaming.start || r.streaming.end),
      runs: list,
      findings: classify(list.map(toVerdictRun)),
      // Donma olayı, testin ±60 sn çevresiyle kesişiyorsa
      freezeIds: freezes.filter((e) => e.start - 60_000 <= end && e.end + 60_000 >= at).map((e) => e.id),
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

export interface SyncGroup {
  at: number;
  suiteIds: string[];
  lossy: number;
  total: number;
  text: string;
}

const isLossy = (s: LineSuite): boolean => s.findings.some((f) => f.tone === 'bad' || f.tone === 'warn');

/** Aynı dakika içinde (ilk testten 60 sn içinde) başlayan farklı kişilerin testleri yan yana */
export function syncGroups(suites: LineSuite[]): SyncGroup[] {
  const sorted = [...suites].sort((a, b) => a.at - b.at);
  const groups: SyncGroup[] = [];
  let cur: LineSuite[] = [];
  const flush = (): void => {
    const people = new Set(cur.map((s) => `${s.who.kind}:${s.who.userId ?? s.who.name}`));
    if (people.size >= 2) {
      const lossy = cur.filter(isLossy).length;
      const text =
        lossy === 0
          ? 'Hepsi temiz: bu dakikada hatta kayıp yok.'
          : lossy === cur.length
            ? `Hepsinde aynı anda kayıp (${lossy}/${cur.length}) → ortak yol (sunucu/sağlayıcı ağı) şüphesi; farklı servis sağlayıcılarda da görünüyorsa kullanıcı hattı değil.`
            : `${lossy}/${cur.length} kişide kayıp → kayıp ortak değil; kayıplı kullanıcıların kendi hattı/istemcisi şüpheli.`;
      groups.push({ at: cur[0]!.at, suiteIds: cur.map((s) => s.id), lossy, total: cur.length, text });
    }
    cur = [];
  };
  for (const s of sorted) {
    if (cur.length > 0 && s.at - cur[0]!.at > 60_000) flush();
    cur.push(s);
  }
  flush();
  return groups.reverse();
}
