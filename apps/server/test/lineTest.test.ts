import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  HEADER,
  LineTokens,
  LossCounter,
  T_CHALLENGE,
  T_DOWN,
  T_READY,
  T_UP,
  encodeData,
  encodeHello,
  encodeStart,
  parseData,
  parseHeader,
  type LineToken,
  type SecondStat,
} from '../src/lineTest/protocol.js';
import {
  MAX_BOTH_RATE_BPS,
  MAX_PPS,
  MAX_RATE_BPS,
  buildPlan,
  cumulative,
  dueCount,
  reservedBps,
  type LineMode,
  type LineProfile,
} from '../src/lineTest/plan.js';
import { LineTestServer } from '../src/lineTest/udpServer.js';
import { groupSuites, syncGroups, type LineRun } from '../src/lineTest/service.js';
import { classify, stepStats, thresholdIndex, type StepStat, type TcpSecond, type VerdictRun } from '../src/lineTest/verdict.js';
import { loadConfig } from '../src/config.js';
import { auth, startServer, type TestServer } from './helpers.js';

// Hat testi: protokol, sayım, jeton, sınırlar, yansıtma koruması, yorum sınıflandırıcısı ve araçla uçtan uca deneme.

const SECRET = 'test-secret-0123456789abcdef';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface ProbeModule {
  encodeHello(sid: number, token: string): Buffer;
  encodeStart(sid: number, cookie: Buffer, token: string): Buffer;
  encodeData(type: number, sid: number, size: number, seq: number, step: number, ts: number): Buffer;
  cumulative(s: unknown[]): number[];
  dueCount(s: unknown[], cum: number[], t: number): number;
  LossCounter: new (plan: unknown[]) => { onPacket(seq: number, size: number, ts: number, at: number): void; finish(): SecondStat[] };
  runSuite(opts: Record<string, unknown>): Promise<{ suite: string; phases: { result?: Record<string, unknown>; error?: string }[] }>;
}
const probePath = path.resolve(import.meta.dirname, '../../../tools/udp-probe/probe.mjs');
const loadProbe = async (): Promise<ProbeModule> => (await import(/* @vite-ignore */ pathToFileURL(probePath).href)) as ProbeModule;

const tokenOf = (over: Partial<LineToken> = {}): LineToken => ({
  s: 4242,
  i: 'u:alice',
  n: 'Alice',
  t: 'udp',
  p: 'ramp',
  m: 'down',
  x: Date.now() + 60_000,
  ...over,
});

