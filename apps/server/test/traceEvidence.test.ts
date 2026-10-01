import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VoiceTraceSample } from '@diskort/shared';
import type { AlignedTrace } from '../src/clientTrace.js';
import { buildUsers, diagnose, FreezeCorrelator } from '../src/freezeDiagnosis.js';
import type { TelemetryEntry } from '../src/telemetry.js';
import { summarizeTraces } from '../src/traceEvidence.js';
import type { TraceRequestResult } from '../src/traceRequests.js';
import { startServer, type TestServer } from './helpers.js';

// İstemci olay kayıtlarının (saniyelik bağlantı ölçümleri) teşhise katılması: kanıt özeti, sınıflandırıcıya etkisi,
// olay açılınca / kesinti kaydedilince kayıt istenmesi.

const T0 = Date.parse('2026-10-01T01:18:00+03:00');

type S = VoiceTraceSample & { ts: number };
const x = (over: Partial<NonNullable<VoiceTraceSample['x']>> = {}): NonNullable<VoiceTraceSample['x']> => ({ pi: 1, rtt: 40, sq: 1, sr: 1, su: 0, ao: 4_000_000, ai: null, bs: 400_000, br: 300_000, pd: 0, ...over });

/** Saniyede bir ölçüm; `at(i)` o saniyenin üstüne yazılacak alanları verir */
function trace(userId: string, seconds: number, at: (i: number) => Partial<S> = () => ({}), role: 'pub' | 'view' | 'voice' = 'voice'): AlignedTrace {
  const samples: S[] = Array.from({ length: seconds }, (_, i) => {
    const ts = T0 + (i + 1) * 1000;
    const base: S = {
      q: i,
      t: ts - 7_000,
      ts,
      dt: 1000,
      x: x(),
      up: [
        { k: 'mic', ps: 50, bs: 5_000, pl: 0, fl: 0 },
        ...(role === 'pub' ? [{ k: 'scr' as const, ps: 300, bs: 375_000, pl: 0, fl: 0, kf: 0, hf: 0, nk: 0, pli: 0, fir: 0 }] : []),
      ],
      da: { n: 1, pr: 50, pl: 0, bs: 5_000, j: 10, ss: 48_000, cs: 0, ce: 0 },
      ...(role === 'view' ? { dv: [{ i: 1, pr: 290, pl: 0, bs: 360_000, j: 15, fd: 30, kf: 0, fz: 0, fzd: 0, dr: 0, nk: 0, pli: 0, jb: 50, fps: 30, w: 1920, h: 1080 }] } : {}),
      lag: 3,
    };
    return { ...base, ...at(i) };
  });
  return {
    id: `${T0.toString(36)}-${userId}`,
    at: T0 + seconds * 1000 + 20_000,
    userId,
    channelId: 'kanal',
    guildId: 'sunucu',
    platform: 'desktop',
    version: '0.9.4',
    clientId: `k-${userId}`,
    reason: 'request',
    reasons: ['request'],
    eventId: 'olay-1',
    triggerAt: T0 + 30_000,
    from: T0,
    to: T0 + seconds * 1000,
    offsetMs: 7_000,
    offsetSource: 'client',
    delayMs: 20_000,
    attempt: 1,
    more: false,
    intervalMs: 1000,
    n: seconds,
    marks: [],
    samples,
  };
}

