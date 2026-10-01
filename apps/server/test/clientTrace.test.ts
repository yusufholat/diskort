import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_FEATURE_VOICE_TRACE, type VoiceTelemetryReport, type VoiceTraceSample, type VoiceTraceUpload } from '@diskort/shared';
import { ClientTraceStore, type AlignedTrace, type TraceMeta } from '../src/clientTrace.js';
import { dayKey } from '../src/counters.js';
import { alignedEnd } from '../src/telemetry.js';
import { connectGateway, startServer, type TestServer } from './helpers.js';

// Olay kayıtları: istemcilerin saniyelik bağlantı ölçümlerinin alınması, saklanması, sunucu saatine çevrilmesi,
// yönetici uçları ve sunucunun sesteki istemcilerden kayıt istemesi.

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-olay-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** İstemcinin saati sunucudan bu kadar geride */
const SKEW_MS = 7_000;

function sample(q: number, t: number, over: Partial<VoiceTraceSample> = {}): VoiceTraceSample {
  return {
    q,
    t,
    dt: 1000,
    x: { pi: 1, rtt: 40, sq: 1, sr: 1, su: 0, ao: 4_000_000, ai: null, bs: 400_000, br: 300_000, pd: 0, ice: 'connected', pc: 'connected', lk: 'excellent', ct: 'srflx', pr: 'udp' },
    up: [
      { k: 'mic', ps: 50, bs: 5_000, pl: 0, fl: 0, rtt: 45 },
      { k: 'scr', ps: 300, bs: 375_000, pl: 0, tb: 3_000_000, fe: 30, fs: 30, kf: 0, hf: 0, nk: 0, pli: 0, fir: 0, rb: 0, rp: 0, ql: 'none', w: 1920, h: 1080, fps: 30, em: 5, sd: 50 },
    ],
    da: { n: 1, pr: 50, pl: 0, bs: 5_000, j: 12, ss: 48_000, cs: 0, ce: 0 },
    dv: [{ i: 1, pr: 250, pl: 0, bs: 300_000, j: 20, fd: 30, kf: 0, fz: 0, fzd: 0, dr: 0, nk: 0, pli: 0, jb: 50, fps: 30, w: 1920, h: 1080 }],
    lag: 3,
    un: 0,
    ...over,
  };
}

/** `end` (sunucu saati) anında biten `count` saniyelik kesit; istemci saati SKEW_MS geride */
function upload(end: number, count: number, over: Partial<VoiceTraceUpload> = {}): VoiceTraceUpload {
  const clientEnd = end - SKEW_MS;
  return {
    v: 1,
    id: `kesit-${Math.random().toString(36).slice(2)}`,
    platform: 'desktop',
    version: '0.9.4',
    channelId: 'yok',
    reason: 'stun',
    reasons: ['stun'],
    eventId: null,
    triggerAt: clientEnd - 20_000,
    sentAt: Date.now() - SKEW_MS,
    offsetMs: SKEW_MS,
    attempt: 1,
    more: false,
    intervalMs: 1000,
    samples: Array.from({ length: count }, (_, i) => sample(i + 1, clientEnd - (count - 1 - i) * 1000)),
    marks: [{ t: clientEnd - 20_000, l: 'trigger:stun' }],
    ...over,
  };
}

