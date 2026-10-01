import { describe, expect, it } from 'vitest';
import {
  VOICE_TRACE_MIN_GAP_MS,
  VOICE_TRACE_POST_MS,
  VOICE_TRACE_PRE_MS,
  VOICE_TRACE_RING_MS,
} from '@diskort/shared';
import { parseTraceTotals, VoiceTraceRecorder, type TraceCapture } from '../src/voiceTrace';
import { audioInState, screenState, traceReport, traceState, videoInState, type TraceState } from './fixtures/traceStats';

const T0 = 1_700_000_000_000;
const KINDS = { 'mic-track': 'mic', 'screen-track': 'scr' } as const;

/** Bağlantıyı saniye saniye yürütür: `tick` sağlıklı bir saniyenin sayaçlarını ekler, `step` ölçümü verir */
class Sim {
  captures: TraceCapture[] = [];
  at = T0;
  state: TraceState;
  private n = 0;
  rec = new VoiceTraceRecorder({ onCapture: (c) => this.captures.push(c), newId: () => `kesit-${++this.n}` });
  extra: { ice?: string; pc?: string; lk?: string; lagMs?: number | null; micUnderruns?: number | null } = {
    ice: 'connected',
    pc: 'connected',
    lk: 'excellent',
  };

  constructor(state: Partial<TraceState> = {}, private readonly intervalMs = 1000) {
    this.state = traceState(state);
    this.rec.start('kanal');
  }

  /** Sağlıklı bir saniye: STUN yanıtlanır, akışlar ilerler, kayıp yok */
  healthy(): void {
    const s = this.state;
    const k = this.intervalMs / 1000;
    s.requestsSent += 1;
    s.responsesReceived += 1;
    s.bytesSent += 400_000 * k;
    s.bytesReceived += 300_000 * k;
    if (s.mic) {
      s.mic.packets += 50 * k;
      s.mic.bytes += 5_000 * k;
    }
    if (s.screen) {
      s.screen.packets += 300 * k;
      s.screen.bytes += 375_000 * k;
      s.screen.framesEncoded += 30 * k;
      s.screen.framesSent += 30 * k;
      s.screen.encodeTime += 0.15 * k;
      s.screen.sendDelay += 0.05 * k;
    }
    if (s.audioIn) {
      s.audioIn.packets += 50 * k;
      s.audioIn.bytes += 5_000 * k;
      s.audioIn.samples += 48_000 * k;
    }
    if (s.videoIn) {
      s.videoIn.packets += 250 * k;
      s.videoIn.bytes += 300_000 * k;
      s.videoIn.framesDecoded += 30 * k;
      s.videoIn.bufferDelay += 1.5 * k;
      s.videoIn.bufferEmitted += 30 * k;
    }
  }

  /** Ölçümü kayda verir ve saati ilerletir */
  step(mutate?: (s: TraceState) => void): void {
    this.healthy();
    mutate?.(this.state);
    this.rec.sample({ at: this.at, reports: [traceReport(this.state)], kinds: KINDS, ...this.extra });
    this.at += this.intervalMs;
  }

  run(count: number, mutate?: (s: TraceState) => void): void {
    for (let i = 0; i < count; i++) this.step(mutate);
  }
}

