import { createHmac, timingSafeEqual } from 'node:crypto';
import { secondOfSeqTable, type LineMode, type LinePlan, type LineProfile, type LineTransport, type PlanSecond } from './plan.js';

// Hat testi UDP protokolü (sürüm 1). Hepsi big-endian. Araç (tools/udp-probe/probe.mjs) aynı biçimi kullanır;
// uyumluluk test/lineTest.test.ts içinde iki gerçekleştirmeyi birbirine bağlayarak denenir.
//
//   Başlık (8 bayt):  magic 'DK' (2) | sürüm (1) | tür (1) | oturum kimliği sid (4)
//   HELLO  (1): başlık + jeton (ascii). Sunucu geçerliyse CHALLENGE ile yanıtlar (yanıt HELLO'dan her zaman küçük).
//   CHALLENGE (2): başlık + çerez (8 bayt, HMAC(adres, sid, zaman dilimi))
//   START  (3): başlık + çerez (8) + jeton. Çerez, istemcinin kaynak adresine gerçekten ulaştığını kanıtlar;
//               yalnızca bundan sonra oturum açılır ve sunucu veri gönderebilir.
//   READY  (4): başlık + sunucu saati (f64 ms). Tekrarlanan START'a da aynısı döner.
//   UP (5) / DOWN (6) veri: başlık + seq u32 + adım u8 + bayrak u8 + ts u32 (gönderenin ms'si) + ayrılmış u16, kalan sıfır dolgu.

export const MAGIC = 0x444b;
export const VERSION = 1;
export const T_HELLO = 1;
export const T_CHALLENGE = 2;
export const T_START = 3;
export const T_READY = 4;
export const T_UP = 5;
export const T_DOWN = 6;
export const HEADER = 8;
export const DATA_HEADER = 20;
export const COOKIE_LEN = 8;
/** Çerez bu süre dilimleriyle üretilir; bir önceki dilim de kabul edilir (en çok ~2× süre geçerli) */
export const COOKIE_WINDOW_MS = 15_000;

export interface Header {
  type: number;
  sid: number;
}

export function parseHeader(buf: Buffer): Header | null {
  if (buf.length < HEADER || buf.readUInt16BE(0) !== MAGIC || buf.readUInt8(2) !== VERSION) return null;
  return { type: buf.readUInt8(3), sid: buf.readUInt32BE(4) };
}

export function writeHeader(buf: Buffer, type: number, sid: number): void {
  buf.writeUInt16BE(MAGIC, 0);
  buf.writeUInt8(VERSION, 2);
  buf.writeUInt8(type, 3);
  buf.writeUInt32BE(sid >>> 0, 4);
}

export function encodeHello(sid: number, token: string): Buffer {
  const body = Buffer.from(token, 'ascii');
  const buf = Buffer.alloc(HEADER + body.length);
  writeHeader(buf, T_HELLO, sid);
  body.copy(buf, HEADER);
  return buf;
}

export function encodeStart(sid: number, cookie: Buffer, token: string): Buffer {
  const body = Buffer.from(token, 'ascii');
  const buf = Buffer.alloc(HEADER + COOKIE_LEN + body.length);
  writeHeader(buf, T_START, sid);
  cookie.copy(buf, HEADER);
  body.copy(buf, HEADER + COOKIE_LEN);
  return buf;
}

export interface DataPacket {
  seq: number;
  step: number;
  ts: number;
}

export function encodeData(type: typeof T_UP | typeof T_DOWN, sid: number, size: number, d: DataPacket): Buffer {
  const buf = Buffer.alloc(Math.max(DATA_HEADER, size));
  writeHeader(buf, type, sid);
  buf.writeUInt32BE(d.seq >>> 0, 8);
  buf.writeUInt8(d.step & 0xff, 12);
  buf.writeUInt32BE(d.ts >>> 0, 14);
  return buf;
}

export function parseData(buf: Buffer): DataPacket | null {
  if (buf.length < DATA_HEADER) return null;
  return { seq: buf.readUInt32BE(8), step: buf.readUInt8(12), ts: buf.readUInt32BE(14) };
}

// ---------- Jeton ve çerez ----------

/** Jetonun taşıdığı (imzayla değiştirilemeyen) oturum bilgisi */
export interface LineToken {
  /** oturum kimliği */
  s: number;
  /** kimlik anahtarı (bir kimlik aynı anda tek test) ve görünen ad */
  i: string;
  n: string;
  /** aktarım, profil, yön */
  t: LineTransport;
  p: LineProfile;
  m: LineMode;
  /** bitiş (ms): oturum açılması için son an */
  x: number;
}

