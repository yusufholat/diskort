import { describe, expect, it } from 'vitest';
import { parseTransportStats, type RtpStream, type TransportStats } from '../src/connectionStats';
import {
  createScreenAuto,
  describeScreenAuto,
  evenScale,
  measureScreen,
  planScreenEncoding,
  SCREEN_AUTO,
  screenAutoCeiling,
  stepScreenAuto,
  type ScreenAutoState,
  type ScreenMeasurement,
} from '../src/screenAuto';

const TICK = 2000;
const FHD = { width: 1920, height: 1080 };

const meas = (o: Partial<ScreenMeasurement> = {}): ScreenMeasurement => ({
  intervalMs: TICK,
  utilization: 0.95,
  encodedFps: 60,
  bitrate: 6_000_000,
  lossPercent: 0,
  rttMs: 20,
  availableOutgoingBitrate: 12_000_000,
  limitation: 'none',
  width: 1920,
  height: 1080,
  implementation: 'NVIDIA H.264 Encoder MFT',
  ...o,
});

/** Denetleyiciyi 2 saniyelik ölçümlerle çalıştırır; her adımdan sonraki durum döner */
function simulate(
  state: ScreenAutoState,
  start: number,
  samples: (ScreenMeasurement | null)[],
): { states: ScreenAutoState[]; end: number } {
  const states: ScreenAutoState[] = [];
  let s = state;
  let now = start;
  for (const m of samples) {
    now += TICK;
    s = stepScreenAuto(s, m, now);
    states.push(s);
  }
  return { states, end: now };
}

const repeat = <T>(n: number, v: T | ((i: number) => T)): T[] =>
  Array.from({ length: n }, (_, i) => (typeof v === 'function' ? (v as (i: number) => T)(i) : v));

describe('içerik algılama (hareketli / durağan)', () => {
  it('durağan ekranda 10 sn sonra netlik moduna geçer, daha önce geçmez', () => {
    const { states } = simulate(createScreenAuto(0), 0, repeat(6, meas({ utilization: 0.05 })));
    expect(states.slice(0, 4).every((s) => s.content === 'motion')).toBe(true);
    expect(states[4]!.content).toBe('static'); // 5. ölçüm, 10. saniye
    expect(states[4]!.contentSince).toBe(10_000);
  });

  it('hareket başlayınca 3/4 ölçümle ve en az 8 sn sonra akıcılık moduna döner', () => {
    const start = createScreenAuto(0, 'static');
    const { states } = simulate(start, 0, repeat(5, meas({ utilization: 0.95 })));
    expect(states[2]!.content).toBe('static'); // 6. sn: 3 oy var ama bekleme süresi dolmadı
    expect(states[3]!.content).toBe('motion'); // 8. sn
  });

  it('kısa hareket patlamaları (kaydırma) durağan modu bozmaz', () => {
    const start = createScreenAuto(0, 'static');
    // Her 4 ölçümde bir kaydırma: hedefi dolduran tek ölçüm
    const { states } = simulate(start, 0, repeat(30, (i) => meas({ utilization: i % 4 === 0 ? 0.9 : 0.1 })));
    expect(states.every((s) => s.content === 'static')).toBe(true);
  });

  it('kararsız içerikte (dönüşümlü) iki yöne de gidip gelmez', () => {
    for (const content of ['motion', 'static'] as const) {
      const { states } = simulate(createScreenAuto(0, content), 0, repeat(40, (i) => meas({ utilization: i % 2 ? 0.9 : 0.1 })));
      expect(states.every((s) => s.content === content)).toBe(true);
    }
  });

  it('orta düzey kullanım (0,4–0,7) kararı değiştirmez', () => {
    const { states } = simulate(createScreenAuto(0), 0, repeat(20, meas({ utilization: 0.55 })));
    expect(states.every((s) => s.content === 'motion')).toBe(true);
  });

  it('geçişten hemen sonraki geçici doluluk (anahtar kare) geri geçiş yaptırmaz', () => {
    const toStatic = simulate(createScreenAuto(0), 0, repeat(5, meas({ utilization: 0.03 })));
    expect(toStatic.states.at(-1)!.content).toBe('static');
    const after = simulate(toStatic.states.at(-1)!, toStatic.end, [0.9, 0.9, 0.9, 0.3, 0.3, 0.3].map((u) => meas({ utilization: u })));
    expect(after.states.every((s) => s.content === 'static')).toBe(true);
  });

  it('gerçek kayıt (Electron 44, NVENC H.264 High, 2560×1440 kaynak): her içerik doğru ve tek geçişle algılanır', () => {
    // Denetleyicinin kendi uyguladığı ayarlarla 2 sn aralıklarla ölçülen doluluk oranları
    const phases: [string, (number | null)[]][] = [
      ['motion', [null, 0.6, 0.87, 0.87, 1.03, 1.07, 0.99, 1, 1, 1.01, 0.95, 0.96]],
      ['static', [0.21, 0.03, 0.03, 0.03, 0.23, 0.76, 0.66, 0.35, 0.33, 0.33, 0.36, 0.35, 0.35, 0.35, 0.35]],
      ['motion', [1.35, 1.87, 1.63, 0.8, 0.95, 0.94, 0.94, 0.97, 0.96, 0.95]],
      ['static', [0.29, 0.03, 0.03, 0.03, 0.03, 0.82, 0.77, 0.34, 0.33, 0.34, 0.33, 0.33]],
    ];
    let state = createScreenAuto(0);
    let now = 0;
    let switches = 0;
    for (const [expected, utils] of phases) {
      for (const u of utils) {
        now += TICK;
        const next = stepScreenAuto(state, u === null ? null : meas({ utilization: u }), now);
        if (next.content !== state.content) switches++;
        state = next;
      }
      expect(state.content).toBe(expected);
    }
    expect(switches).toBe(3);
  });

  it('yayın duraklatılınca (ölçüm yok) durum korunur', () => {
    const s = createScreenAuto(0);
    expect(stepScreenAuto(s, null, 5000)).toBe(s);
  });
});