describe('olay kaydı deposu', () => {
  it('saat farkı: istemcinin ölçümü tutarlıysa o, değilse gönderim anından tahmin; gelecek zamana taşmaz', () => {
    const store = new ClientTraceStore({ dir: null });
    const now = 1_800_000_000_000;
    const where = { channelId: 'k', guildId: 'g' };
    // Tutarlı: istemci ölçümü (sunucu 7 sn ileride), yükleme 300 ms sürdü
    const a = store.ingest('u1', upload(now - 1_000, 30, { sentAt: now - SKEW_MS - 300 }), where, now)!;
    expect(a).toMatchObject({ offsetMs: SKEW_MS, offsetSource: 'client', to: now - 1_000, from: now - 31_000, n: 30, channelId: 'k', guildId: 'g' });
    expect(a.triggerAt).toBe(now - 21_000);
    expect(a.delayMs).toBe(21_000);
    // İstemci farkı ölçememiş (eski sunucudan kalma oturum): gönderim anından
    const b = store.ingest('u1', upload(now - 1_000, 30, { offsetMs: null, sentAt: now - SKEW_MS - 300 }), where, now)!;
    expect(b).toMatchObject({ offsetMs: SKEW_MS + 300, offsetSource: 'sentAt' });
    // Tutarsız ölçüm (ör. saat bu arada değişti): güvenilmez
    const c = store.ingest('u1', upload(now - 1_000, 30, { offsetMs: 5 * 60_000, sentAt: now - SKEW_MS - 300 }), where, now)!;
    expect(c).toMatchObject({ offsetMs: SKEW_MS + 300, offsetSource: 'sentAt' });
    // Hiçbir ölçüm sunucunun şimdisinden ileride olamaz
    const d = store.ingest('u1', upload(now + 4_000, 30, { sentAt: now - SKEW_MS }), where, now)!;
    expect(d.to).toBe(now);
  });

  it('aynı kesitin yeniden gönderimi kaydedilmez (kullanıcı başına)', () => {
    const store = new ClientTraceStore({ dir: null });
    const now = Date.now();
    const u = upload(now, 5, { id: 'ayni' });
    expect(store.ingest('u1', u, { channelId: null, guildId: null }, now)).not.toBeNull();
    expect(store.ingest('u1', { ...u, attempt: 2 }, { channelId: null, guildId: null }, now + 5_000)).toBeNull();
    expect(store.ingest('u2', u, { channelId: null, guildId: null }, now)).not.toBeNull();
    expect(store).toMatchObject({ received: 2, duplicates: 1 });
  });

  it('günlük dosyaya yazar, özetleri ölçümleri ayrıştırmadan okur, pencereyi sunucu saatiyle kırpar', async () => {
    const dir = path.join(tmp, 'telemetry');
    const store = new ClientTraceStore({ dir, offsetMin: 180 });
    const now = Date.now();
    const where = { channelId: 'kanal-1', guildId: 'g' };
    const a = store.ingest('u1', upload(now - 60_000, 80, { eventId: 'olay-1', reason: 'request' }), where, now)!;
    store.ingest('u2', upload(now - 60_000, 80, { eventId: 'olay-1', reason: 'request', platform: 'android', intervalMs: 2000 }), where, now);
    store.ingest('u1', upload(now - 3_600_000, 10), { channelId: 'kanal-2', guildId: 'g' }, now - 3_590_000);
    await store.flush();
    const file = path.join(dir, `traces-${dayKey(now, 180)}.jsonl`);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Ölçümler satırın sonunda; adres benzeri hiçbir şey yok
    expect(lines.at(-1)!.indexOf(',"samples":[')).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toMatch(/\d+\.\d+\.\d+\.\d+/);

    const all = await store.list({ from: now - 2 * 3_600_000, to: now });
    expect(all.traces).toHaveLength(3);
    expect(all.traces[0]).not.toHaveProperty('samples');
    expect(all.traces[0]).not.toHaveProperty('marks');
    expect((await store.list({ from: now - 2 * 3_600_000, to: now, channelId: 'kanal-2' })).traces).toHaveLength(1);
    expect((await store.list({ from: now - 2 * 3_600_000, to: now, userId: 'u2' })).traces.map((t) => t.platform)).toEqual(['android']);
    expect((await store.list({ from: now - 2 * 3_600_000, to: now, eventId: 'olay-1' })).traces).toHaveLength(2);
    expect((await store.list({ from: now - 600_000, to: now })).traces).toHaveLength(2);
    expect((await store.list({ from: now - 2 * 3_600_000, to: now, limit: 1 })).truncated).toBe(true);

    const full = (await store.get(a.id))!;
    expect(full.samples).toHaveLength(80);
    expect(full.samples.at(-1)).toMatchObject({ ts: now - 60_000, t: now - 60_000 - SKEW_MS });
    expect(full.marks[0]).toMatchObject({ l: 'trigger:stun', ts: now - 80_000 });
    expect(await store.get('yok-0-aaaa')).toBeNull();

    // 10 saniyelik pencere: iki istemcinin aynı saniyeleri
    const win = await store.window({ from: now - 75_000, to: now - 65_000, channelId: 'kanal-1' });
    expect(win.traces.map((t) => t.userId).sort()).toEqual(['u1', 'u2']);
    for (const t of win.traces) {
      expect(t.samples).toHaveLength(11);
      expect(t.samples.every((s) => s.ts >= now - 75_000 && s.ts - s.dt < now - 65_000)).toBe(true);
    }
  });

  it('gün başına boyut sınırı aşılınca yazılmaz; saklama süresini aşan dosyalar silinir', async () => {
    const dir = path.join(tmp, 'telemetry');
    const store = new ClientTraceStore({ dir, maxDayBytes: 60_000, retentionDays: 14, offsetMin: 180 });
    const now = Date.now();
    for (let i = 0; i < 5; i++) store.ingest(`u${i}`, upload(now, 60), { channelId: null, guildId: null }, now);
    await store.flush();
    expect(store.dropped).toBeGreaterThan(0);
    const file = path.join(dir, `traces-${dayKey(now, 180)}.jsonl`);
    expect(fs.statSync(file).size).toBeLessThanOrEqual(60_000);

    const old = path.join(dir, `traces-${dayKey(now - 20 * 86_400_000, 180)}.jsonl`);
    const keep = path.join(dir, `traces-${dayKey(now - 5 * 86_400_000, 180)}.jsonl`);
    // Ses kalitesi özetlerinin günlük dosyasına dokunulmaz (kendi saklama kuralı var)
    const other = path.join(dir, `${dayKey(now - 20 * 86_400_000, 180)}.jsonl`);
    for (const f of [old, keep, other]) fs.writeFileSync(f, '{}\n');
    await store.removeOldFiles(now);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(keep)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
    expect((await store.days()).map((d) => d.day)).toEqual([dayKey(now, 180), dayKey(now - 5 * 86_400_000, 180)]);
  });
});