const b64u = (b: Buffer): string => b.toString('base64url');

export class LineTokens {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHmac('sha256', 'diskort-line-test-v1').update(secret).digest();
  }

  private mac(data: string | Buffer, len = 16): Buffer {
    return createHmac('sha256', this.key).update(data).digest().subarray(0, len);
  }

  sign(token: LineToken): string {
    const body = b64u(Buffer.from(JSON.stringify(token)));
    return `${body}.${b64u(this.mac(body))}`;
  }

  /** Geçerli ve süresi dolmamış jeton ya da null */
  verify(text: string, now = Date.now()): LineToken | null {
    if (text.length > 600) return null;
    const dot = text.indexOf('.');
    if (dot < 1) return null;
    const body = text.slice(0, dot);
    const sig = Buffer.from(text.slice(dot + 1), 'base64url');
    const want = this.mac(body);
    if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
    try {
      const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LineToken;
      if (typeof t.s !== 'number' || typeof t.x !== 'number' || typeof t.i !== 'string' || t.x < now) return null;
      return t;
    } catch {
      return null;
    }
  }

  /** Kaynak adresine bağlı çerez (adres + sid + zaman dilimi) */
  cookie(ip: string, port: number, sid: number, now = Date.now(), shift = 0): Buffer {
    const window = Math.floor(now / COOKIE_WINDOW_MS) - shift;
    return this.mac(`c|${ip}|${port}|${sid}|${window}`, COOKIE_LEN);
  }

  cookieOk(cookie: Buffer, ip: string, port: number, sid: number, now = Date.now()): boolean {
    if (cookie.length !== COOKIE_LEN) return false;
    return [0, 1].some((shift) => timingSafeEqual(cookie, this.cookie(ip, port, sid, now, shift)));
  }
}

// ---------- Alıcı tarafı sayım ----------

export interface SecondStat {
  /** planlanan ve gelen paket, kayıp (planlanan - gelen), sırasız gelen, yinelenen, bayt, sapma (ms) */
  planned: number;
  recv: number;
  lost: number;
  reord: number;
  dup: number;
  bytes: number;
  jit: number;
}

/**
 * Bir yönün alıcısı: planı bildiği için kaybı saniye saniye hesaplar (sıra numarası -> plan saniyesi).
 * Sapma RFC 3550 biçiminde (varış - gönderim farklarının farkı); saat kayması sonucu etkilemez.
 */
export class LossCounter {
  private readonly secOf: Uint16Array;
  private readonly seen: Uint8Array;
  readonly seconds: SecondStat[];
  private maxSeq = -1;
  private transit: number | null = null;
  private jitter = 0;
  lastAt = 0;

  constructor(plan: readonly PlanSecond[]) {
    this.secOf = secondOfSeqTable(plan);
    this.seen = new Uint8Array(this.secOf.length);
    this.seconds = plan.map((p) => ({ planned: p.pps, recv: 0, lost: 0, reord: 0, dup: 0, bytes: 0, jit: 0 }));
  }

  /** Bir paket geldi: arrivalMs alıcının ms saati, ts gönderenin ms saati */
  onPacket(seq: number, size: number, ts: number, arrivalMs: number): void {
    const sec = this.secOf[seq];
    if (sec === undefined) return; // plan dışı sıra numarası
    const s = this.seconds[sec]!;
    this.lastAt = arrivalMs;
    if (this.seen[seq]) {
      s.dup++;
      return;
    }
    this.seen[seq] = 1;
    s.recv++;
    s.bytes += size;
    if (seq < this.maxSeq) s.reord++;
    else this.maxSeq = seq;
    const transit = arrivalMs - ts;
    if (this.transit !== null) this.jitter += (Math.abs(transit - this.transit) - this.jitter) / 16;
    this.transit = transit;
    s.jit = Math.max(s.jit, this.jitter);
  }

  /** Kayıpları kapatır (planlanan - gelen) ve saniye dizisini döner */
  finish(): SecondStat[] {
    for (const s of this.seconds) s.lost = Math.max(0, s.planned - s.recv);
    return this.seconds.map((s) => ({ ...s, jit: Math.round(s.jit * 100) / 100 }));
  }
}

export type { LinePlan };