describe('plan', () => {
  it('profillerin süresi, en yüksek hızı ve üst sınırları', () => {
    const ramp = buildPlan('ramp', 'up');
    expect(ramp.steps.map((s) => Math.round(s.rateBps / 1e5) / 10)).toEqual([0.5, 1, 2, 4, 6, 8, 10, 12]);
    expect(ramp.durationMs).toBe(32_000);
    expect(ramp.peakBps).toBeLessThanOrEqual(MAX_RATE_BPS);
    const both = buildPlan('ramp', 'both');
    expect(both.peakBps).toBeLessThanOrEqual(MAX_BOTH_RATE_BPS);
    expect(reservedBps(both)).toBe(both.peakBps * 2);
    const pps = buildPlan('pps', 'both');
    expect(pps.steps.every((s) => s.size === 200 && s.pps <= MAX_PPS)).toBe(true);
    const steady = buildPlan('steady', 'down');
    expect(steady.durationMs).toBe(30_000);
    expect(steady.steps[0]!.fps).toBe(30);
    expect(buildPlan('quick', 'up').mode).toBe('up');
    for (const p of ['ramp', 'pps', 'steady', 'quick'] as LineProfile[]) expect(buildPlan(p, 'both').durationMs).toBeLessThanOrEqual(60_000);
  });

  it('dueCount artar, plan sonunda toplama ulaşır ve kare patlamalarını gruplar', () => {
    const plan = buildPlan('steady', 'down');
    const cum = cumulative(plan.seconds);
    let prev = 0;
    for (let t = 0; t <= plan.durationMs + 1000; t += 7) {
      const d = dueCount(plan.seconds, cum, t);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    expect(prev).toBe(plan.totalPackets);
    // 30 fps: ilk 33 ms içinde yalnızca ilk kare (~28 paket) çıkar
    expect(dueCount(plan.seconds, cum, 0)).toBe(Math.ceil(plan.seconds[0]!.pps / 30));
    expect(dueCount(plan.seconds, cum, 20)).toBe(Math.ceil(plan.seconds[0]!.pps / 30));
  });

  it('araç ve sunucu planı/kodu aynı hesaplar', async () => {
    const probe = await loadProbe();
    for (const p of ['ramp', 'pps', 'steady', 'quick'] as LineProfile[]) {
      const plan = buildPlan(p, 'both');
      const cum = cumulative(plan.seconds);
      expect(probe.cumulative(plan.seconds)).toEqual(cum);
      for (let t = 0; t < plan.durationMs; t += 113) expect(probe.dueCount(plan.seconds, cum, t)).toBe(dueCount(plan.seconds, cum, t));
    }
    const token = new LineTokens(SECRET).sign(tokenOf());
    expect(probe.encodeHello(7, token)).toEqual(encodeHello(7, token));
    const cookie = Buffer.from('01234567');
    expect(probe.encodeStart(7, cookie, token)).toEqual(encodeStart(7, cookie, token));
    const d = probe.encodeData(T_UP, 7, 1200, 99, 3, 12345);
    expect(d).toEqual(encodeData(T_UP, 7, 1200, { seq: 99, step: 3, ts: 12345 }));
    expect(parseData(d)).toEqual({ seq: 99, step: 3, ts: 12345 });
    expect(parseHeader(d)).toEqual({ type: T_UP, sid: 7 });
  });
});

describe('protokol ve sayım', () => {
  it('başlık ve veri paketi çözümlemesi; bozuk paket reddedilir', () => {
    expect(parseHeader(Buffer.from('nope'))).toBeNull();
    const bad = encodeData(T_UP, 1, 100, { seq: 1, step: 0, ts: 0 });
    bad.writeUInt8(9, 2);
    expect(parseHeader(bad)).toBeNull();
    expect(parseData(Buffer.alloc(10))).toBeNull();
  });

  it('kayıp, sırasız gelme, yineleme ve sapma saniye saniye sayılır', () => {
    const plan = buildPlan('quick', 'down').seconds; // 2 sn'lik adımlar
    const c = new LossCounter(plan);
    const first = plan[0]!.pps;
    // ilk saniye: 10 paket eksik, 1 sırasız, 1 yinelenen
    for (let i = 0; i < first; i++) {
      if (i >= 20 && i < 30) continue;
      if (i === 40) continue; // sonradan gelecek
      c.onPacket(i, 1200, i, 1000 + i);
    }
    c.onPacket(40, 1200, 40, 1100); // sırasız (seq < en yüksek)
    c.onPacket(5, 1200, 5, 1200); // yinelenen
    c.onPacket(9_999_999, 1200, 0, 0); // plan dışı: yok sayılır
    const s = c.finish();
    expect(s[0]).toMatchObject({ planned: first, recv: first - 10, lost: 10, reord: 1, dup: 1 });
    expect(s[0]!.jit).toBeGreaterThan(0);
    expect(s[1]).toMatchObject({ recv: 0, lost: plan[1]!.pps });
  });

  it('araçtaki sayaç sunucudakiyle aynı sonucu verir', async () => {
    const probe = await loadProbe();
    const plan = buildPlan('quick', 'down').seconds;
    const a = new LossCounter(plan);
    const b = new probe.LossCounter(plan);
    for (let i = 0; i < 300; i++) {
      if (i % 7 === 0) continue;
      const seq = i % 50 === 0 ? Math.max(0, i - 3) : i;
      a.onPacket(seq, 1200, i * 2, 500 + i * 2 + (i % 5));
      b.onPacket(seq, 1200, i * 2, 500 + i * 2 + (i % 5));
    }
    expect(b.finish()).toEqual(a.finish());
  });
});

describe('jeton ve çerez', () => {
  const tokens = new LineTokens(SECRET);

  it('imza, süre ve başka anahtar', () => {
    const text = tokens.sign(tokenOf());
    expect(tokens.verify(text)?.i).toBe('u:alice');
    expect(tokens.verify(text, Date.now() + 120_000)).toBeNull(); // süresi dolmuş
    expect(new LineTokens('baska-anahtar').verify(text)).toBeNull();
    const [body, sig] = text.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...tokenOf(), i: 'u:admin' })).toString('base64url');
    expect(tokens.verify(`${forged}.${sig}`)).toBeNull();
    expect(tokens.verify(`${body}.`)).toBeNull();
    expect(tokens.verify('x'.repeat(700))).toBeNull();
    expect(tokens.verify('')).toBeNull();
  });

  it('çerez kaynak adresine ve süreye bağlı', () => {
    const now = 1_000_000_000;
    const c = tokens.cookie('1.2.3.4', 5000, 77, now);
    expect(tokens.cookieOk(c, '1.2.3.4', 5000, 77, now + 1000)).toBe(true);
    expect(tokens.cookieOk(c, '1.2.3.5', 5000, 77, now)).toBe(false);
    expect(tokens.cookieOk(c, '1.2.3.4', 5001, 77, now)).toBe(false);
    expect(tokens.cookieOk(c, '1.2.3.4', 5000, 78, now)).toBe(false);
    expect(tokens.cookieOk(c, '1.2.3.4', 5000, 77, now + 60_000)).toBe(false);
    expect(tokens.cookieOk(Buffer.alloc(3), '1.2.3.4', 5000, 77, now)).toBe(false);
  });
});

