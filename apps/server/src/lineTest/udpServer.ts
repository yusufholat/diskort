import dgram from 'node:dgram';
import {
  COOKIE_LEN,
  DATA_HEADER,
  HEADER,
  LossCounter,
  T_CHALLENGE,
  T_DOWN,
  T_HELLO,
  T_READY,
  T_START,
  T_UP,
  encodeData,
  parseData,
  parseHeader,
  writeHeader,
  type LineToken,
  type LineTokens,
  type SecondStat,
} from './protocol.js';
import { cumulative, dueCount, reservedBps, secondOfSeqTable, type LinePlan } from './plan.js';

/** HELLO/START bundan kısa olamaz (jeton zaten daha uzun): yanıtlar isteğin her zaman altında kalır */
export const MIN_HANDSHAKE_BYTES = 64;
const MAX_DATAGRAM = 1400;
/** Oturum açıldıktan sonra istemcinin rapor göndermesi için plan süresine eklenen tolerans */
const FINISH_GRACE_MS = 20_000;
const PACE_TICK_MS = 2;
const MAX_BURST_PER_TICK = 400;
/** Gönderim zamanlayıcısı bu kadar gecikirse (ms) olay döngüsü takılması sayılır */
const LAG_STALL_MS = 20;
/** Bir kaynak adresten 10 saniyelik pencerede kabul edilen el sıkışma paketi (HELLO/START); fazlası sessizce düşer */
const HANDSHAKE_PER_IP = 12;
const HANDSHAKE_WINDOW_MS = 10_000;
const HANDSHAKE_MAP_MAX = 4_000;

export type OpenError = 'busy_user' | 'busy_ip' | 'capacity' | 'disabled';

export interface LineSession {
  sid: number;
  token: LineToken;
  plan: LinePlan;
  ip: string;
  /** Doğrulanmış UDP adresi (START'tan sonra) */
  addr: { ip: string; port: number } | null;
  startedAt: number | null;
  reserved: number;
  /** yukarı yön (istemci -> sunucu) sayacı */
  up: LossCounter | null;
  /** aşağı yön: plan saniyesi başına gönderilen ve gönderilemeyen paket */
  downSent: Int32Array | null;
  downErrors: Int32Array | null;
  downSentTotal: number;
  downT0: number;
  cum: number[];
  secOf: Uint16Array;
  endsAt: number;
  expiresAt: number;
  /** TCP: akış bitene kadar ayrılan bant/pps geri bırakılmaz (finish erken gelse de) */
  holdUntil: number;
  closed: boolean;
  reservedPps: number;
  /** Test sürerken API olay döngüsünün gecikmesi: en yüksek (ms) ve 20 ms'yi aşan tur sayısı */
  lagMaxMs: number;
  lagStalls: number;
}

export interface LineFinish {
  addr: { ip: string; port: number } | null;
  up: SecondStat[] | null;
  downSent: number[] | null;
  downErrors: number[] | null;
  startedAt: number | null;
  loopLag: { maxMs: number; stalls: number };
}

export interface LineServerOptions {
  tokens: LineTokens;
  /** Denenecek UDP portları (sırayla ilk bağlanabilen); [0] rastgele boş port */
  ports: number[];
  /** Aynı anda ayrılabilecek toplam bant genişliği (bit/sn) */
  maxBps: number;
  perIpSessions?: number;
  /** Aynı anda ayrılabilecek toplam paket/sn (tepe pps x yön sayısı); varsayılan 12000 */
  maxPps?: number;
  /** Oturum bırakılınca (finish, süre dolumu) */
  onRelease?: (sid: number) => void;
  now?: () => number;
  log?: { warn(obj: object, msg: string): void; info(obj: object, msg: string): void };
  /** İstemci rapor göndermeden süresi dolan oturum (yalnızca sunucu tarafı ölçümüyle) */
  onAbandon?: (session: LineSession, finish: LineFinish) => void;
}

export class LineTestServer {
  private socket: dgram.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private readonly sessions = new Map<number, LineSession>();
  private readonly byIdentity = new Map<string, number>();
  private readonly handshakes = new Map<string, { at: number; n: number }>();
  private lastPaceAt = 0;
  port: number | null = null;
  reservedTotal = 0;
  reservedPpsTotal = 0;
  readonly stats = { rx: 0, tx: 0, dropped: 0, rateLimited: 0, sendErrors: 0, handshakes: 0, started: 0 };
  private readonly now: () => number;