describe('ağa göre tavan', () => {
  it('kullanıcı bit hızı seçtiyse tavanın üst sınırı o olur (hareketli ve durağan içerikte)', () => {
    const start = createScreenAuto(0, 'motion', 15_000_000);
    expect(screenAutoCeiling(start)).toBe(15_000_000);
    const { states } = simulate(start, 0, repeat(10, meas()));
    expect(screenAutoCeiling(states.at(-1)!)).toBe(15_000_000);
    expect(planScreenEncoding(createScreenAuto(0, 'static', 15_000_000), FHD).maxBitrate).toBe(15_000_000);
    // Ağ bozulunca yine düşer, düzelince seçilen sınıra kadar çıkar
    const down = simulate(start, 0, repeat(3, meas({ lossPercent: 15 })));
    expect(screenAutoCeiling(down.states.at(-1)!)).toBeLessThan(15_000_000);
    const up = simulate(down.states.at(-1)!, down.end, repeat(60, meas()));
    expect(screenAutoCeiling(up.states.at(-1)!)).toBe(15_000_000);
  });

  it('ağ sakinken içeriğin üst sınırında kalır', () => {
    const { states } = simulate(createScreenAuto(0), 0, repeat(10, meas()));
    expect(screenAutoCeiling(states.at(-1)!)).toBe(SCREEN_AUTO.maxBitrate.motion);
  });

  it('ağır kayıpta %30 düşer, düşürmeler arasında bekler, alt sınırın altına inmez', () => {
    const lossy = meas({ lossPercent: 15 });
    const { states } = simulate(createScreenAuto(0), 0, repeat(30, lossy));
    expect(screenAutoCeiling(states[0]!)).toBe(5_600_000);
    expect(screenAutoCeiling(states[1]!)).toBe(5_600_000); // 4 sn geçmeden ikinci düşüş yok
    expect(screenAutoCeiling(states[2]!)).toBe(3_920_000);
    expect(screenAutoCeiling(states.at(-1)!)).toBe(SCREEN_AUTO.minBitrate);
  });

  it('orta kayıpta ve ping artışında (yükleme kuyruğu) %15 düşer', () => {
    const { states } = simulate(createScreenAuto(0), 0, [meas({ lossPercent: 4 })]);
    expect(screenAutoCeiling(states[0]!)).toBe(6_800_000);
    const base = simulate(createScreenAuto(0), 0, repeat(3, meas({ rttMs: 20 })));
    const { states: q } = simulate(base.states.at(-1)!, base.end, [meas({ rttMs: 220 })]);
    expect(screenAutoCeiling(q[0]!)).toBe(6_800_000);
    expect(q[0]!.lastChange).toContain('ping');
  });

  it('ağ düzelince yavaşça (%15 adımlarla) geri yükselir', () => {
    // Son ölçümde düşürüldü (2. ve 6. sn)
    const down = simulate(createScreenAuto(0), 0, repeat(3, meas({ lossPercent: 15 })));
    expect(down.states.at(-1)!.lastDecreaseAt).toBe(down.end);
    const low = screenAutoCeiling(down.states.at(-1)!);
    const { states } = simulate(down.states.at(-1)!, down.end, repeat(40, meas()));
    const ceilings = states.map(screenAutoCeiling);
    // İlk 10 sn yükselmez
    expect(ceilings.slice(0, 4).every((c) => c === low)).toBe(true);
    for (let i = 1; i < ceilings.length; i++) {
      expect(ceilings[i]!).toBeGreaterThanOrEqual(ceilings[i - 1]!);
      expect(ceilings[i]! / ceilings[i - 1]!).toBeLessThanOrEqual(SCREEN_AUTO.increaseFactor + 0.001);
    }
    expect(ceilings.at(-1)).toBe(SCREEN_AUTO.maxBitrate.motion);
  });

  it('yükleme hızı yetmeyince tavan tahmine yaklaşır (payla)', () => {
    const short = meas({ limitation: 'bandwidth', availableOutgoingBitrate: 3_000_000, utilization: 0.95 });
    const { states } = simulate(createScreenAuto(0), 0, repeat(20, short));
    expect(screenAutoCeiling(states[0]!)).toBe(SCREEN_AUTO.maxBitrate.motion); // tek ölçüm yetmez
    expect(screenAutoCeiling(states[1]!)).toBe(5_600_000); // adım başına en çok %30
    expect(screenAutoCeiling(states.at(-1)!)).toBe(3_600_000); // tahmin × 1,2
  });

  it('boşta duran yayında düşük bant tahmini tavanı düşürmez', () => {
    // Hareketsiz ekranda az veri gider; GCC tahmini de düşük kalır ama bu ağ sorunu değildir
    const idle = meas({ utilization: 0.05, availableOutgoingBitrate: 600_000, limitation: 'none' });
    const { states } = simulate(createScreenAuto(0), 0, repeat(20, idle));
    expect(states.at(-1)!.content).toBe('static');
    expect(screenAutoCeiling(states.at(-1)!)).toBe(SCREEN_AUTO.maxBitrate.static);
  });

  it('içerik değişince tavan yeni içeriğin sınırına kırpılır, ağ tahmini korunur', () => {
    const toStatic = simulate(createScreenAuto(0), 0, repeat(5, meas({ utilization: 0.05 })));
    expect(toStatic.states.at(-1)!.content).toBe('static');
    expect(screenAutoCeiling(toStatic.states.at(-1)!)).toBe(SCREEN_AUTO.maxBitrate.static);
    const back = simulate(toStatic.states.at(-1)!, toStatic.end, repeat(4, meas({ utilization: 0.95 })));
    expect(back.states.at(-1)!.content).toBe('motion');
    expect(screenAutoCeiling(back.states.at(-1)!)).toBe(SCREEN_AUTO.maxBitrate.motion);
  });
});