// ---------- UDP ucu: gerçek soketlerle ----------

class Client {
  readonly socket = dgram.createSocket('udp4');
  readonly got: Buffer[] = [];
  port = 0;
  async open(): Promise<this> {
    this.socket.on('message', (m) => this.got.push(m));
    await new Promise<void>((r) => this.socket.bind(0, '127.0.0.1', r));
    this.port = this.socket.address().port;
    return this;
  }
  send(buf: Buffer, port: number): void {
    this.socket.send(buf, port, '127.0.0.1');
  }
  close(): void {
    this.socket.close();
  }
}

describe('UDP ucu', () => {
  let server: LineTestServer;
  let port: number;
  const tokens = new LineTokens(SECRET);
  const clients: Client[] = [];
  const client = async (): Promise<Client> => {
    const c = await new Client().open();
    clients.push(c);
    return c;
  };

  beforeEach(async () => {
    server = new LineTestServer({ tokens, ports: [0], maxBps: 30_000_000 });
    port = (await server.start())!;
  });
  afterEach(() => {
    server.stop();
    for (const c of clients.splice(0)) c.close();
  });

  const open = (over: Partial<LineToken> = {}, profile: LineProfile = 'quick', mode: LineMode = 'both', ip = '127.0.0.1') => {
    const token = tokenOf({ p: profile, m: mode, ...over });
    const session = server.open(token, buildPlan(profile, mode), ip);
    if (typeof session === 'string') throw new Error(session);
    return { token, text: tokens.sign(token), session };
  };

  it('geçersiz/kısa/süresi dolmuş/yanlış oturumlu el sıkışmalarına hiç yanıt vermez', async () => {
    const c = await client();
    const { token, text } = open();
    const padded = (t: string) => encodeHello(token.s, t);
    c.send(Buffer.from('rastgele çöp'), port);
    c.send(encodeHello(token.s, 'kisa'), port); // çok kısa
    c.send(padded(`${text.slice(0, -2)}xx`), port); // imza bozuk
    c.send(padded(tokens.sign({ ...token, x: Date.now() - 1 })), port); // süresi dolmuş
    c.send(encodeHello(token.s + 1, text), port); // başlıktaki sid jetonla uyuşmuyor
    c.send(padded(tokens.sign({ ...token, s: 999, i: 'u:baska' })), port); // imzalı ama açılmış oturumu yok
    c.send(encodeData(T_UP, token.s, 1200, { seq: 0, step: 0, ts: 0 }), port); // el sıkışmadan veri
    await sleep(250);
    expect(c.got).toHaveLength(0);
  });

  it('yanıtlar isteği asla aşmaz: HELLO -> CHALLENGE, START -> READY', async () => {
    const c = await client();
    const { token, text } = open();
    const hello = encodeHello(token.s, text);
    c.send(hello, port);
    await sleep(150);
    expect(c.got).toHaveLength(1);
    const challenge = c.got[0]!;
    expect(parseHeader(challenge)?.type).toBe(T_CHALLENGE);
    expect(challenge.length).toBeLessThan(hello.length);
    const cookie = challenge.subarray(HEADER, HEADER + 8);
    const start = encodeStart(token.s, Buffer.from(cookie), text);
    c.send(start, port);
    await sleep(150);
    const ready = c.got.find((b) => parseHeader(b)?.type === T_READY)!;
    expect(ready).toBeDefined();
    expect(ready.length).toBeLessThan(start.length);
  });

  it('çerezsiz/yanlış çerezli START ve başka adresten gelen çerez işe yaramaz (adres doğrulama)', async () => {
    const a = await client();
    const b = await client();
    const { token, text } = open();
    a.send(encodeHello(token.s, text), port);
    await sleep(150);
    const cookie = Buffer.from(a.got[0]!.subarray(HEADER, HEADER + 8));
    // yanlış çerez
    b.send(encodeStart(token.s, Buffer.alloc(8, 1), text), port);
    // a'nın çerezi b'nin adresinden (sahte/çalıntı) kullanılamaz
    b.send(encodeStart(token.s, cookie, text), port);
    await sleep(250);
    expect(b.got).toHaveLength(0);
    expect(server.get(token.s)!.addr).toBeNull();
    // sahibi kullanabilir
    a.send(encodeStart(token.s, cookie, text), port);
    await sleep(150);
    expect(a.got.some((x) => parseHeader(x)?.type === T_READY)).toBe(true);
    expect(server.get(token.s)!.addr?.port).toBe(a.port);
  });

  it('veri yalnızca doğrulanmış adrese gider; başka adresten yukarı veri sayılmaz', async () => {
    const a = await client();
    const b = await client();
    const { token, text, session } = open({}, 'quick', 'both');
    a.send(encodeHello(token.s, text), port);
    await sleep(120);
    a.send(encodeStart(token.s, Buffer.from(a.got[0]!.subarray(HEADER, HEADER + 8)), text), port);
    await sleep(700);
    const downA = a.got.filter((x) => parseHeader(x)?.type === T_DOWN);
    expect(downA.length).toBeGreaterThan(20);
    expect(b.got).toHaveLength(0);
    // a yukarı yön; b aynı sid ile yukarı veri yollar: sayılmaz
    for (let i = 0; i < 5; i++) a.send(encodeData(T_UP, token.s, 1200, { seq: i, step: 0, ts: i }), port);
    for (let i = 5; i < 15; i++) b.send(encodeData(T_UP, token.s, 1200, { seq: i, step: 0, ts: i }), port);
    await sleep(200);
    const fin = server.finish(session.sid)!;
    expect(fin.up![0]!.recv).toBe(5);
    expect(fin.addr?.port).toBe(a.port);
  });

  it('aşağı yön planlanan hızda gelir ve sayım tutarlıdır', async () => {
    const a = await client();
    const { token, text, session } = open({}, 'quick', 'down');
    a.send(encodeHello(token.s, text), port);
    await sleep(120);
    a.send(encodeStart(token.s, Buffer.from(a.got[0]!.subarray(HEADER, HEADER + 8)), text), port);
    await sleep(2400);
    const data = a.got.filter((x) => parseHeader(x)?.type === T_DOWN);
    // quick ilk 2 sn: 1 Mbps = 104 pk/sn
    const plan = session.plan;
    const expected = plan.seconds[0]!.pps * 2 - 0; // yaklaşık (başlangıç gecikmesi 100 ms)
    expect(data.length).toBeGreaterThan(expected * 0.85);
    expect(data.length).toBeLessThan(expected * 1.4 + plan.seconds[2]!.pps);
    expect(data.every((d) => d.length >= 100 && d.length <= 1300)).toBe(true);
    const fin = server.finish(session.sid)!;
    expect(fin.downSent!.reduce((n, x) => n + x, 0)).toBeGreaterThanOrEqual(data.length);
    expect(server.active).toBe(0);
    expect(server.reservedTotal).toBe(0);
  });

  it('kimlik başına tek test ve toplam bant sınırı (bitiş bant genişliğini geri verir)', () => {
    server.stop();
    server = new LineTestServer({ tokens, ports: [0], maxBps: 20_000_000 });
    return server.start().then(() => {
      open({ s: 1, i: 'u:a' }, 'quick', 'both'); // 16 Mbps ayrılır
      expect(server.open(tokenOf({ s: 2, i: 'u:a' }), buildPlan('quick', 'both'), '10.0.0.1')).toBe('busy_user');
      expect(server.open(tokenOf({ s: 3, i: 'u:b' }), buildPlan('ramp', 'up'), '10.0.0.2')).toBe('capacity'); // 16 + 12 > 20
      expect(server.open(tokenOf({ s: 4, i: 'u:c' }), buildPlan('quick', 'up'), '10.0.0.3')).toBe('capacity'); // 16 + 8 > 20
      server.finish(1);
      expect(server.reservedTotal).toBe(0);
      expect(typeof server.open(tokenOf({ s: 5, i: 'u:a' }), buildPlan('quick', 'up'), '10.0.0.9')).not.toBe('string');
    });
  });

  it('adres başına eşzamanlı oturum sınırı', () => {
    expect(typeof server.open(tokenOf({ s: 1, i: 'u:a' }), buildPlan('pps', 'up'), '10.0.0.3')).not.toBe('string');
    expect(typeof server.open(tokenOf({ s: 2, i: 'u:b' }), buildPlan('pps', 'up'), '10.0.0.3')).not.toBe('string');
    expect(server.open(tokenOf({ s: 3, i: 'u:c' }), buildPlan('pps', 'up'), '10.0.0.3')).toBe('busy_ip');
  });

  it('aynı kaynaktan el sıkışma sayısı sınırlanır (sessizce düşer)', async () => {
    const c = await client();
    const { token, text } = open();
    for (let i = 0; i < 40; i++) c.send(encodeHello(token.s, text), port);
    await sleep(400);
    expect(c.got.length).toBeLessThanOrEqual(12);
    expect(server.stats.rateLimited).toBeGreaterThan(0);
  });

  it('başlamayan oturum süresi dolunca bant genişliği serbest kalır; başlayıp raporlanmayan kaydedilir', async () => {
    let t = Date.now();
    const abandoned: number[] = [];
    const s2 = new LineTestServer({ tokens, ports: [0], maxBps: 30_000_000, now: () => t, onAbandon: (s) => abandoned.push(s.sid) });
    const p2 = (await s2.start())!;
    const session = s2.open(tokenOf({ s: 10, i: 'u:x', x: t + 5000 }), buildPlan('quick', 'up'), '127.0.0.1');
    expect(typeof session).not.toBe('string');
    expect(s2.reservedTotal).toBeGreaterThan(0);
    const c = await client();
    const tok = tokens.sign(tokenOf({ s: 11, i: 'u:y', x: t + 500_000 }));
    const s = s2.open(tokenOf({ s: 11, i: 'u:y', x: t + 500_000 }), buildPlan('quick', 'up'), '127.0.0.1');
    if (typeof s === 'string') throw new Error(s);
    c.send(encodeHello(11, tok), p2);
    await sleep(150);
    c.send(encodeStart(11, Buffer.from(c.got[0]!.subarray(HEADER, HEADER + 8)), tok), p2);
    await sleep(150);
    t += 10_000; // 10 sn sonra: 10'un jetonu (5 sn) doldu
    await sleep(1100); // süpürme turu
    expect(s2.get(10)).toBeUndefined();
    expect(abandoned).toEqual([]);
    t += 60_000;
    await sleep(1100);
    expect(abandoned).toEqual([11]);
    expect(s2.reservedTotal).toBe(0);
    s2.stop();
  });
});