describe('raporun okunması ve farklar', () => {
  it('giden görüntünün kodlayıcı sayaçları, STUN ve taşıma farkları kayda girer', () => {
    const sim = new Sim({ screen: screenState() });
    sim.step();
    sim.step((s) => {
      s.screen!.keyFrames += 1;
      s.screen!.hugeFrames += 2;
      s.screen!.nack += 7;
      s.screen!.pli += 1;
      s.screen!.retransBytes += 12_000;
      s.screen!.retransPackets += 10;
      s.screen!.lost += 3;
      s.screen!.limitation = 'bandwidth';
      s.discardedOnSend += 4;
    });
    sim.rec.requestCapture(sim.at, 'olay-1', 'deneme');
    sim.step();
    expect(sim.captures).toHaveLength(1);
    const [first] = sim.captures[0]!.samples;
    expect(first).toMatchObject({ q: 1, t: T0 + 1000, dt: 1000 });
    expect(first!.x).toMatchObject({ pi: 1, rtt: 40, sq: 1, sr: 1, su: 0, ao: 4_000_000, bs: 400_000, br: 300_000, pd: 4, ice: 'connected', pc: 'connected', lk: 'excellent', ct: 'srflx', pr: 'udp' });
    const screen = first!.up.find((u) => u.k === 'scr')!;
    expect(screen).toMatchObject({
      ps: 300,
      bs: 375_000,
      pl: 3,
      fl: 10,
      rtt: 50,
      tb: 3_000_000,
      fe: 30,
      fs: 30,
      kf: 1,
      hf: 2,
      nk: 7,
      pli: 1,
      fir: 0,
      rb: 12_000,
      rp: 10,
      ql: 'bandwidth',
      w: 1920,
      h: 1080,
      fps: 30,
      em: 5,
      sd: 50,
    });
    const mic = first!.up.find((u) => u.k === 'mic')!;
    expect(mic).toMatchObject({ ps: 50, bs: 5_000, pl: 0 });
    // Yalnızca görüntüye özgü alanlar seste yok
    expect(mic.tb).toBeUndefined();
  });

  it('gelen ses ve görüntü ayrı kaydedilir; donma, anahtar kare ve gizleme farkları', () => {
    const sim = new Sim({ audioIn: audioInState(), videoIn: videoInState() });
    sim.step();
    sim.step((s) => {
      s.audioIn!.lost += 5;
      s.audioIn!.concealed += 4_800;
      s.audioIn!.silent += 800;
      s.audioIn!.events += 3;
      s.videoIn!.lost += 9;
      s.videoIn!.keyFrames += 1;
      s.videoIn!.freezes += 1;
      s.videoIn!.freezeSec += 0.2;
      s.videoIn!.dropped += 2;
      s.videoIn!.nack += 6;
      s.videoIn!.pli += 1;
    });
    sim.rec.requestCapture(sim.at, 'olay-1', 'deneme');
    sim.step();
    const [first] = sim.captures[0]!.samples;
    expect(first!.da).toEqual({ n: 1, pr: 50, pl: 5, bs: 5_000, j: 12, ss: 48_000, cs: 4_000, ce: 3 });
    expect(first!.dv).toEqual([
      { i: 1, pr: 250, pl: 9, bs: 300_000, j: 20, fd: 30, kf: 1, fz: 1, fzd: 200, dr: 2, pdc: null, nk: 6, pli: 1, jb: 50, fps: 30, w: 1920, h: 1080 },
    ]);
  });

  it('kayıtta adres ya da aday kimliği yoktur', () => {
    const sim = new Sim({ screen: screenState(), audioIn: audioInState(), videoIn: videoInState() });
    sim.run(5);
    sim.rec.requestCapture(sim.at, 'olay-1', 'deneme');
    sim.step();
    const text = JSON.stringify(sim.captures[0]);
    for (const secret of ['192.168.1.20', '203.0.113.7', 'CPabc_def', 'Iabc', 'Idef', '54321', 'mic-track', 'screen-track']) {
      expect(text).not.toContain(secret);
    }
  });

  it('aday çifti değişince sıra numarası artar ve işaretlenir', () => {
    const sim = new Sim();
    sim.run(3);
    sim.step((s) => {
      s.pairId = 'CPyeni_cift';
    });
    sim.step();
    sim.rec.requestCapture(sim.at, 'olay-1', 'deneme');
    sim.step();
    const xs = sim.captures[0]!.samples.map((s) => s.x!);
    expect(xs.map((x) => x.pi)).toEqual([1, 1, 2, 2, 2]);
    expect(xs.map((x) => x.pch ?? 0)).toEqual([0, 0, 1, 0, 0]);
    // Çift değiştiği ölçümde farklar alınamaz
    expect(xs[2]).toMatchObject({ bs: null, br: null, sq: null });
  });

  it('iki bağlantının raporu birleştirilir: aday çifti ilkinden, gelen akışlar ikincisinden', () => {
    const pub = traceReport(traceState());
    const sub = traceReport(traceState({ mic: null, videoIn: videoInState(), pairId: 'CPsub' }));
    const totals = parseTraceTotals([pub, sub]);
    expect(totals.pair?.id).toBe('CPabc_def');
    expect(totals.out.map((s) => s.id)).toEqual(['OTA1']);
    expect(totals.in.map((s) => s.id)).toEqual(['1:ITV6']);
  });

  it('JS takılması ve mikrofon tamponu boşalmaları kayda girer; çok kısa aralıklı ölçüm atlanır', () => {
    const sim = new Sim();
    sim.extra = { ...sim.extra, lagMs: 12.4, micUnderruns: 5 };
    sim.step();
    sim.extra = { ...sim.extra, lagMs: 340.6, micUnderruns: 8 };
    sim.step();
    // Panel açılınca anında alınan ölçüm: kaydedilmez
    sim.rec.sample({ at: sim.at - 900, reports: [traceReport(sim.state)] });
    expect(sim.rec.size).toBe(1);
    sim.rec.requestCapture(sim.at, 'olay-1', 'deneme');
    sim.step();
    expect(sim.captures[0]!.samples[0]).toMatchObject({ lag: 341, un: 3 });
  });
});