describe('işlemci kısıtı', () => {
  it('işlemci yetmeyince bit hızını değil çözünürlüğü/kare hızını düşürür', () => {
    const cpu = meas({ limitation: 'cpu' });
    const { states } = simulate(createScreenAuto(0), 0, repeat(12, cpu));
    // İlk basamak en erken 10. sn'de, ikincisi 10 sn sonra
    expect(states[3]!.cpuLevel).toBe(0);
    expect(states[4]!.cpuLevel).toBe(1);
    expect(states[9]!.cpuLevel).toBe(2);
    expect(states[11]!.cpuLevel).toBe(2); // en alt basamak
    expect(screenAutoCeiling(states.at(-1)!)).toBe(SCREEN_AUTO.maxBitrate.motion);
    const plan = planScreenEncoding(states[4]!, FHD);
    expect(plan.height).toBe(720);
    expect(plan.fps).toBe(60);
    expect(planScreenEncoding(states[9]!, FHD)).toMatchObject({ height: 720, fps: 30 });
  });

  it('sorun geçince 1 dk sonra geri yükselir; tekrar düşerse daha uzun bekler', () => {
    const cpu = meas({ limitation: 'cpu' });
    const down = simulate(createScreenAuto(0), 0, repeat(5, cpu));
    expect(down.states.at(-1)!.cpuLevel).toBe(1);
    const calm = simulate(down.states.at(-1)!, down.end, repeat(36, meas()));
    const upIndex = calm.states.findIndex((s) => s.cpuLevel === 0);
    expect((upIndex + 1) * TICK).toBe(SCREEN_AUTO.cpuRecoverMs);
    // İkinci kez düşünce geri yükselme 2 dk sürer
    const again = simulate(calm.states.at(-1)!, calm.end, repeat(2, cpu));
    expect(again.states.at(-1)!.cpuLevel).toBe(1);
    const calm2 = simulate(again.states.at(-1)!, again.end, repeat(70, meas()));
    const up2 = calm2.states.findIndex((s) => s.cpuLevel === 0);
    expect((up2 + 1) * TICK).toBe(SCREEN_AUTO.cpuRecoverMs * 2);
  });
});