  constructor(private readonly opts: LineServerOptions) {
    this.now = opts.now ?? Date.now;
  }

  get active(): number {
    return this.sessions.size;
  }

  /** İlk bağlanabilen porta bağlanır; hiçbiri olmazsa null (özellik kapalı kalır) */
  async start(): Promise<number | null> {
    for (const port of this.opts.ports) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: false });
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once('error', reject);
          socket.bind(port, '0.0.0.0', () => {
            socket.off('error', reject);
            resolve();
          });
        });
      } catch {
        socket.close();
        continue;
      }
      socket.on('error', (err) => this.opts.log?.warn({ err: err.message }, 'hat testi UDP soketi hatası'));
      socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo.address, rinfo.port));
      this.socket = socket;
      this.port = socket.address().port;
      // Gönderim zamanlayıcısı (2 ms) yalnızca oturum varken çalışır (bkz. open/release)
      this.sweepTimer = setInterval(() => this.sweep(), 1000);
      this.sweepTimer.unref();
      return this.port;
    }
    return null;
  }

  stop(): void {
    this.stopPace();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    try {
      this.socket?.close();
    } catch {
      // zaten kapalı
    }
    this.socket = null;
    this.port = null;
    this.sessions.clear();
    this.byIdentity.clear();
    this.reservedTotal = 0;
    this.reservedPpsTotal = 0;
  }

  private startPace(): void {
    if (this.timer || !this.socket) return;
    this.lastPaceAt = 0;
    this.timer = setInterval(() => this.pace(), PACE_TICK_MS);
    this.timer.unref();
  }

  private stopPace(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Gönderim zamanlayıcısı çalışıyor mu (testler) */
  get pacing(): boolean {
    return this.timer !== null;
  }

  /**
   * HTTP'de oturum açılırken: kimlik/adres başına tek test ve toplam bant sınırı burada uygulanır. `maxBps`
   * verilirse (yönetici oturumu) toplam sınır olarak o kullanılır.
   */
  open(token: LineToken, plan: LinePlan, ip: string, maxBps = this.opts.maxBps): LineSession | OpenError {
    if (!this.socket) return 'disabled';
    this.sweep();
    if (this.byIdentity.has(token.i)) return 'busy_user';
    let perIp = 0;
    for (const s of this.sessions.values()) if (s.ip === ip) perIp++;
    if (perIp >= (this.opts.perIpSessions ?? 2)) return 'busy_ip';
    const reserved = reservedBps(plan);
    if (this.reservedTotal + reserved > maxBps) return 'capacity';
    const reservedPps = Math.max(0, ...plan.seconds.map((x) => x.pps)) * (plan.mode === 'both' ? 2 : 1);
    if (this.reservedPpsTotal + reservedPps > (this.opts.maxPps ?? 12_000)) return 'capacity';
    const session: LineSession = {
      sid: token.s,
      token,
      plan,
      ip,
      addr: null,
      startedAt: null,
      reserved,
      up: plan.mode === 'down' ? null : new LossCounter(plan.seconds),
      downSent: plan.mode === 'up' ? null : new Int32Array(plan.seconds.length),
      downErrors: plan.mode === 'up' ? null : new Int32Array(plan.seconds.length),
      downSentTotal: 0,
      downT0: 0,
      cum: cumulative(plan.seconds),
      secOf: secondOfSeqTable(plan.seconds),
      endsAt: 0,
      expiresAt: token.x,
      holdUntil: 0,
      closed: false,
      reservedPps,
      lagMaxMs: 0,
      lagStalls: 0,
    };
    if (this.sessions.has(session.sid)) return 'busy_user';
    this.sessions.set(session.sid, session);
    this.byIdentity.set(token.i, session.sid);
    this.reservedTotal += reserved;
    this.reservedPpsTotal += reservedPps;
    this.startPace();
    return session;
  }

  /** HTTP'deki bitiş çağrısı: sonuçları verir ve ayrılan bant genişliğini geri bırakır */
  finish(sid: number): LineFinish | null {
    const s = this.sessions.get(sid);
    if (!s || s.closed) return null;
    const out = this.collect(s);
    // TCP akışı hâlâ sürüyor olabilir: bant süre dolana kadar tutulur (sweep bırakır); oturum kapalı sayılır
    if (s.holdUntil > this.now()) s.closed = true;
    else this.release(s);
    return out;
  }

  /** Açık (kapatılmamış) oturum */
  get(sid: number): LineSession | undefined {
    const s = this.sessions.get(sid);
    return s && !s.closed ? s : undefined;
  }

  private collect(s: LineSession): LineFinish {
    return {
      addr: s.addr,
      up: s.up ? s.up.finish() : null,
      downSent: s.downSent ? [...s.downSent] : null,
      downErrors: s.downErrors ? [...s.downErrors] : null,
      startedAt: s.startedAt,
      loopLag: { maxMs: Math.round(s.lagMaxMs * 10) / 10, stalls: s.lagStalls },
    };
  }

  private release(s: LineSession): void {
    if (this.sessions.delete(s.sid)) {
      this.reservedTotal = Math.max(0, this.reservedTotal - s.reserved);
      this.reservedPpsTotal = Math.max(0, this.reservedPpsTotal - s.reservedPps);
      this.opts.onRelease?.(s.sid);
      if (this.byIdentity.get(s.token.i) === s.sid) this.byIdentity.delete(s.token.i);
      if (this.sessions.size === 0) this.stopPace();
    }
  }

  private sweep(): void {
    const now = this.now();
    for (const s of [...this.sessions.values()]) {
      if (s.closed) {
        if (now >= s.holdUntil) this.release(s);
        continue;
      }
      const limit = s.startedAt === null ? s.expiresAt : s.endsAt + FINISH_GRACE_MS;
      if (now < limit) continue;
      // Yalnızca gerçekten başlamış testler kaydedilir; hiç başlamayanlar sessizce kapanır
      if (s.startedAt !== null) this.opts.onAbandon?.(s, this.collect(s));
      this.release(s);
    }
    if (this.handshakes.size > 0) {
      for (const [ip, h] of this.handshakes) if (now - h.at > HANDSHAKE_WINDOW_MS) this.handshakes.delete(ip);
    }
  }

  private allowHandshake(ip: string): boolean {
    const now = this.now();
    const h = this.handshakes.get(ip);
    if (!h || now - h.at > HANDSHAKE_WINDOW_MS) {
      // Harita doluysa en eski girdi çıkar (sahte adres seliyle gerçek kullanıcılar dışarıda kalmasın)
      if (this.handshakes.size >= HANDSHAKE_MAP_MAX) {
        const oldest = this.handshakes.keys().next().value;
        if (oldest !== undefined) this.handshakes.delete(oldest);
      }
      this.handshakes.set(ip, { at: now, n: 1 });
      return true;
    }
    h.n++;
    return h.n <= HANDSHAKE_PER_IP;
  }

  /** Yanıt isteğin boyunu hiçbir zaman aşmaz (yansıtma/çoğaltma saldırısına karşı tek kapı) */
  private reply(buf: Buffer, requestLen: number, ip: string, port: number): void {
    if (!this.socket || buf.length > requestLen) return;
    try {
      this.socket.send(buf, port, ip, (err) => {
        if (err) this.stats.sendErrors++;
      });
      this.stats.tx++;
    } catch {
      // geçersiz hedef (ör. port 0) senkron fırlatabilir; süreç çökmemeli
      this.stats.sendErrors++;
    }
  }

  private onMessage(msg: Buffer, ip: string, port: number): void {
    try {
      this.handle(msg, ip, port);
    } catch (err) {
      this.stats.dropped++;
      this.opts.log?.warn({ err: String(err) }, 'hat testi paketi işlenemedi');
    }
  }

  private handle(msg: Buffer, ip: string, port: number): void {
    this.stats.rx++;
    // Kaynak port 0 / ayrıcalıklı port: yanıtlanamaz ya da sahte adres işareti; hiç işlenmez
    if (port < 1024) return void this.stats.dropped++;
    if (msg.length > MAX_DATAGRAM) return void this.stats.dropped++;
    const head = parseHeader(msg);
    if (!head) return void this.stats.dropped++;
    if (head.type === T_UP) return this.onUp(msg, head.sid, ip, port);
    if (head.type === T_HELLO || head.type === T_START) {
      if (msg.length < MIN_HANDSHAKE_BYTES) return void this.stats.dropped++;
      if (!this.allowHandshake(ip)) return void this.stats.rateLimited++;
      this.stats.handshakes++;
      const cookieLen = head.type === T_START ? COOKIE_LEN : 0;
      const token = this.opts.tokens.verify(msg.subarray(HEADER + cookieLen).toString('ascii'), this.now());
      // Geçersiz jeton: hiçbir yanıt yok
      if (!token || token.s !== head.sid || token.t !== 'udp') return void this.stats.dropped++;
      const session = this.sessions.get(head.sid);
      if (!session || session.token.i !== token.i) return void this.stats.dropped++;
      if (head.type === T_HELLO) {
        const out = Buffer.alloc(HEADER + COOKIE_LEN);
        writeHeader(out, T_CHALLENGE, head.sid);
        this.opts.tokens.cookie(ip, port, head.sid, this.now()).copy(out, HEADER);
        return this.reply(out, msg.length, ip, port);
      }
      const cookie = msg.subarray(HEADER, HEADER + COOKIE_LEN);
      if (!this.opts.tokens.cookieOk(cookie, ip, port, head.sid, this.now())) return void this.stats.dropped++;
      this.onStart(session, ip, port, msg.length);
    }
  }

  private onStart(s: LineSession, ip: string, port: number, reqLen: number): void {
    const now = this.now();
    if (s.addr && (s.addr.ip !== ip || s.addr.port !== port)) return void this.stats.dropped++;
    if (!s.addr) {
      s.addr = { ip, port };
      s.startedAt = now;
      s.downT0 = now + 100;
      s.endsAt = now + s.plan.durationMs + 1000;
      this.stats.started++;
    }
    const out = Buffer.alloc(HEADER + 8);
    writeHeader(out, T_READY, s.sid);
    out.writeDoubleBE(now, HEADER);
    this.reply(out, reqLen, ip, port);
  }

  private onUp(msg: Buffer, sid: number, ip: string, port: number): void {
    const s = this.sessions.get(sid);
    if (!s || !s.up || !s.addr || s.addr.ip !== ip || s.addr.port !== port) return void this.stats.dropped++;
    const d = parseData(msg);
    if (!d) return void this.stats.dropped++;
    const now = this.now();
    // Plan süresinin çok ötesinde gelen paket sayılmaz (tolerans: 3 sn)
    if (s.startedAt === null || now > s.endsAt + 3000) return void this.stats.dropped++;
    s.up.onPacket(d.seq, msg.length, d.ts, now);
  }

  /** Aşağı yön: planlanan hızda, doğrulanmış adrese (yalnızca oturum sahibine) gönderir */
  private pace(): void {
    if (!this.socket || this.sessions.size === 0) return;
    const now = this.now();
    // Olay döngüsü gecikmesi: iki tur arasındaki süre, beklenen aralığı ne kadar aştı (gerçek saatle)
    const tick = performance.now();
    const lag = this.lastPaceAt === 0 ? 0 : Math.max(0, tick - this.lastPaceAt - PACE_TICK_MS);
    this.lastPaceAt = tick;
    for (const s of this.sessions.values()) {
      if (s.startedAt !== null && !s.closed && now <= s.endsAt) {
        if (lag > s.lagMaxMs) s.lagMaxMs = lag;
        if (lag >= LAG_STALL_MS) s.lagStalls++;
      }
      if (!s.downSent || !s.addr || s.startedAt === null || now < s.downT0) continue;
      const t = now - s.downT0;
      const due = dueCount(s.plan.seconds, s.cum, t);
      let n = Math.min(due - s.downSentTotal, MAX_BURST_PER_TICK);
      while (n-- > 0) {
        const seq = s.downSentTotal++;
        const sec = s.secOf[seq];
        if (sec === undefined) break;
        const p = s.plan.seconds[sec]!;
        const buf = encodeData(T_DOWN, s.sid, p.size, { seq, step: p.step, ts: t });
        s.downSent[sec] = (s.downSent[sec] ?? 0) + 1;
        try {
          this.socket.send(buf, s.addr.port, s.addr.ip, (err) => {
            if (err) {
              this.stats.sendErrors++;
              s.downErrors![sec] = (s.downErrors![sec] ?? 0) + 1;
            }
          });
          this.stats.tx++;
        } catch {
          this.stats.sendErrors++;
          s.downErrors![sec] = (s.downErrors![sec] ?? 0) + 1;
        }
      }
    }
  }
}

export { DATA_HEADER };