function entry(userId: string, over: Partial<TelemetryEntry> = {}, at = T0 + 30_000): TelemetryEntry {
  return {
    at,
    userId,
    channelId: 'kanal',
    guildId: 'sunucu',
    platform: 'desktop',
    version: '0.9.4',
    windowSec: 30,
    quality: 'good',
    poorSec: 0,
    serverQuality: 'excellent',
    rttAvg: 30,
    rttMax: 45,
    jitterIn: 4,
    jitterOut: 3,
    lossOut: 0,
    lossIn: 0,
    concealed: 0,
    bitrateOut: 40_000,
    bitrateIn: 40_000,
    availableOut: null,
    candidate: 'host',
    protocol: 'udp',
    reconnects: 0,
    mic: null,
    screen: null,
    severity: 'ok',
    causes: [],
    ...over,
  };
}
const screen = { width: 1920, height: 1080, fps: 30, bitrate: 3_000_000, encoder: 'x', codec: 'video/H264', limitation: 'none' as const, limitedRatio: 0, hardware: true };
const watching = (freezes: number) => ({ codec: 'video/H264', decoder: 'x', hardware: true, powerEfficient: true, width: 1920, height: 1080, fps: 28, decodeMs: 3, decodeMsMax: 6, bitrate: 3e6, framesDropped: 0, freezes, freezeSec: freezes * 0.8, jitterBufferMs: 80, view: null });

describe('olay kayıtlarından kanıt', () => {
  it('kayıt yoksa null; temiz kayıtlarda bulgu yok', () => {
    expect(summarizeTraces([], T0, T0 + 60_000)).toBeNull();
    const e = summarizeTraces([trace('a', 40), trace('b', 40)], T0, T0 + 60_000)!;
    expect(e).toMatchObject({ traces: 2, users: ['a', 'b'], stun: null, stunSingle: null, burst: null, bwe: null, pliMax: 0, decoderFreezes: [], networkFreezes: [], lossOutAudioPct: 0, lossOutVideoPct: null });
  });

  it('STUN ≥2 kullanıcıda aynı saniyelerde yanıtsız: yol herkes için ölü; tek kullanıcıda yalnızca onun yolu', () => {
    const dead = (from: number, to: number) => (i: number) => (i >= from && i <= to ? { x: x({ su: (i - from + 1) * 1000 + 500, sr: 0 }) } : {});
    const both = summarizeTraces([trace('a', 40, dead(20, 23)), trace('b', 40, dead(21, 24)), trace('c', 40)], T0, T0 + 60_000)!;
    expect(both.stun!.users.sort()).toEqual(['a', 'b']);
    expect(both.stun!.maxMs).toBe(4_500);
    expect(both.stunSingle).toBeNull();
    const one = summarizeTraces([trace('a', 40, dead(20, 23)), trace('b', 40)], T0, T0 + 60_000)!;
    expect(one.stun).toBeNull();
    expect(one.stunSingle).toMatchObject({ userId: 'a', maxMs: 4_500 });
    // Dakikalar arayla (çakışmayan) yanıtsızlık "aynı anda" değildir
    expect(summarizeTraces([trace('a', 40, dead(5, 7)), trace('b', 40, dead(30, 32))], T0, T0 + 60_000)!.stun).toBeNull();
  });

  it('yayıncıdaki patlama (bit hızı sıçraması, anahtar/dev kare) ve ardından kayıp; PLI/NACK dalgası; BWE çöküşü', () => {
    const pub = trace(
      'yayinci',
      40,
      (i) => {
        if (i === 20) return { up: [{ k: 'mic', ps: 50, bs: 5_000, pl: 0, fl: 0 }, { k: 'scr', ps: 1400, bs: 1_500_000, pl: 0, fl: 0, kf: 1, hf: 2, nk: 0, pli: 0 }] };
        if (i >= 22 && i <= 25) return { x: x({ ao: 900_000 }), up: [{ k: 'mic', ps: 50, bs: 5_000, pl: 6, fl: 12 }, { k: 'scr', ps: 300, bs: 375_000, pl: 90, fl: 30, kf: 0, hf: 0, nk: 45, pli: 3, fir: 1 }] };
        return {};
      },
      'pub',
    );
    const e = summarizeTraces([pub], T0, T0 + 60_000)!;
    expect(e.burst).toMatchObject({ userId: 'yayinci', at: T0 + 21_000, bps: 12_000_000, baseBps: 3_000_000, keyFrames: 1, hugeFrames: 2, lossAt: T0 + 23_000, lossPct: 30 });
    expect(e.pliMax).toBe(4);
    expect(e.nackMax).toBe(45);
    expect(e.bwe).toMatchObject({ userId: 'yayinci', from: 4_000_000, to: 900_000, at: T0 + 23_000 });
    // Ses ve görüntü kaybı ayrı ayrı
    expect(e.lossOutAudioPct).toBe(1.2);
    expect(e.lossOutVideoPct).toBeCloseTo(2.7, 1);
  });

  it('taşıması temizken donan izleyici (çözücü) ile kayıpla donan izleyici ayrılır; gönderilen/alınan kabaca karşılaştırılır', () => {
    const dv = (over: object) => [{ i: 1, pr: 290, pl: 0, bs: 360_000, j: 15, fd: 30, kf: 0, fz: 0, fzd: 0, dr: 0, nk: 0, pli: 0, jb: 50, fps: 30, w: 1920, h: 1080, ...over }];
    const pub = trace('yayinci', 40, () => ({}), 'pub');
    const clean = trace('cozucu', 40, (i) => (i === 15 || i === 16 ? { dv: dv({ fz: 1, fzd: 800, fd: 4 }), lag: i === 15 ? 900 : 3 } : {}), 'view');
    const lossy = trace('hat', 40, (i) => (i === 20 ? { dv: dv({ pr: 150, pl: 140 }) } : i === 21 ? { dv: dv({ fz: 2, fzd: 1500 }) } : {}), 'view');
    const e = summarizeTraces([pub, clean, lossy], T0, T0 + 60_000)!;
    expect(e.decoderFreezes).toEqual([{ userId: 'cozucu', freezes: 2, ms: 1600 }]);
    expect(e.networkFreezes).toEqual([{ userId: 'hat', freezes: 2, ms: 1500 }]);
    expect(e.lagMax).toEqual({ userId: 'cozucu', ms: 900 });
    expect(e.lossInVideoPct).toBeGreaterThan(0);
    expect(e.sentReceived).toMatchObject({ publisher: 'yayinci', viewer: 'hat' });
    expect(e.sentReceived!.pct).toBeLessThan(100);
  });
});