// ---------- Yorum sınıflandırıcısı ----------

type LossFn = (st: StepStat, i: number) => number;

/** Adım başına kayıp yüzdesiyle sentetik bir aşama (saniye dizileri planla tutarlı) */
function fixture(
  profile: LineProfile,
  mode: LineMode,
  loss: { up?: LossFn; down?: LossFn },
  extra: Partial<VerdictRun> = {},
): VerdictRun {
  const plan = buildPlan(profile, mode);
  const make = (fn?: LossFn): SecondStat[] | null => {
    if (!fn) return null;
    return plan.seconds.map((p, sec) => {
      const step = plan.steps[p.step]!;
      const pct = fn({ label: step.label, rateBps: step.rateBps, pps: step.pps, size: step.size } as StepStat, p.step);
      const lost = Math.round((p.pps * pct) / 100);
      void sec;
      return { planned: p.pps, recv: p.pps - lost, lost, reord: 0, dup: 0, bytes: (p.pps - lost) * p.size, jit: 1 };
    });
  };
  return { transport: 'udp', mode, profile, steps: plan.steps, up: make(loss.up), down: make(loss.down), ...extra };
}

const codes = (runs: VerdictRun[]): string[] => classify(runs).map((f) => f.code);

describe('yorum sınıflandırıcısı', () => {
  it('6 Mbps üstünde başlayan kayıp: hız sınırı şüphesi', () => {
    const run = fixture('ramp', 'down', { down: (s) => (s.rateBps >= 5.9e6 ? 12 : 0.1) });
    const f = classify([run]);
    const t = f.find((x) => x.code === 'hiz_siniri_down')!;
    expect(t).toBeDefined();
    expect(t.tone).toBe('bad');
    expect(t.text).toMatch(/≈3,8.*–5,8|≈3,8 Mbps–5,8 Mbps|hız\/paket sınırı/);
    expect(f.some((x) => x.code === 'temiz')).toBe(false);
  });

  it('bitrate testi temiz, pps testinde kayıp: paket/sn sınırı', () => {
    const ramp = fixture('ramp', 'down', { down: () => 0 });
    const pps = fixture('pps', 'both', { down: (s) => (s.pps >= 2000 ? 15 : 0), up: () => 0 });
    const c = codes([ramp, pps]);
    expect(c).toContain('pps_siniri_down');
    expect(c).not.toContain('hiz_siniri_down');
    expect(c).not.toContain('pps_siniri_up');
  });

  it('UDP kayıplı ama TCP hedef hıza ulaşıyor: yalnızca UDP filtreleme', () => {
    const udp = fixture('ramp', 'down', { down: (s) => (s.rateBps >= 5.9e6 ? 10 : 0) });
    const plan = buildPlan('ramp', 'down');
    const tcpSecs: TcpSecond[] = plan.seconds.map((p) => ({ bytes: p.pps * p.size, target: p.pps * p.size }));
    const tcp: VerdictRun = { transport: 'tcp', mode: 'down', profile: 'ramp', steps: plan.steps, up: null, down: null, tcpDown: tcpSecs };
    const f = classify([udp, tcp]);
    expect(f.map((x) => x.code)).toContain('yalniz_udp_down');
    expect(f.map((x) => x.code)).not.toContain('tcp_yok');
    // TCP de eksikse UDP'ye özgü sayılmaz
    const slow: VerdictRun = { ...tcp, tcpDown: tcpSecs.map((s) => ({ ...s, bytes: s.bytes * 0.5 })) };
    const g = codes([udp, slow]);
    expect(g).toContain('udp_tcp_ikisi_down');
    expect(g).not.toContain('yalniz_udp_down');
  });

  it('her hızda rastgele kayıp: sıkışıklık/hat', () => {
    const run = fixture('ramp', 'down', { down: (_s, i) => 4 + (i % 3) });
    const c = codes([run]);
    expect(c).toContain('her_hizda_down');
    expect(c).not.toContain('hiz_siniri_down');
  });

  it('temiz hat', () => {
    const f = classify([fixture('ramp', 'both', { up: () => 0.1, down: () => 0.2 }), fixture('steady', 'both', { up: () => 0, down: () => 0 })]);
    expect(f.map((x) => x.code)).toEqual(['temiz']);
    expect(f[0]!.tone).toBe('ok');
    const live = classify([fixture('ramp', 'both', { up: () => 0, down: () => 0 }, { streaming: true })]);
    expect(live[0]!.text).toMatch(/yayın açıkken/);
  });

  it('yön farkı, ulaşılamayan UDP ve sunucu gönderim açığı', () => {
    const asym = codes([fixture('ramp', 'both', { up: () => 0, down: () => 6 })]);
    expect(asym).toContain('yon_farki');
    const dead = classify([fixture('ramp', 'both', {}, { unreachable: true })]);
    expect(dead.map((x) => x.code)).toContain('udp_ulasilamadi');
    // sunucu planı gönderemediyse (soket) bu kayıp hat sayılmaz
    const run = fixture('ramp', 'down', { down: () => 50 });
    run.downSent = run.down!.map((s) => Math.round(s.planned * 0.5));
    const f = classify([run]);
    expect(f.map((x) => x.code)).toContain('sunucu_gonderim');
    expect(f.map((x) => x.code)).not.toContain('her_hizda_down');
  });

  it('eşik dizini: temiz başlangıç ve sürekli kayıplı son', () => {
    const mk = (pcts: number[]): StepStat[] => pcts.map((lossPct) => ({ lossPct }) as StepStat);
    expect(thresholdIndex(mk([0, 0, 0, 5, 9]))).toBe(3);
    expect(thresholdIndex(mk([0, 6, 0, 7]))).toBe(-1);
    expect(thresholdIndex(mk([5, 6, 7]))).toBe(-1);
    const steps = buildPlan('quick', 'down').steps;
    const secs: SecondStat[] = buildPlan('quick', 'down').seconds.map((p) => ({ planned: p.pps, recv: p.pps - 10, lost: 10, reord: 0, dup: 0, bytes: 0, jit: 0 }));
    expect(stepStats(steps, secs)[0]!.lost).toBe(20);
  });
});