describe('olay kaydı uçları', () => {
  let s: TestServer;
  beforeEach(async () => {
    s = await startServer({ telemetryDir: path.join(tmp, 'telemetry') });
  });
  afterEach(async () => {
    await s.close();
  });

  it('kayıt oturum ister, doğrulanır ve sunucunun bildiği ses kanalıyla saklanır', async () => {
    const member = await s.member('uye');
    const voice = s.channel('voice');
    const now = Date.now();
    expect((await s.app.inject({ method: 'POST', url: '/api/telemetry/voice-trace', payload: upload(now, 5) })).statusCode).toBe(401);
    s.ctx.voice.join(member.user.id, voice.id);
    const send = (u: unknown) => s.req(member.token, 'POST', '/api/telemetry/voice-trace', u);
    expect((await send(upload(now, 40, { channelId: 'uydurma' }))).statusCode).toBe(204);
    // Geçersiz gövdeler: sürüm, ölçümsüz, fazla ölçüm, saat aralığı dışı
    expect((await send({ ...upload(now, 5), v: 2 })).statusCode).toBe(400);
    expect((await send(upload(now, 0))).statusCode).toBe(400);
    expect((await send(upload(now, 151))).statusCode).toBe(400);
    expect((await send({ ...upload(now, 5), sentAt: 12 })).statusCode).toBe(400);
    // Bilinmeyen alanlar atılır, aralık dışı sayılar sıkıştırılır
    const odd = upload(now, 2);
    (odd.samples[0] as unknown as Record<string, unknown>).adres = '10.0.0.1';
    odd.samples[0]!.x!.rtt = 9e15;
    expect((await send(odd)).statusCode).toBe(204);

    const list = (await s.req(s.owner.token, 'GET', '/api/admin/voice/traces')).json() as {
      traces: TraceMeta[];
      users: Record<string, { username: string }>;
      channels: Record<string, { name: string }>;
      stats: { received: number };
    };
    expect(list.traces).toHaveLength(2);
    expect(list.traces.every((t) => t.channelId === voice.id && t.guildId === s.guildId && t.userId === member.user.id)).toBe(true);
    expect(list.users[member.user.id]!.username).toBe('uye');
    expect(list.channels[voice.id]!.name).toBe(voice.name);
    expect(list.stats.received).toBe(2);

    const oddId = list.traces.find((t) => t.n === 2)!.id;
    const one = (await s.req(s.owner.token, 'GET', `/api/admin/voice/traces/${oddId}`)).json() as { trace: AlignedTrace };
    expect(JSON.stringify(one.trace)).not.toContain('10.0.0.1');
    expect(one.trace.samples[0]!.x!.rtt).toBe(600_000);
    expect(one.trace.samples[0]!.ts).toBe(one.trace.samples[0]!.t + one.trace.offsetMs);
  });

  it('sesten çıktıktan sonra ulaşan kayıt, istemcinin bildirdiği ve görebildiği kanalla saklanır', async () => {
    const member = await s.member('uye');
    const voice = s.channel('voice');
    const now = Date.now();
    const send = (u: unknown) => s.req(member.token, 'POST', '/api/telemetry/voice-trace', u);
    expect((await send(upload(now, 5, { channelId: voice.id }))).statusCode).toBe(204);
    expect((await send(upload(now, 5, { channelId: 'uydurma' }))).statusCode).toBe(204);
    const { traces } = (await s.req(s.owner.token, 'GET', '/api/admin/voice/traces')).json() as { traces: TraceMeta[] };
    expect(traces.map((t) => t.channelId).sort()).toEqual([null, voice.id].sort());
  });

  it('yeniden gönderilen kesit bir kez saklanır; kullanıcı başına gönderim sınırı vardır', async () => {
    const member = await s.member('uye');
    const now = Date.now();
    const u = upload(now, 5, { id: 'tekrar' });
    const send = (body: unknown) => s.req(member.token, 'POST', '/api/telemetry/voice-trace', body);
    expect((await send(u)).statusCode).toBe(204);
    expect((await send({ ...u, attempt: 2, sentAt: u.sentAt + 2_000 })).statusCode).toBe(204);
    const { traces } = (await s.req(s.owner.token, 'GET', '/api/admin/voice/traces')).json() as { traces: TraceMeta[] };
    expect(traces).toHaveLength(1);
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await send(upload(now, 2))).statusCode);
    expect(codes.filter((c) => c === 204)).toHaveLength(6);
    expect(codes.filter((c) => c === 429)).toHaveLength(4);
  });

  it('yönetici uçları yalnızca hesap yöneticisine açıktır; pencere ve sorgular doğrulanır', async () => {
    const member = await s.member('uye');
    const now = Date.now();
    await s.req(member.token, 'POST', '/api/telemetry/voice-trace', upload(now - 30_000, 60));
    for (const url of ['/api/admin/voice/traces', `/api/admin/voice/traces/window?from=${now - 60_000}&to=${now}`, '/api/admin/voice/traces/abc']) {
      expect((await s.app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await s.req(member.token, 'GET', url)).statusCode).toBe(403);
    }
    expect((await s.req(member.token, 'POST', '/api/admin/voice/traces/request', { channelId: 'x' })).statusCode).toBe(403);
    expect((await s.req(s.owner.token, 'GET', '/api/admin/voice/traces/window')).statusCode).toBe(400);
    expect((await s.req(s.owner.token, 'GET', `/api/admin/voice/traces/window?from=${now - 3_600_000}&to=${now}`)).statusCode).toBe(400);
    expect((await s.req(s.owner.token, 'GET', '/api/admin/voice/traces/yok-0-aaaa')).statusCode).toBe(404);
    expect((await s.req(s.owner.token, 'GET', '/api/admin/voice/traces?limit=0')).statusCode).toBe(400);

    const win = (
      await s.req(s.owner.token, 'GET', `/api/admin/voice/traces/window?from=${now - 50_000}&to=${now - 40_000}&userId=${member.user.id}`)
    ).json() as { traces: AlignedTrace[] };
    expect(win.traces).toHaveLength(1);
    expect(win.traces[0]!.samples.length).toBe(11);
  });

  it('saat ucu oturum ister ve sunucu saatini döner', async () => {
    expect((await s.app.inject({ method: 'GET', url: '/api/time' })).statusCode).toBe(401);
    const before = Date.now();
    const res = await s.req(s.owner.token, 'GET', '/api/time');
    expect(res.statusCode).toBe(200);
    const { now } = res.json() as { now: number };
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe('sunucunun olay kaydı istemesi', () => {
  let s: TestServer;
  beforeEach(async () => {
    s = await startServer();
    await s.app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterEach(async () => {
    await s.close();
  });

  it('kanaldaki, isteği tanıyan oturumlara gider; eski istemciye ve başka kanaldakine gitmez', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const eski = await s.member('eski');
    const voice = s.channel('voice');
    const sahip = await connectGateway(s.app, s.owner.token, [CLIENT_FEATURE_VOICE_TRACE]);
    const a = await connectGateway(s.app, ali.token, [CLIENT_FEATURE_VOICE_TRACE]);
    const v = await connectGateway(s.app, veli.token, [CLIENT_FEATURE_VOICE_TRACE]);
    const e = await connectGateway(s.app, eski.token, []);
    s.ctx.voice.join(ali.user.id, voice.id);
    s.ctx.voice.join(eski.user.id, voice.id);

    const res = await s.req(s.owner.token, 'POST', '/api/admin/voice/traces/request', { channelId: voice.id, reason: 'deneme' });
    expect(res.statusCode).toBe(200);
    const result = res.json() as { eventId: string; users: number; sessions: number; throttled: boolean };
    expect(result).toMatchObject({ channelId: voice.id, users: 2, sessions: 1, throttled: false });
    await a.settle();
    expect(a.of('VOICE_TRACE_REQUEST')).toEqual([{ channelId: voice.id, eventId: result.eventId, reason: 'deneme' }]);
    expect(v.of('VOICE_TRACE_REQUEST')).toEqual([]);
    expect(e.of('VOICE_TRACE_REQUEST')).toEqual([]);
    expect(sahip.of('VOICE_TRACE_REQUEST')).toEqual([]);

    // Aynı kanaldan hemen ikinci istek sınırlanır; olmayan / metin kanalı reddedilir
    expect((await s.req(s.owner.token, 'POST', '/api/admin/voice/traces/request', { channelId: voice.id })).statusCode).toBe(429);
    expect((await s.req(s.owner.token, 'POST', '/api/admin/voice/traces/request', { channelId: 'yok' })).statusCode).toBe(404);
    expect((await s.req(s.owner.token, 'POST', '/api/admin/voice/traces/request', { channelId: s.channel('text').id })).statusCode).toBe(404);
    expect((await s.req(s.owner.token, 'POST', '/api/admin/voice/traces/request', {})).statusCode).toBe(400);

    // Sunucu içinden (ör. donma olayı açılınca): verilen olay kimliğiyle
    s.ctx.voice.join(veli.user.id, voice.id);
    const other = s.ctx.requestVoiceTraces('başka-kanal', 'yayın dondu', 'olay-42');
    expect(other).toMatchObject({ eventId: 'olay-42', users: 0, sessions: 0, throttled: false });
    for (const c of [sahip, a, v, e]) c.ws.close();
  });
});

describe('ses kalitesi özetinin ek alanları', () => {
  it('aralığın bitişi sunucu saatine çevrilir; eski istemcide alan yoktur', () => {
    const now = 1_800_000_000_000;
    // Özet 40 sn geç ulaştı (kesinti): istemcinin ölçtüğü farkla gerçek bitişine yerleşir
    expect(alignedEnd({ endAt: now - SKEW_MS - 40_000, sentAt: now - SKEW_MS - 200, offsetMs: SKEW_MS }, now)).toEqual({ endAt: now - 40_000 });
    // Fark ölçülmemiş: gönderim anından (yükleme süresi kadar sapar)
    expect(alignedEnd({ endAt: now - SKEW_MS - 40_000, sentAt: now - SKEW_MS - 200, offsetMs: null }, now)).toEqual({ endAt: now - 39_800 });
    expect(alignedEnd({}, now)).toEqual({});
    // Gelecekteki bitiş şimdiye çekilir; çok eski bitiş (bozuk saat) yok sayılır
    expect(alignedEnd({ endAt: now + 60_000, sentAt: now, offsetMs: 0 }, now)).toEqual({ endAt: now });
    expect(alignedEnd({ endAt: now - 3_600_000, sentAt: now, offsetMs: 0 }, now)).toEqual({});
  });

  it('ses/görüntü giden kaybı ve bitiş anı özetle saklanır; eski istemcinin özeti değişmeden kabul edilir', async () => {
    const s = await startServer({ telemetryDir: null });
    try {
      const member = await s.member('uye');
      const voice = s.channel('voice');
      s.ctx.voice.join(member.user.id, voice.id);
      const base: VoiceTelemetryReport = {
        v: 1,
        platform: 'desktop',
        version: '0.9.4',
        channelId: voice.id,
        windowSec: 30,
        samples: 15,
        quality: 'good',
        poorSec: 0,
        serverQuality: 'excellent',
        rttMs: { avg: 25, max: 40 },
        jitterInMs: 5,
        jitterOutMs: 3,
        lossOutPct: 0.4,
        lossInPct: 0,
        concealedPct: 0,
        bitrateOut: 40_000,
        bitrateIn: 90_000,
        availableOut: 5_000_000,
        candidate: 'host',
        protocol: 'udp',
        reconnects: 0,
        mic: null,
        screen: null,
      };
      expect((await s.req(member.token, 'POST', '/api/telemetry/voice', base)).statusCode).toBe(204);
      const old = s.ctx.telemetry.liveEntries()[0]!;
      expect(old).not.toHaveProperty('endAt');
      expect(old).not.toHaveProperty('lossOutAudio');

      const now = Date.now();
      const res = await s.req(member.token, 'POST', '/api/telemetry/voice', {
        ...base,
        lossOutAudioPct: 6.254,
        lossOutVideoPct: 0.1,
        endAt: now - 12_000,
        sentAt: now,
        offsetMs: 0,
      });
      expect(res.statusCode).toBe(204);
      const entry = s.ctx.telemetry.liveEntries()[0]!;
      expect(entry).toMatchObject({ lossOutAudio: 6.25, lossOutVideo: 0.1, lossOut: 0.4 });
      expect(Math.abs(entry.endAt! - (now - 12_000))).toBeLessThan(2_000);
      expect(entry.at).toBeGreaterThanOrEqual(now);
    } finally {
      await s.close();
    }
  });
});