describe('sınıflandırıcı: olay kayıtları kanıt olarak', () => {
  const dead = (from: number, to: number) => (i: number) => (i >= from && i <= to ? { x: x({ su: (i - from + 1) * 1000 + 500, sr: 0 }) } : {});

  it('kayıt yoksa eksik kanıt olarak yazılır (eski istemci); kayıt varsa yazılmaz', () => {
    const users = buildUsers([entry('a', { lossOut: 14 }), entry('b', { lossOut: 9 })]);
    const none = diagnose(users, null);
    expect(none.missing.join(' ')).toContain('İstemci olay kaydı yok');
    const some = diagnose(users, null, null, summarizeTraces([trace('a', 40)], T0, T0 + 60_000));
    expect(some.missing.join(' ')).not.toContain('İstemci olay kaydı yok');
    expect(some.missing.join(' ')).toContain('1 kullanıcıdan olay kaydı yok');
  });

  it('≥2 kullanıcıda eşzamanlı STUN yanıtsızlığı: sunucuda sonda kesintisi olmasa da sağlayıcı yolu', () => {
    const users = buildUsers([entry('a', { lossOut: 14 }), entry('b', {}), entry('c', { lossIn: 9 })]);
    const ev = summarizeTraces([trace('a', 40, dead(20, 23)), trace('b', 40, dead(20, 23)), trace('c', 40, dead(21, 23))], T0, T0 + 60_000);
    const d = diagnose(users, null, null, ev);
    expect(d).toMatchObject({ cause: 'saglayici_kesinti', segment: 'saglayici', confidence: 'yüksek' });
    expect(d.summary).toBe('Sorun: istemciler ↔ sunucu UDP yolu (barındırma sağlayıcısı) — 3 kullanıcının STUN yoklamaları aynı anda 4,5 sn yanıtsız kaldı');
    expect(d.evidence.join(' ')).toContain('medyadan bağımsız kanıt');
    expect(d.missing.join(' ')).toContain('dış sonda kesintisi kaydedilmedi');
    // Tek kullanıcının STUN'u yanıtsızsa sağlayıcı seçilmez; kanıtta "yalnızca bir kullanıcı" diye geçer
    const one = diagnose(buildUsers([entry('a', { lossOut: 14 }), entry('b', {})]), null, null, summarizeTraces([trace('a', 40, dead(20, 23)), trace('b', 40)], T0, T0 + 60_000));
    expect(one.cause).toBe('tek_kullanici');
    expect(one.evidence.join(' ')).toContain('yalnızca bir kullanıcının STUN yoklamaları 4,5 sn yanıtsız kaldı');
  });

  it('yayıncı patlaması, PLI dalgası, BWE çöküşü ve çözücü donması kanıt/etken olarak eklenir (nedeni tek başına değiştirmez)', () => {
    const pub = trace(
      'yayinci',
      40,
      (i) => {
        if (i === 20) return { up: [{ k: 'scr', ps: 1400, bs: 1_500_000, pl: 0, fl: 0, kf: 1, hf: 2 }] };
        if (i >= 22 && i <= 25) return { x: x({ ao: 900_000 }), up: [{ k: 'scr', ps: 300, bs: 375_000, pl: 90, fl: 30, nk: 45, pli: 4 }] };
        return {};
      },
      'pub',
    );
    const viewer = trace('i1', 40, (i) => (i === 30 ? { dv: [{ i: 1, pr: 290, pl: 0, bs: 360_000, j: 15, fd: 3, kf: 0, fz: 1, fzd: 900, dr: 0, nk: 0, pli: 0, jb: 50, fps: 30, w: 1920, h: 1080 }] } : {}), 'view');
    const users = buildUsers([entry('yayinci', { lossOut: 18, screen }), entry('i1', { lossIn: 12, watch: watching(3) })]);
    const d = diagnose(users, null, null, summarizeTraces([pub, viewer], T0, T0 + 60_000));
    expect(d.cause).toBe('yayinci_yukleme');
    const text = d.evidence.join(' ');
    expect(text).toContain("yayın bit hızı 3,0 → 12,0 Mbps'e sıçradı (1 anahtar kare, 2 dev kare); 2 sn sonra karşı tarafın bildirdiği kayıp %30'e yükseldi");
    expect(text).toContain('anahtar kare isteği (PLI/FIR) en çok 4,0/sn');
    expect(text).toContain("Bant genişliği tahmini 4,0 → 0,9 Mbps'e çöktü (kaybın sonucudur");
    expect(text).toContain('1 izleyici taşıması temizken dondu');
    expect(text).toContain('YAKLAŞIKTIR');
    expect(d.factors.join(' ')).toContain('patlama_sonrasi (yayıncı kaydı)');
  });
});