describe('gönderici ayarları', () => {
  it('hareketli içerik: 1440p kaynak 1080p60 kodlanır', () => {
    const plan = planScreenEncoding(createScreenAuto(0), { width: 2560, height: 1440 });
    expect(plan).toMatchObject({
      contentHint: 'motion',
      degradationPreference: 'maintain-framerate',
      width: 1920,
      height: 1080,
      fps: 60,
      maxFramerate: 60,
      maxBitrate: 8_000_000,
    });
    expect(plan.scaleResolutionDownBy).toBeCloseTo(1440 / 1080, 2);
  });

  it('durağan içerik: kaynak çözünürlüğü korunur, kare hızı düşer', () => {
    const plan = planScreenEncoding(createScreenAuto(0, 'static'), { width: 2560, height: 1440 });
    expect(plan).toMatchObject({
      contentHint: 'detail',
      degradationPreference: 'maintain-resolution',
      scaleResolutionDownBy: 1,
      width: 2560,
      height: 1440,
      fps: 15,
      maxBitrate: 6_000_000,
    });
  });

  it('küçük pencere büyütülmez', () => {
    const plan = planScreenEncoding(createScreenAuto(0), { width: 1017, height: 601 });
    expect(plan).toMatchObject({ scaleResolutionDownBy: 1, width: 1017, height: 601 });
  });

  it('küçültülen görüntünün iki kenarı da çift sayıdır (donanım kodlayıcısı tek sayıda açılmıyor)', () => {
    const sources: [number, number][] = [
      [1920, 1080],
      [2560, 1440],
      [1366, 768],
      [1680, 1050],
      [3440, 1440],
      [2560, 1080],
      [1917, 1033],
      [1280, 1024],
      [3839, 2159],
    ];
    for (const [w, h] of sources) {
      for (const target of [1080, 720, 480]) {
        const scale = evenScale(w, h, target);
        if (h <= target) {
          expect(scale).toBe(1);
          continue;
        }
        const outW = Math.floor(w / scale);
        const outH = Math.floor(h / scale);
        expect(outW % 2, `${w}x${h} → ${target}: ${outW}x${outH}`).toBe(0);
        expect(outH % 2, `${w}x${h} → ${target}: ${outW}x${outH}`).toBe(0);
        expect(outH).toBeLessThanOrEqual(target);
        expect(outH).toBeGreaterThanOrEqual(target - 64);
      }
    }
    // 16:9'da tam hedef tutturulur
    expect(Math.floor(1280 / evenScale(1280, 720, 480))).toBe(850); // 853×480 yerine 850×478
    expect(Math.floor(1920 / evenScale(1920, 1080, 720))).toBe(1280);
  });

  it('bağlantı panelindeki özet', () => {
    const s = createScreenAuto(0);
    expect(describeScreenAuto(s, planScreenEncoding(s, FHD))).toBe('Otomatik — hareketli içerik, 1080p60, 8,0 Mbps tavan');
    const lossy = stepScreenAuto(s, meas({ lossPercent: 15 }), TICK);
    expect(describeScreenAuto(lossy, planScreenEncoding(lossy, FHD))).toBe(
      'Otomatik — hareketli içerik, 1080p60, 5,6 Mbps tavan (ağ sınırlı)',
    );
    const cpu = { ...s, cpuLevel: 1, content: 'static' as const };
    expect(describeScreenAuto(cpu, planScreenEncoding(cpu, FHD))).toBe(
      'Otomatik — durağan içerik, 1080p8, 6,0 Mbps tavan (işlemci sınırlı)',
    );
  });
});