describe('halka tampon', () => {
  it('120 saniyeden eski ölçümler düşer', () => {
    const sim = new Sim();
    sim.run(200);
    expect(sim.rec.size).toBe(VOICE_TRACE_RING_MS / 1000 + 1);
    sim.rec.requestCapture(sim.at, 'olay-1', 'deneme');
    sim.step();
    const samples = sim.captures[0]!.samples;
    expect(samples.at(-1)!.t - samples[0]!.t).toBeLessThanOrEqual(VOICE_TRACE_RING_MS);
    // Sıra numaraları kesintisiz
    expect(samples.every((s, i) => i === 0 || s.q === samples[i - 1]!.q + 1)).toBe(true);
  });

  it('uzun boşluktan (uyku) sonra farklar yeniden başlar: dev fark kaydedilmez', () => {
    const sim = new Sim();
    sim.run(3);
    sim.at += 60_000;
    sim.step();
    sim.step();
    sim.rec.requestCapture(sim.at, 'olay-1', 'deneme');
    sim.step();
    expect(sim.captures[0]!.samples.every((s) => s.dt === 1000)).toBe(true);
  });
});

describe('tetikleyiciler', () => {
  it('giden kayıp art arda iki saniye %5 üstündeyse tetiklenir; tek saniyelik kayıp tetiklemez', () => {
    const single = new Sim({ screen: screenState() });
    single.run(5);
    single.step((s) => (s.screen!.lost += 40));
    single.run(40);
    expect(single.captures).toHaveLength(0);

    const sim = new Sim({ screen: screenState() });
    sim.run(5);
    sim.run(2, (s) => (s.screen!.lost += 40));
    const triggerAt = sim.at - 1000;
    sim.run(VOICE_TRACE_POST_MS / 1000 - 1);
    expect(sim.captures).toHaveLength(0);
    sim.step();
    expect(sim.captures).toHaveLength(1);
    const c = sim.captures[0]!;
    expect(c).toMatchObject({ reason: 'loss-out', reasons: ['loss-out'], eventId: null, triggerAt, channelId: 'kanal', more: false });
    expect(c.marks).toEqual([{ t: triggerAt, l: 'trigger:loss-out' }]);
    // Tetiklemeden önceki ölçümler de kesitte
    expect(c.samples[0]!.t).toBe(T0 + 1000);
    expect(c.samples.at(-1)!.t).toBe(triggerAt + VOICE_TRACE_POST_MS);
  });

  it('STUN yanıtsız kalınca tetiklenir ve ping eski sayılır; yanıt gelince sıfırlanır', () => {
    const sim = new Sim();
    sim.run(5);
    expect(sim.rec.pingStaleMs).toBe(0);
    // İstekler gidiyor, yanıt yok (currentRoundTripTime eski değerinde kalır)
    const lost = (s: TraceState): void => {
      s.responsesReceived -= 1;
    };
    sim.step(lost);
    expect(sim.rec.pingStaleMs).toBe(0);
    sim.step(lost);
    expect(sim.rec.pingStaleMs).toBe(1000);
    sim.step(lost);
    expect(sim.rec.pingStaleMs).toBe(2000);
    sim.step(lost);
    expect(sim.rec.pingStaleMs).toBe(3000);
    sim.step();
    expect(sim.rec.pingStaleMs).toBe(0);
    sim.run(VOICE_TRACE_POST_MS / 1000 + 2);
    expect(sim.captures).toHaveLength(1);
    expect(sim.captures[0]!.reason).toBe('stun');
    const su = sim.captures[0]!.samples.map((s) => s.x!.su);
    expect(Math.max(...su)).toBe(3000);
  });

  it('bant genişliği tahmini yayındayken son 10 saniyenin ortancasının yarısının altına düşerse tetiklenir', () => {
    const idle = new Sim();
    idle.run(12);
    idle.run(3, (s) => (s.availableOut = 900_000));
    idle.run(30);
    // Yayında değilken tetiklenmez
    expect(idle.captures).toHaveLength(0);

    const sim = new Sim({ screen: screenState() });
    sim.run(12);
    sim.step((s) => (s.availableOut = 1_500_000));
    // Tahmin düşük kaldıkça (ortanca yetişene dek ~5 sn) koşul sürer ve gönderim ertelenir
    sim.run(VOICE_TRACE_POST_MS / 1000 + 8);
    expect(sim.captures).toHaveLength(1);
    expect(sim.captures[0]!.reason).toBe('bwe');
  });

  it('izlenen yayın donunca tetiklenir: donma sayacı ya da paket gelirken çözülmeyen kare', () => {
    const counted = new Sim({ videoIn: videoInState() });
    counted.run(5);
    counted.step((s) => {
      s.videoIn!.freezes += 1;
      s.videoIn!.freezeSec += 1.2;
    });
    counted.run(VOICE_TRACE_POST_MS / 1000 + 1);
    expect(counted.captures.map((c) => c.reason)).toEqual(['freeze']);

    const stalled = new Sim({ videoIn: videoInState() });
    stalled.run(5);
    // Paketler geliyor ama kare çözülmüyor (anahtar kare bekleniyor)
    stalled.step((s) => (s.videoIn!.framesDecoded -= 30));
    stalled.run(VOICE_TRACE_POST_MS / 1000 + 1);
    expect(stalled.captures.map((c) => c.reason)).toEqual(['freeze']);

    // Duran yayın (paket de gelmiyor, kare de yok): donma sayılmaz
    const paused = new Sim({ videoIn: videoInState() });
    paused.run(5);
    paused.run(40, (s) => {
      s.videoIn!.framesDecoded -= 30;
      s.videoIn!.packets -= 250;
      s.videoIn!.bytes -= 300_000;
      s.videoIn!.bufferEmitted -= 30;
    });
    expect(paused.captures).toHaveLength(0);
  });

  it('gelen akış tümüyle kesilince (veri gelirken iki saniye sıfır bayt, STUN yanıtsız) tetiklenir; boş odada tetiklenmez', () => {
    const sim = new Sim({ videoIn: videoInState() });
    sim.run(5);
    sim.run(3, (s) => {
      s.responsesReceived -= 1;
      s.bytesReceived -= 300_000;
      s.videoIn!.packets -= 250;
      s.videoIn!.bytes -= 300_000;
      s.videoIn!.framesDecoded -= 30;
      s.videoIn!.bufferEmitted -= 30;
    });
    sim.run(VOICE_TRACE_POST_MS / 1000 + 1);
    expect(sim.captures).toHaveLength(1);
    expect(sim.captures[0]!.reasons).toContain('blackout');

    // Boş oda: yalnızca ara sıra STUN yanıtı gelir (düşük hız), aradaki sıfırlar kesinti değildir
    const empty = new Sim({ mic: null });
    let n = 0;
    empty.run(60, (s) => {
      s.bytesReceived -= 300_000;
      if (n++ % 3 === 0) s.bytesReceived += 120;
    });
    expect(empty.captures).toHaveLength(0);
  });

  it('gelen seste gizleme patlaması iki saniye sürerse tetiklenir; sessizlikteki gizleme sayılmaz', () => {
    const silent = new Sim({ audioIn: audioInState() });
    silent.run(5);
    silent.run(10, (s) => {
      s.audioIn!.concealed += 40_000;
      s.audioIn!.silent += 40_000;
    });
    silent.run(30);
    expect(silent.captures).toHaveLength(0);

    const sim = new Sim({ audioIn: audioInState() });
    sim.run(5);
    sim.run(2, (s) => (s.audioIn!.concealed += 20_000));
    sim.run(VOICE_TRACE_POST_MS / 1000);
    expect(sim.captures.map((c) => c.reason)).toEqual(['conceal']);
  });

  it('bağlantı "connected" durumundan çıkınca ve yeniden bağlanma işaretinde tetiklenir', () => {
    const sim = new Sim();
    sim.run(5);
    sim.extra = { ice: 'disconnected', pc: 'disconnected', lk: 'lost' };
    sim.run(2);
    sim.extra = { ice: 'connected', pc: 'connected', lk: 'good' };
    sim.run(VOICE_TRACE_POST_MS / 1000 + 1);
    expect(sim.captures.map((c) => c.reason)).toEqual(['state']);

    const marked = new Sim();
    marked.run(5);
    marked.rec.mark(marked.at - 500, 'reconnecting', 'reconnect');
    marked.rec.mark(marked.at + 2500, 'reconnected');
    marked.run(VOICE_TRACE_POST_MS / 1000 + 1);
    expect(marked.captures).toHaveLength(1);
    expect(marked.captures[0]!.reason).toBe('reconnect');
    expect(marked.captures[0]!.marks.map((m) => m.l)).toEqual(['reconnecting', 'reconnected']);
  });

  it('sorun sürdükçe gönderim ertelenir, tetiklemeden 60 sn sonra kesilir ve devamı işaretlenir', () => {
    const sim = new Sim({ screen: screenState() });
    sim.run(30);
    const lossy = (s: TraceState): void => {
      s.screen!.lost += 40;
    };
    sim.run(2, lossy);
    const triggerAt = sim.at - 1000;
    sim.run(200, lossy);
    const first = sim.captures[0]!;
    expect(first.triggerAt).toBe(triggerAt);
    expect(first.more).toBe(true);
    // Tetiklemeden önceki halka (en çok 60 sn) + tetiklemeden sonraki 60 sn
    expect(first.samples[0]!.t).toBe(T0 + 1000);
    expect(first.samples.at(-1)!.t).toBe(triggerAt + (VOICE_TRACE_RING_MS - VOICE_TRACE_PRE_MS));
    // Sonraki kesitler en az 60 sn arayla gelir ve ölçümler yinelenmez
    expect(sim.captures.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < sim.captures.length; i++) {
      const prev = sim.captures[i - 1]!;
      const next = sim.captures[i]!;
      expect(next.samples.at(-1)!.t - prev.samples.at(-1)!.t).toBeGreaterThanOrEqual(VOICE_TRACE_MIN_GAP_MS);
      expect(next.samples[0]!.q).toBe(prev.samples.at(-1)!.q + 1);
    }
  });

  it('sesten ayrılınca bekleyen kesit o ana kadarki ölçümlerle verilir', () => {
    const sim = new Sim({ screen: screenState() });
    sim.run(10);
    sim.run(2, (s) => (s.screen!.lost += 40));
    sim.run(3);
    expect(sim.captures).toHaveLength(0);
    sim.rec.stop(sim.at);
    expect(sim.captures).toHaveLength(1);
    expect(sim.captures[0]!.samples).toHaveLength(14);
    // Ayrıldıktan sonra ölçüm ve istek kabul edilmez
    expect(sim.rec.requestCapture(sim.at, 'olay-9', 'deneme')).toBe(false);
    sim.step();
    expect(sim.rec.size).toBe(0);
  });
});