describe('suite ve ortak test', () => {
  const runOf = (name: string, at: number, lossy: boolean, suite: string): LineRun => {
    const v = fixture('ramp', 'both', { up: () => (lossy ? 8 : 0), down: () => (lossy ? 8 : 0) });
    return {
      id: `${suite}-r`, suite, at, end: at + 10_000, who: { kind: 'code', userId: null, name }, ip: '1.1.1.1',
      transport: 'udp', profile: 'ramp', mode: 'both', steps: v.steps,
      streaming: { start: false, end: false, channels: [] }, serverTxMbps: null,
      up: v.up, down: v.down, downSent: null, downErrors: null, tcpUp: null, tcpDown: null, client: null, partial: false,
    };
  };

  it('aynı dakikadaki farklı kişilerin testleri gruplanır, donma olayıyla eşleşir', () => {
    const t = Date.parse('2026-10-01T21:30:00+03:00');
    const runs = [runOf('Ali', t, true, 's1'), runOf('Veli', t + 20_000, true, 's2'), runOf('Ayşe', t + 30_000, false, 's3'), runOf('Uzak', t + 10 * 60_000, true, 's4')];
    const suites = groupSuites(runs, [{ id: 'f1', start: t - 30_000, end: t + 5000 }]);
    expect(suites).toHaveLength(4);
    expect(suites.find((s) => s.id === 's1')!.freezeIds).toEqual(['f1']);
    expect(suites.find((s) => s.id === 's4')!.freezeIds).toEqual([]);
    const groups = syncGroups(suites);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ total: 3, lossy: 2 });
    expect(groups[0]!.suiteIds.sort()).toEqual(['s1', 's2', 's3']);
    expect(groups[0]!.text).toMatch(/2\/3/);
  });
});