describe('olay kaydı isteme ve olaya ekleme', () => {
  it('olay açılınca kanaldan kayıt istenir (olay kimliğiyle, bir kez); kapanırken kayıtlar kanıta katılır', async () => {
    const asked: [string, string, string][] = [];
    const dead = (i: number) => (i >= 20 && i <= 23 ? { x: x({ su: (i - 19) * 1000 + 500 }) } : {});
    const store = [trace('a', 40, dead), trace('b', 40, dead)];
    const queries: { from: number; to: number; channelId?: string }[] = [];
    const done: string[] = [];
    const c = new FreezeCorrelator({
      dir: null,
      sampler: null,
      requestTraces: (channelId, reason, eventId) => void asked.push([channelId, reason, eventId]),
      traces: {
        window: async (q) => {
          queries.push(q);
          return { traces: store };
        },
      },
      onEvent: (e) => done.push(e.cause),
    });
    c.observe(entry('a', { lossOut: 15 }));
    c.observe(entry('b', { lossOut: 12 }));
    expect(asked).toHaveLength(1);
    expect(asked[0]![0]).toBe('kanal');
    c.sweep(T0 + 200_000);
    const [ev] = c.list(0);
    expect(asked[0]![2]).toBe(ev!.id);
    // Eşzamansız: önce kayıtsız sınıflanır, kayıtlar okununca yerinde güncellenir ve ancak o zaman bildirilir
    expect(ev!.cause).toBe('saglayici_gelen');
    expect(done).toEqual([]);
    await c.flushed();
    expect(queries).toEqual([{ from: ev!.start - 30_000, to: ev!.end + 10_000, channelId: 'kanal', limit: 60 }]);
    expect(ev!.cause).toBe('saglayici_kesinti');
    expect(ev!.traces).toMatchObject({ count: 2, users: ['a', 'b'] });
    expect(ev!.traces!.evidence.stun!.users).toHaveLength(2);
    expect(done).toEqual(['saglayici_kesinti']);
    // Kayıt kaynağı hata verirse olay yine kaydedilir
    const failing = new FreezeCorrelator({ dir: null, sampler: null, traces: { window: async () => Promise.reject(new Error('disk')) }, onEvent: (e) => done.push(`hata:${e.cause}`) });
    failing.observe(entry('a', { lossOut: 15 }));
    failing.observe(entry('b', { lossOut: 12 }));
    failing.sweep(T0 + 200_000);
    await failing.flushed();
    expect(done.at(-1)).toBe('hata:saglayici_gelen');
  });

  describe('sunucu bağlantıları', () => {
    let s: TestServer;
    beforeEach(async () => {
      s = await startServer();
    });
    afterEach(async () => {
      await s.close();
    });

    it('doğrulanmış kesinti kaydedilince içinde biri olan her ses kanalından kayıt istenir; aday için istenmez; donma olayı da ister', () => {
      const calls: [string, string, string | undefined][] = [];
      s.ctx.requestVoiceTraces = (channelId, reason, eventId) => {
        calls.push([channelId, reason, eventId]);
        return { eventId: eventId ?? 'x', channelId, users: 1, sessions: 0, throttled: false } satisfies TraceRequestResult;
      };
      const voice = s.channel('voice');
      // Seste kimse yokken kesinti: istek yok
      s.ctx.netSampler.addProbeOutage({ at: Date.now() - 5_000, durationMs: 1_500, lost: 6, targets: ['udp 1.1.1.1', 'tcp 8.8.8.8'], udp: true, tcp: true });
      expect(calls).toEqual([]);
      s.ctx.voice.join(s.owner.user.id, voice.id);
      const o = s.ctx.netSampler.addProbeOutage({ at: Date.now() - 60_000, durationMs: 1_500, lost: 6, targets: ['udp 1.1.1.1', 'tcp 8.8.8.8'], udp: true, tcp: true });
      expect(calls).toEqual([[voice.id, 'sunucu kesinti gördü', `kesinti-${o.id}`]]);
      // Doğrulanmamış NIC sessizliği (aday) istek göndermez
      const cand = s.ctx.netSampler.outages.addNic({ at: Date.now() - 200_000, durationMs: 2_000, rxpMin: 2, baseline: 40, participants: 1, probesLost: 0, txCollapsed: true });
      expect(cand.kind).toBe('aday');
      expect(calls).toHaveLength(1);
      // Donma olayı açılınca: olay kimliğiyle
      s.ctx.freeze.observe(entry('a', { lossOut: 15, channelId: voice.id }, Date.now()));
      expect(calls).toHaveLength(2);
      expect(calls[1]![0]).toBe(voice.id);
      expect(calls[1]![1]).toBe('yayın donması olayı');
      expect(calls[1]![2]).toMatch(/^[a-z0-9-]+$/);
    });
  });
});