describe('sunucu isteği', () => {
  it('halkadaki ölçümlerin tamamı bir sonraki ölçümde, isteğin kimliğiyle verilir', () => {
    const sim = new Sim();
    sim.run(90);
    expect(sim.rec.requestCapture(sim.at, 'olay-1', 'yayın dondu', 'kanal')).toBe(true);
    expect(sim.captures).toHaveLength(0);
    sim.step();
    expect(sim.captures).toHaveLength(1);
    const c = sim.captures[0]!;
    expect(c).toMatchObject({ reason: 'request', eventId: 'olay-1', more: false, intervalMs: 1000 });
    expect(c.samples).toHaveLength(90);
    expect(c.marks).toEqual([{ t: sim.at - 1000, l: 'request:yayın dondu' }]);
  });

  it('aynı istek, başka kanalın isteği ve çok sık istek yok sayılır; ölçümler yinelenmez', () => {
    const sim = new Sim();
    sim.run(20);
    expect(sim.rec.requestCapture(sim.at, 'olay-x', 'deneme', 'başka-kanal')).toBe(false);
    expect(sim.rec.requestCapture(sim.at, 'olay-1', 'deneme')).toBe(true);
    expect(sim.rec.requestCapture(sim.at, 'olay-1', 'deneme')).toBe(false);
    sim.step();
    sim.run(3);
    // 10 sn dolmadan gelen yeni istek
    expect(sim.rec.requestCapture(sim.at, 'olay-2', 'deneme')).toBe(false);
    sim.run(10);
    expect(sim.rec.requestCapture(sim.at, 'olay-3', 'deneme')).toBe(true);
    sim.step();
    expect(sim.captures.map((c) => c.eventId)).toEqual(['olay-1', 'olay-3']);
    expect(sim.captures[1]!.samples[0]!.q).toBe(sim.captures[0]!.samples.at(-1)!.q + 1);
  });

  it('istek, kendi tetiklemesini beklerken gelirse ikisi de gönderilir (ölçümler yinelenmeden)', () => {
    const sim = new Sim({ screen: screenState() });
    sim.run(10);
    sim.run(2, (s) => (s.screen!.lost += 40));
    sim.run(5);
    sim.rec.requestCapture(sim.at, 'olay-1', 'yayın dondu');
    sim.step();
    expect(sim.captures).toHaveLength(1);
    expect(sim.captures[0]).toMatchObject({ reason: 'request', eventId: 'olay-1' });
    expect(sim.captures[0]!.reasons).toEqual(['request', 'loss-out']);
    sim.run(VOICE_TRACE_POST_MS / 1000);
    expect(sim.captures).toHaveLength(2);
    expect(sim.captures[1]).toMatchObject({ reason: 'loss-out', eventId: null });
    expect(sim.captures[1]!.samples[0]!.q).toBe(sim.captures[0]!.samples.at(-1)!.q + 1);
  });
});