// ---------- İstatistiklerden ölçüm ----------

const stream = (o: Partial<RtpStream>): RtpStream => ({
  id: 'out-f',
  direction: 'out',
  kind: 'video',
  trackId: 'screen',
  codec: 'video/H264',
  clockRate: 90000,
  channels: null,
  packets: 0,
  bytes: 0,
  packetsLost: 0,
  jitterMs: null,
  rttMs: 30,
  frameWidth: 1920,
  frameHeight: 1080,
  framesPerSecond: 60,
  implementation: null,
  qualityLimitationReason: 'none',
  rid: 'h',
  framesEncoded: 0,
  targetBitrate: 8_000_000,
  concealedSamples: null,
  totalSamplesReceived: null,
  ...o,
});

const transport = (at: number, streams: RtpStream[]): TransportStats => ({
  at,
  rttMs: 25,
  availableOutgoingBitrate: 9_000_000,
  availableIncomingBitrate: null,
  bytesSent: 0,
  bytesReceived: 0,
  local: null,
  remote: null,
  dtlsState: 'connected',
  tlsVersion: null,
  dtlsCipher: null,
  srtpCipher: null,
  streams,
});

describe('measureScreen', () => {
  const prev = transport(0, [
    stream({}),
    stream({ id: 'out-q', rid: 'q', frameWidth: 1280, frameHeight: 720, targetBitrate: 1_500_000 }),
    stream({ id: 'mic', kind: 'audio', trackId: 'mic', frameHeight: null }),
  ]);
  const curr = transport(2000, [
    // Üst katman 2 sn'de 1 MB (4 Mb/sn), hedef 8 Mb/sn → %50
    stream({ bytes: 1_000_000, packets: 900, packetsLost: 0, framesEncoded: 120 }),
    stream({ id: 'out-q', rid: 'q', frameWidth: 1280, frameHeight: 720, bytes: 250_000, packets: 100, packetsLost: 10, framesEncoded: 60 }),
    stream({ id: 'mic', kind: 'audio', trackId: 'mic', bytes: 16_000, packets: 100, frameHeight: null }),
  ]);

  it('üst katmanın doluluk oranı, tüm katmanların bit hızı ve kaybı', () => {
    const m = measureScreen(curr, prev, ['screen'], 8_000_000)!;
    expect(m.utilization).toBeCloseTo(0.5);
    expect(m.encodedFps).toBe(60);
    expect(m.bitrate).toBe(5_000_000);
    expect(m.lossPercent).toBeCloseTo(1); // 10 / 1000
    expect(m.height).toBe(1080);
    expect(m.rttMs).toBe(30);
    expect(m.availableOutgoingBitrate).toBe(9_000_000);
    expect(m.limitation).toBe('none');
  });

  it('hedef bilinmiyorsa tavana göre oran', () => {
    const noTarget = transport(2000, curr.streams.map((s) => ({ ...s, targetBitrate: null })));
    expect(measureScreen(noTarget, prev, ['screen'], 4_000_000)!.utilization).toBeCloseTo(1);
  });

  it('önceki ölçüm yoksa, yayın duraklatıldıysa ya da parça bulunamazsa null', () => {
    expect(measureScreen(curr, null, ['screen'], 8e6)).toBeNull();
    expect(measureScreen(curr, prev, ['baska'], 8e6)).toBeNull();
    expect(measureScreen(transport(2000, [stream({ bytes: 10 })]), prev, ['screen'], 8e6)).toBeNull();
  });

  it('getStats raporundan simulcast katmanı, kodlanan kare ve hedef okunur', () => {
    const report = new Map<string, unknown>([
      ['src', { id: 'src', type: 'media-source', kind: 'video', trackIdentifier: 'screen' }],
      [
        'o1',
        {
          id: 'o1',
          type: 'outbound-rtp',
          kind: 'video',
          mediaSourceId: 'src',
          rid: 'h',
          packetsSent: 10,
          bytesSent: 1000,
          framesEncoded: 42,
          targetBitrate: 7_500_000,
          qualityLimitationReason: 'cpu',
        },
      ],
    ]);
    const t = parseTransportStats(report, 1000)!;
    expect(t.streams[0]).toMatchObject({ rid: 'h', framesEncoded: 42, targetBitrate: 7_500_000, trackId: 'screen', qualityLimitationReason: 'cpu' });
  });
});