// ---------- HTTP uçları ve araçla uçtan uca ----------

describe('hat testi uçları', () => {
  let s: TestServer;
  let tmp: string;
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-hat-'));
    s = await startServer({ lineTestPorts: [0], telemetryDir: tmp });
  });
  afterEach(async () => {
    await s.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('kimliksiz/yanlış kodla oturum açılamaz, yanlış kod denemeleri sınırlanır', async () => {
    const anon = await s.app.inject({ method: 'POST', url: '/api/line-test/session', payload: { profile: 'quick' } });
    expect(anon.statusCode).toBe(401);
    const bad = await s.app.inject({ method: 'POST', url: '/api/line-test/session', payload: { profile: 'quick', code: 'YANLIS00', name: 'x' } });
    expect(bad.statusCode).toBe(401);
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await s.app.inject({ method: 'POST', url: '/api/line-test/session', payload: { profile: 'quick', code: `KOD${i}`, name: 'x' } })).statusCode;
    }
    expect(last).toBe(429);
    const badToken = await s.app.inject({ method: 'POST', url: '/api/line-test/session', headers: auth('uydurma'), payload: { profile: 'quick' } });
    expect(badToken.statusCode).toBe(401);
    expect((await s.app.inject({ method: 'POST', url: '/api/line-test/finish', payload: {} })).statusCode).toBe(401);
    expect((await s.app.inject({ method: 'GET', url: '/api/line-test/tcp/down' })).statusCode).toBe(401);
  });

  it('hesapla oturum açılır; aynı anda ikinci test reddedilir; yönetici olmayan panele erişemez', async () => {
    const r = await s.req(s.owner.token, 'POST', '/api/line-test/session', { profile: 'quick', mode: 'both' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.port).toBe(s.ctx.lineTest.port);
    expect(body.plan.seconds).toHaveLength(10);
    expect(body.plan.mode).toBe('both');
    const again = await s.req(s.owner.token, 'POST', '/api/line-test/session', { profile: 'quick' });
    expect(again.statusCode).toBe(409);
    const member = await s.member('uye');
    expect((await s.req(member.token, 'GET', '/api/admin/line-tests')).statusCode).toBe(403);
    expect((await s.req(member.token, 'POST', '/api/admin/line-test/codes', {})).statusCode).toBe(403);
    // jetonsuz TCP/bitiş reddedilir; bitişte başlamamış UDP "ulaşılamadı" diye kaydedilir
    const fin = await s.app.inject({ method: 'POST', url: '/api/line-test/finish', headers: { 'x-line-token': body.token }, payload: { suite: 'deneme1234', client: { os: 'test' } } });
    expect(fin.statusCode).toBe(200);
    expect(fin.json().unreachable).toBe(true);
    expect(fin.json().findings.map((f: { code: string }) => f.code)).toContain('udp_ulasilamadi');
    // bitiş bir kez: ikincisi 401 (oturum kapandı)
    const fin2 = await s.app.inject({ method: 'POST', url: '/api/line-test/finish', headers: { 'x-line-token': body.token }, payload: {} });
    expect(fin2.statusCode).toBe(401);
    const panel = (await s.req(s.owner.token, 'GET', '/api/admin/line-tests?days=1')).json();
    expect(panel.suites).toHaveLength(1);
    expect(panel.suites[0].who.userId).toBe(s.owner.user.id);
  });

  it('araç (probe.mjs) gerçek sunucuya karşı uçtan uca çalışır: UDP + TCP, iki yön', async () => {
    const probe = await loadProbe();
    await s.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = s.app.server.address() as { port: number };
    const server = `http://127.0.0.1:${addr.port}`;
    const code = (await s.req(s.owner.token, 'POST', '/api/admin/line-test/codes', { label: 'deneme', hours: 1, maxUses: 5 })).json() as { code: string };
    expect(code.code).toMatch(/^[A-Z2-9]{8}$/);
    const events: string[] = [];
    const res = await probe.runSuite({
      server,
      auth: { code: code.code, name: 'Deneme Kişisi' },
      phases: [
        { profile: 'quick', mode: 'both', label: 'udp' },
        { profile: 'quick', mode: 'both', transport: 'tcp', label: 'tcp' },
      ],
      suite: 'e2e-deneme-1',
      onEvent: (e: { type: string }) => events.push(e.type),
    });
    expect(res.phases.map((p) => p.error)).toEqual([undefined, undefined]);
    const udp = res.phases[0]!.result as { stats: { up: StepStat[]; down: StepStat[] }; findings: { code: string }[] };
    // loopback: kayıp yok; iki yön de ölçüldü
    for (const dir of [udp.stats.up, udp.stats.down]) {
      expect(dir).toHaveLength(5);
      expect(dir.reduce((n, x) => n + x.recv, 0) / dir.reduce((n, x) => n + x.planned, 0)).toBeGreaterThan(0.9);
    }
    const tcp = res.phases[1]!.result as { tcpUp: number[]; tcpDown: number[]; findings: { code: string }[] };
    const plan = buildPlan('quick', 'both');
    const target = plan.seconds.reduce((n, p) => n + p.pps * p.size, 0);
    expect(tcp.tcpDown.reduce((n, x) => n + x, 0)).toBeGreaterThan(target * 0.85);
    expect(tcp.tcpUp.reduce((n, x) => n + x, 0)).toBeGreaterThan(target * 0.85);
    expect(events).toContain('phase-done');
    // panelde tek test (suite), iki aşama, adı kodla verilen isim
    const panel = (await s.req(s.owner.token, 'GET', '/api/admin/line-tests?days=1')).json();
    expect(panel.suites).toHaveLength(1);
    expect(panel.suites[0].runs).toHaveLength(2);
    expect(panel.suites[0].who).toMatchObject({ kind: 'code', name: 'Deneme Kişisi' });
    expect(panel.codes[0].uses).toBe(2);
    // kayıtlar diske yazıldı
    await sleep(100);
    expect(fs.readFileSync(path.join(tmp, 'line-tests.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
  }, 60_000);

  it('bant sınırı: ikinci kişinin testi kapasite dolunca 503', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', DATA_DIR: '.', LINE_TEST_MAX_MBPS: '10' });
    const { app, ctx } = await buildApp(cfg, { dbFile: ':memory:', logger: false, lineTestPorts: [0], telemetryDir: null });
    await app.ready();
    const tok = tokenOf();
    void tok;
    const who = { kind: 'code' as const, userId: null, name: 'a' };
    const code = ctx.lineTest.createCode('x', 1, 10);
    const a = ctx.lineTest.mint(who, code, 'ramp', 'up', 'udp', '1.1.1.1'); // 12 Mbps > 10 Mbps
    expect(a).toMatchObject({ ok: false, error: 'capacity' });
    const b = ctx.lineTest.mint(who, code, 'pps', 'up', 'udp', '1.1.1.1'); // 9,6 Mbps
    expect(b.ok).toBe(true);
    await app.close();
  });
});