describe('telefon (2 saniyelik ölçüm)', () => {
  it('tek 2 saniyelik ölçüm hiçbir "süren" tetikleyiciyi çalıştırmaz; art arda iki ölçüm çalıştırır', () => {
    // Giden kayıp
    const single = new Sim({ screen: screenState() }, 2000);
    single.run(5);
    single.step((s) => (s.screen!.lost += 80));
    single.run(30);
    expect(single.captures).toHaveLength(0);

    const sim = new Sim({ screen: screenState() }, 2000);
    sim.run(5);
    sim.run(2, (s) => (s.screen!.lost += 80));
    sim.run(VOICE_TRACE_POST_MS / 2000);
    expect(sim.captures).toHaveLength(1);
    expect(sim.captures[0]).toMatchObject({ reason: 'loss-out', intervalMs: 2000 });
    expect(sim.captures[0]!.samples.every((s) => s.dt === 2000)).toBe(true);

    // Gizleme patlaması: tek ölçüm yetmez
    const conceal = new Sim({ audioIn: audioInState() }, 2000);
    conceal.run(5);
    conceal.step((s) => (s.audioIn!.concealed += 40_000));
    conceal.run(30);
    expect(conceal.captures).toHaveLength(0);
    conceal.run(2, (s) => (s.audioIn!.concealed += 40_000));
    conceal.run(VOICE_TRACE_POST_MS / 2000);
    expect(conceal.captures.map((c) => c.reason)).toEqual(['conceal']);

    // Gelen akış kesintisi: tek ölçüm yetmez
    const dead = (s: TraceState): void => {
      s.responsesReceived -= 1;
      s.bytesReceived -= 600_000;
      s.videoIn!.packets -= 500;
      s.videoIn!.bytes -= 600_000;
      s.videoIn!.framesDecoded -= 60;
      s.videoIn!.bufferEmitted -= 60;
    };
    const blip = new Sim({ videoIn: videoInState() }, 2000);
    blip.run(5);
    blip.step(dead);
    blip.run(30);
    expect(blip.captures.flatMap((c) => c.reasons)).not.toContain('blackout');
  });
});

describe('giden kayıp: alıcı raporları ve susan mikrofon', () => {
  /** Mikrofon: `pps` paket/sn gönderir; alıcı raporu `every` ölçümde bir gelir ve `lost` kayıp taşır */
  function micSim(pps: number, every: number, lost: (report: number) => number, seconds: number): Sim {
    const sim = new Sim({ mic: { packets: 1000, bytes: 100_000, lost: 0, reportAt: 1 } });
    let n = 0;
    let reports = 0;
    sim.run(seconds, (s) => {
      // healthy() saniyede 50 paket ekler: istenen hıza çekilir
      s.mic!.packets += pps - 50;
      if (++n % every === 0) {
        s.mic!.lost += lost(reports++);
        s.mic!.reportAt = sim.at;
      }
    });
    return sim;
  }

  it('susan (DTX) mikrofon: birkaç paketin kaybı büyük yüzde verse de tetiklemez', () => {
    // Saniyede 3 paket, her saniye rapor, her raporda 2 kayıp (%67)
    expect(micSim(3, 1, () => 2, 90).captures).toHaveLength(0);
    // Seyrek rapor (5 sn'de bir, 15 paketin 3'ü): yine paket sayısı eşiğin altında
    expect(micSim(3, 5, () => 3, 90).captures).toHaveLength(0);
  });

  it('konuşmanın ardından susan mikrofona gelen gecikmiş rapor (önceki konuşmanın kayıpları) tetiklemez', () => {
    const sim = new Sim({ mic: { packets: 1000, bytes: 100_000, lost: 0, reportAt: 1 } });
    const report = (lost: number) => (s: TraceState) => {
      s.mic!.lost += lost;
      s.mic!.reportAt = sim.at;
    };
    // Konuşma (50 paket/sn, kayıpsız raporlar), sonra sessizlik (5 paket/sn) ve 2 kayıplı iki rapor
    sim.run(10, report(0));
    for (let i = 0; i < 2; i++) {
      sim.step((s) => {
        s.mic!.packets -= 45;
        report(2)(s);
      });
    }
    sim.run(40, (s) => {
      s.mic!.packets -= 45;
      report(0)(s);
    });
    expect(sim.captures).toHaveLength(0);
  });

  it('gerçek %10 ses kaybı seyrek raporlarla (3 sn\'de bir) tetikler; tek kötü rapor tetiklemez', () => {
    // 3 sn'de 150 paket, 15 kayıp: ikinci kötü raporda tetiklenir
    // (kayıp sürdükçe gönderim ertelenir: tetiklemeden 60 sn sonra kesilir)
    const sim = micSim(50, 3, () => 15, 75);
    expect(sim.captures.length).toBeGreaterThanOrEqual(1);
    expect(sim.captures[0]).toMatchObject({ reason: 'loss-out' });
    expect(sim.captures[0]!.triggerAt).toBe(T0 + 5_000);
    // Rapor gelmeyen ölçümlerde rr 0, gelenlerde 1
    const rr = sim.captures[0]!.samples.slice(0, 6).map((s) => s.up[0]!.rr);
    expect(rr).toEqual([0, 1, 0, 0, 1, 0]);

    // Tek kötü rapor, sonrası temiz
    expect(micSim(50, 3, (r) => (r === 2 ? 15 : 0), 60).captures).toHaveLength(0);
    // Kötü raporlar arasında temiz rapor varsa "art arda" sayılmaz
    expect(micSim(50, 3, (r) => (r % 2 === 0 ? 15 : 0), 60).captures).toHaveLength(0);
  });
});

describe('gelen akış kesintisi: sessizleşen oda', () => {
  it('herkes susunca (ortam paketi yok, STUN yanıtlanıyor) tetiklenmez; hız tahmini söner', () => {
    const sim = new Sim({ videoIn: videoInState(), audioIn: audioInState() });
    sim.run(10);
    // Yayın ve ses durdu: hiç bayt gelmiyor, STUN isteği de gitmiyor (yanıtsız istek yok)
    const quiet = (s: TraceState): void => {
      s.requestsSent -= 1;
      s.responsesReceived -= 1;
      s.bytesReceived -= 300_000;
      s.videoIn!.packets -= 250;
      s.videoIn!.bytes -= 300_000;
      s.videoIn!.framesDecoded -= 30;
      s.videoIn!.bufferEmitted -= 30;
      s.audioIn!.packets -= 50;
      s.audioIn!.bytes -= 5_000;
      s.audioIn!.samples -= 48_000;
    };
    sim.run(20, quiet);
    // Uzun sessizlikten sonra STUN yanıtsız kalsa da "gelen akış kesildi" denmez (kesilecek akış yoktu)
    sim.run(4, (s) => {
      quiet(s);
      s.requestsSent += 1;
    });
    sim.run(VOICE_TRACE_POST_MS / 1000 + 5);
    expect(sim.captures.flatMap((c) => c.reasons)).not.toContain('blackout');
    expect(sim.captures.flatMap((c) => c.reasons)).toContain('stun');
  });
});
