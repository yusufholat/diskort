import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceTelemetryReport } from '@diskort/shared';
import { configureClient, type KeyValueStorage } from '../src';
import type { RtpStream, TransportStats } from '../src/connectionStats';
import { useSession } from '../src/session';
import {
  inboundAudioDelta,
  LoopLagMeter,
  summarizeLag,
  VoiceTelemetry,
  volumeSummary,
  watchedVideo,
} from '../src/voiceTelemetry';

const memory = new Map<string, string>();
const storage: KeyValueStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

const stream = (over: Partial<RtpStream>): RtpStream => ({
  id: 'a',
  direction: 'out',
  kind: 'audio',
  trackId: null,
  codec: 'audio/opus',
  clockRate: 48000,
  channels: 2,
  packets: 0,
  bytes: 0,
  packetsLost: 0,
  jitterMs: null,
  rttMs: null,
  frameWidth: null,
  frameHeight: null,
  framesPerSecond: null,
  implementation: null,
  qualityLimitationReason: null,
  concealedSamples: null,
  totalSamplesReceived: null,
  video: null,
  ...over,
});

const transport = (at: number, over: Partial<TransportStats>): TransportStats => ({
  at,
  rttMs: null,
  availableOutgoingBitrate: null,
  availableIncomingBitrate: null,
  bytesSent: 0,
  bytesReceived: 0,
  local: { candidateType: 'relay', protocol: 'udp', relayProtocol: 'tls', address: '10.0.0.1', port: 1, networkType: null },
  remote: null,
  dtlsState: null,
  tlsVersion: null,
  dtlsCipher: null,
  srtpCipher: null,
  streams: [],
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
const sent = (): VoiceTelemetryReport[] =>
  fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string) as VoiceTelemetryReport);

beforeEach(async () => {
  memory.clear();
  await configureClient({
    platform: 'desktop',
    version: '0.7.0',
    storage,
    serverUrl: () => 'http://sunucu.test',
    notifyError: () => undefined,
  });
  useSession.getState().setSession('jeton', { id: 'u1', username: 'ben', displayName: 'Ben', avatarColor: '#fff', avatarUrl: null, isAdmin: false });
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 2 sn aralıklı ölçümler: giden ses 50 paket/sn, `lostEvery` ölçümde bir 10 paket kayıp */
function feed(t: VoiceTelemetry, count: number, opts: { start?: number; rtt?: number; quality?: 'good' | 'poor'; screen?: boolean } = {}): void {
  let prev: TransportStats | null = null;
  const start = opts.start ?? 1_000_000;
  for (let i = 0; i < count; i++) {
    const at = start + i * 2000;
    const streams = [stream({ id: 'mic', packets: i * 100, bytes: i * 8000, packetsLost: i * 2, jitterMs: 4 })];
    if (opts.screen) {
      streams.push(
        stream({
          id: 'ekran',
          kind: 'video',
          codec: 'video/H264',
          packets: i * 500,
          bytes: i * 1_500_000,
          frameWidth: 1920,
          frameHeight: 1080,
          framesPerSecond: 58,
          implementation: 'NvEnc',
          qualityLimitationReason: i % 2 ? 'cpu' : 'none',
        }),
      );
    }
    const pub = transport(at, { rttMs: opts.rtt ?? 30, bytesSent: i * 1_508_000, availableOutgoingBitrate: 20_000_000, streams });
    const sub =
      i % 5 === 0
        ? transport(at, {
            bytesReceived: i * 10_000,
            streams: [
              stream({ id: 'gelen', direction: 'in', packets: i * 90, packetsLost: i * 10, jitterMs: 12, concealedSamples: i * 480, totalSamplesReceived: i * 96_000 }),
            ],
          })
        : null;
    t.sample({ at, publisher: pub, prevPublisher: prev, subscriber: sub, quality: opts.quality ?? 'good', serverQuality: i === 3 ? 'poor' : 'excellent' });
    prev = pub;
  }
}

describe('ses kalitesi özeti', () => {
  it('30 saniyede bir özet: ping, kayıp, bit hızı, bağlantı yolu, yayın; adres gönderilmez', () => {
    const t = new VoiceTelemetry();
    t.setContext(() => ({ channelId: 'ses1', mic: null }));
    feed(t, 16, { screen: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://sunucu.test/api/telemetry/voice');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jeton');
    const r = sent()[0]!;
    expect(r).toMatchObject({
      v: 1,
      platform: 'desktop',
      version: '0.7.0',
      channelId: 'ses1',
      quality: 'good',
      poorSec: 0,
      serverQuality: 'poor',
      rttMs: { avg: 30, max: 30 },
      jitterOutMs: 4,
      jitterInMs: 12,
      // Giden: ses 100 + yayın 500 paketin 2'si; gelen: 90 alınan + 10 kayıp
      lossOutPct: 0.33,
      lossInPct: 10,
      concealedPct: 0.5,
      candidate: 'relay',
      protocol: 'tls',
      reconnects: 0,
      screen: { width: 1920, height: 1080, fps: 58, encoder: 'NvEnc', codec: 'video/H264', limitation: 'cpu' },
    });
    // İlk ölçüm aralığın 2. saniyesi sayılır: 30. saniyedeki 15. ölçümde gider
    expect(r.samples).toBe(15);
    expect(r.windowSec).toBe(30);
    // 1.508.000 bayt / 2 sn → 6,032 Mb/sn
    expect(r.bitrateOut).toBe(6_032_000);
    expect(r.screen!.bitrate).toBe(6_000_000);
    expect(r.screen!.limitedRatio).toBeCloseTo(0.47, 1);
    expect(JSON.stringify(r)).not.toContain('10.0.0.1');
  });

  it('kalite kötüye düşünce hemen gönderilir (en fazla 10 sn\'de bir), yeniden bağlanmalar sayılır', () => {
    const t = new VoiceTelemetry();
    t.setContext(() => ({ channelId: 'ses1', mic: null }));
    feed(t, 3);
    expect(fetchMock).not.toHaveBeenCalled();
    t.noteReconnect();
    feed(t, 2, { start: 1_006_000, quality: 'poor', rtt: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const r = sent()[0]!;
    expect(r.quality).toBe('poor');
    // İlk kötü ölçümde gider
    expect(r.poorSec).toBe(2);
    expect(r.samples).toBe(4);
    expect(r.reconnects).toBe(1);
    expect(r.rttMs.max).toBe(400);
  });

  it('kanal yoksa, oturum yoksa ya da sunucu desteklemiyorsa (404) gönderilmez', async () => {
    const t = new VoiceTelemetry();
    t.setContext(() => ({ channelId: null, mic: null }));
    feed(t, 16);
    expect(fetchMock).not.toHaveBeenCalled();

    t.setContext(() => ({ channelId: 'ses1', mic: null }));
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    feed(t, 16, { start: 2_000_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    feed(t, 16, { start: 3_000_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('çıkışta yarım özet gönderilir; hatalı ölçüm görüşmeyi etkilemez', () => {
    const t = new VoiceTelemetry();
    t.setContext(() => ({ channelId: 'ses1', mic: { noise: 'dpdfnet', model: 'DPDFNet', load: 0.3, avgFrameMs: 1, p99FrameMs: 2, maxFrameMs: 3, underruns: 0, droppedSamples: 0, muted: false } }));
    feed(t, 5);
    t.reset();
    expect(sent()[0]).toMatchObject({ samples: 5, mic: { noise: 'dpdfnet', load: 0.3 } });
    expect(() => t.sample({ at: 1, publisher: { broken: true } as unknown as TransportStats, prevPublisher: null, subscriber: null, quality: 'good' })).not.toThrow();
  });

  it('izlenen yayın: çözücü, kare başına çözme süresi, atılan kare, donma, görünüm ve cihaz', () => {
    const t = new VoiceTelemetry();
    const view = { mode: 'fullscreen' as const, width: 2400, height: 1080 };
    t.setContext(() => ({ channelId: 'ses1', mic: null, view, device: { appState: 'active', soc: 'QTI SM8850' } }));
    const start = 1_000_000;
    let prev: TransportStats | null = null;
    // 16 ölçüm (2 sn); abonelik bağlantısı 10 sn'de bir okunur (0., 5., 10., 15. ölçüm)
    for (let i = 0; i < 16; i++) {
      const at = start + i * 2000;
      const pub = transport(at, { rttMs: 30, streams: [stream({ id: 'mic', packets: i * 100 })] });
      // Her 10 sn'de 600 kare; kare başına çözme 4 ms, sonra 10 ms (ısınma); 10 sn'de 3 kare atılır
      const step = i / 5;
      const decodeSec = step <= 1 ? step * 600 * 0.004 : 600 * 0.004 + (step - 1) * 600 * 0.01;
      const sub =
        i % 5 === 0
          ? transport(at, {
              streams: [
                stream({
                  id: 'yayin',
                  direction: 'in',
                  kind: 'video',
                  codec: 'video/VP9',
                  bytes: step * 15_000_000,
                  frameWidth: 2560,
                  frameHeight: 1440,
                  framesPerSecond: 60,
                  implementation: 'libvpx',
                  video: {
                    powerEfficient: false,
                    frames: step * 600,
                    totalTime: decodeSec,
                    framesReceived: step * 603,
                    framesDropped: step * 3,
                    freezeCount: step >= 2 ? 1 : 0,
                    totalFreezesDuration: step >= 2 ? 0.4 : 0,
                    jitterBufferDelay: step * 600 * 0.05,
                    jitterBufferEmittedCount: step * 600,
                  },
                }),
              ],
            })
          : null;
      t.sample({ at, publisher: pub, prevPublisher: prev, subscriber: sub, quality: 'good' });
      prev = pub;
    }
    const r = sent()[0]!;
    expect(r.watch).toMatchObject({
      codec: 'video/VP9',
      decoder: 'libvpx',
      hardware: false,
      powerEfficient: false,
      width: 2560,
      height: 1440,
      fps: 60,
      // Özet 30. saniyede (15. ölçüm) gider: 0→10→20 sn arası 1200 kare, 600×4 ms + 600×10 ms → ort. 7 ms
      decodeMs: 7,
      decodeMsMax: 10,
      // 15 MB / 10 sn
      bitrate: 12_000_000,
      framesDropped: 6,
      freezes: 1,
      freezeSec: 0.4,
      jitterBufferMs: 50,
      view,
    });
    expect(r.device).toEqual({ appState: 'active', soc: 'QTI SM8850' });
  });

  it('yayın izlenmiyorsa ve platform bildirmiyorsa watch ve device null', () => {
    const t = new VoiceTelemetry();
    t.setContext(() => ({ channelId: 'ses1', mic: null }));
    feed(t, 16);
    expect(sent()[0]!.watch).toBeNull();
    expect(sent()[0]!.device).toBeNull();
    expect(sent()[0]!.settings).toBeNull();
  });

  it('tek bağlantı kipi (abonelik bağlantısı yok): gelen sesler ve izlenen yayın yayın bağlantısından okunur', () => {
    const t = new VoiceTelemetry();
    const settings = { echoCancellation: false, userVolumesChanged: 1, userVolumeMax: 2 };
    t.setContext(() => ({ channelId: 'ses1', mic: null, settings }));
    const start = 1_000_000;
    let prev: TransportStats | null = null;
    for (let i = 0; i < 16; i++) {
      const at = start + i * 2000;
      const pub = transport(at, {
        rttMs: 30,
        bytesSent: i * 10_000,
        // 2 sn'de 50 kB ses + 2,5 MB yayın
        bytesReceived: i * 2_550_000,
        streams: [
          stream({ id: 'mic', packets: i * 100, bytes: i * 8_000 }),
          stream({
            id: 'ali',
            direction: 'in',
            packets: i * 95,
            packetsLost: i * 5,
            bytes: i * 25_000,
            jitterMs: i === 10 ? 40 : 10,
            concealedSamples: i * 1_920,
            totalSamplesReceived: i * 96_000,
            audio: { silentConcealedSamples: i * 960, concealmentEvents: i * 2, jitterBufferDelay: i * 96_000 * 0.06, jitterBufferEmittedCount: i * 96_000 },
          }),
          stream({ id: 'veli', direction: 'in', packets: i * 50, packetsLost: 0, bytes: i * 25_000, jitterMs: 20, concealedSamples: 0, totalSamplesReceived: i * 96_000 }),
          // Susturulmuş kişi: paket gelmiyor (sayılmaz)
          stream({ id: 'sessiz', direction: 'in', packets: 7, packetsLost: 0, jitterMs: 90, concealedSamples: 0, totalSamplesReceived: 100 }),
          stream({
            id: 'yayin',
            direction: 'in',
            kind: 'video',
            codec: 'video/H264',
            packets: i * 2_000,
            packetsLost: 0,
            bytes: i * 2_500_000,
            frameWidth: 1920,
            frameHeight: 1080,
            framesPerSecond: 60,
            implementation: 'c2.qti.avc.decoder',
            video: { powerEfficient: true, frames: i * 120, totalTime: i * 120 * 0.003, framesReceived: i * 120, framesDropped: 0, freezeCount: 0, totalFreezesDuration: 0, jitterBufferDelay: null, jitterBufferEmittedCount: null },
          }),
        ],
      });
      t.sample({ at, publisher: pub, prevPublisher: prev, subscriber: null, quality: 'good' });
      prev = pub;
    }
    const r = sent()[0]!;
    // Gelen: 0., 5., 10. ölçümler (10 sn arayla); 10 sn'de ali 475 alınan + 25 kayıp, veli 250, yayın 10.000
    expect(r.lossInPct).toBe(round2((50 / 21_500) * 100));
    // Titreşim: yalnızca paket gelen akışlar (susturulmuşun 90 ms'si sayılmaz)
    expect(r.jitterInMs).toBe(22.5);
    // ali: 9.600 gizlenen − 4.800 sessiz / 480.000 + veli 0 / 480.000 → %0,5
    expect(r.concealedPct).toBe(0.5);
    // 12,75 MB / 10 sn
    expect(r.bitrateIn).toBe(10_200_000);
    expect(r.audioIn).toEqual({
      streams: 2,
      jitterMaxMs: 40,
      lossPct: round2((50 / 1_500) * 100),
      concealEvents: 20,
      jitterBufferMs: 60,
      // 2 × 125 kB / 10 sn
      bitrate: 200_000,
    });
    expect(r.watch).toMatchObject({ codec: 'video/H264', decoder: 'c2.qti.avc.decoder', hardware: true, width: 1920, fps: 60, decodeMs: 3, bitrate: 10_000_000 });
    expect(r.settings).toEqual(settings);
  });

  it('duraklatılmış (izlenmeyen) yayın watch sayılmaz', () => {
    const t = new VoiceTelemetry();
    t.setContext(() => ({ channelId: 'ses1', mic: null }));
    for (let i = 0; i < 16; i++) {
      const at = 1_000_000 + i * 2000;
      const paused = stream({ id: 'yayin', direction: 'in', kind: 'video', bytes: 5_000_000, frameWidth: 1920, frameHeight: 1080, framesPerSecond: 0 });
      const sub = i % 5 === 0 ? transport(at, { streams: [paused] }) : null;
      t.sample({ at, publisher: transport(at, { rttMs: 30 }), prevPublisher: null, subscriber: sub, quality: 'good' });
    }
    expect(sent()[0]!.watch).toBeNull();
    expect(sent()[0]!.audioIn).toBeNull();
  });

  it('JS takılması özete eklenir, çıkışta ölçüm durur', () => {
    let now = 0;
    const lag = new LoopLagMeter(() => now);
    const t = new VoiceTelemetry(lag);
    t.setContext(() => ({ channelId: 'ses1', mic: null }));
    feed(t, 3);
    expect(lag.running).toBe(true);
    for (const step of [500, 500, 1_700, 500]) {
      now += step;
      lag.tick();
    }
    t.reset();
    expect(sent()[0]!.jsLag).toEqual({ maxMs: 1_200, p95Ms: 1_200, stalls: 1 });
    expect(lag.running).toBe(false);
  });
});

const round2 = (v: number): number => Math.round(v * 100) / 100;

const snapshot = (at: number, streams: RtpStream[]): TransportStats => transport(at, { streams });

describe('gelen seslerin değişimi', () => {
  const audio = (id: string, i: number, over: Partial<RtpStream> = {}): RtpStream =>
    stream({
      id,
      direction: 'in',
      packets: i * 100,
      packetsLost: i * 2,
      bytes: i * 4_000,
      jitterMs: 8,
      concealedSamples: i * 1_000,
      totalSamplesReceived: i * 100_000,
      audio: { silentConcealedSamples: i * 400, concealmentEvents: i * 3, jitterBufferDelay: i * 4_000, jitterBufferEmittedCount: i * 100_000 },
      ...over,
    });

  it('kayıp, gizleme (sessizlik hariç), olay, tampon ve bayt farkı', () => {
    const d = inboundAudioDelta(snapshot(2, [audio('a', 2)]), snapshot(1, [audio('a', 1)]));
    expect(d).toEqual({
      active: 1,
      packets: 102,
      lost: 2,
      bytes: 4_000,
      samples: 100_000,
      concealed: 600,
      events: 3,
      bufferDelay: 4_000,
      bufferEmitted: 100_000,
      jitters: [8],
    });
  });

  it('önceki okuma yoksa, paket gelmeyen ve yeni akış sayılmaz; sayaç geri giderse 0', () => {
    expect(inboundAudioDelta(snapshot(1, [audio('a', 1)]), null)).toMatchObject({ active: 0, packets: 0, jitters: [] });
    const d = inboundAudioDelta(
      snapshot(2, [audio('a', 1), audio('yeni', 1), audio('b', 1, { concealedSamples: 0, totalSamplesReceived: 50 })]),
      snapshot(1, [audio('a', 1), audio('b', 3)]),
    );
    expect(d).toMatchObject({ active: 0, packets: 0, samples: 0, concealed: 0, events: null, jitters: [] });
    // Sayaçları olmayan (eski) tarayıcı: olay ve tampon bilinmiyor
    const bare = inboundAudioDelta(snapshot(2, [audio('a', 2, { audio: null })]), snapshot(1, [audio('a', 1, { audio: null })]));
    expect(bare).toMatchObject({ active: 1, samples: 100_000, concealed: 1_000, events: null, bufferEmitted: 0 });
    // Sessiz gizleme yalnızca bir okumada var: bu akışın gizlemesi hesaplanamaz (fazla sayılmaz)
    const half = inboundAudioDelta(snapshot(2, [audio('a', 2)]), snapshot(1, [audio('a', 1, { audio: null })]));
    expect(half).toMatchObject({ active: 1, packets: 102, samples: 0, concealed: 0 });
  });

  it('izlenen yayın: bayt artan en büyük görüntü', () => {
    const video = (id: string, bytes: number, w: number, fps: number | null = 30): RtpStream =>
      stream({ id, direction: 'in', kind: 'video', bytes, frameWidth: w, frameHeight: w, framesPerSecond: fps });
    const prev = snapshot(1, [video('buyuk', 100, 1920), video('kucuk', 100, 320)]);
    expect(watchedVideo(snapshot(2, [video('buyuk', 100, 1920), video('kucuk', 200, 320)]), prev)?.id).toBe('kucuk');
    expect(watchedVideo(snapshot(2, [video('buyuk', 100, 1920)]), prev)).toBeNull();
    expect(watchedVideo(snapshot(2, [video('yeni', 5, 640)]), prev)?.id).toBe('yeni');
    expect(watchedVideo(snapshot(2, [video('yeni', 5, 640, 0)]), null)).toBeNull();
  });
});

describe('JS takılması', () => {
  it('en yüksek, 95. yüzdelik ve takılma sayısı', () => {
    expect(summarizeLag([])).toBeNull();
    const lags = [...Array.from({ length: 95 }, () => 2), 150, 210, 300, 900, 4_000];
    expect(summarizeLag(lags)).toEqual({ maxMs: 4_000, p95Ms: 2, stalls: 4 });
    expect(summarizeLag([5, 250])).toEqual({ maxMs: 250, p95Ms: 250, stalls: 1 });
  });

  it('tik gecikmesi zamanlayıcı kaymasından ölçülür; okuyunca sıfırlanır', () => {
    let now = 1_000;
    const m = new LoopLagMeter(() => now, 500);
    m.start();
    for (const step of [500, 504, 2_500]) {
      now += step;
      m.tick();
    }
    expect(m.take()).toEqual({ maxMs: 2_000, p95Ms: 2_000, stalls: 1 });
    expect(m.take()).toBeNull();
    m.stop();
  });

  it('10 sn üstü boşluk (uyku/arka plan) ve öne gelmeden önceki süre takılma sayılmaz', () => {
    let now = 0;
    const m = new LoopLagMeter(() => now, 500);
    m.start();
    now += 60_000;
    m.tick();
    now += 500;
    m.tick();
    expect(m.take()).toEqual({ maxMs: 0, p95Ms: 0, stalls: 0 });
    // Arka planda 8 sn: öne gelince (rebase) sayılmaz
    now += 8_000;
    m.rebase();
    now += 500;
    m.tick();
    expect(m.take()).toEqual({ maxMs: 0, p95Ms: 0, stalls: 0 });
    m.stop();
  });

  it('gönderilmeyen aralığın takılmaları sonraki özete kalmaz', () => {
    let now = 0;
    const lag = new LoopLagMeter(() => now);
    const t = new VoiceTelemetry(lag);
    let channel: string | null = null;
    t.setContext(() => ({ channelId: channel, mic: null }));
    feed(t, 16);
    now += 3_500;
    lag.tick();
    // Kanal yokken özet gitmedi; takılma da atıldı
    feed(t, 15, { start: 1_032_000 });
    expect(fetchMock).not.toHaveBeenCalled();
    channel = 'ses1';
    now += 500;
    lag.tick();
    feed(t, 16, { start: 1_062_000 });
    expect(sent()[0]!.jsLag).toEqual({ maxMs: 0, p95Ms: 0, stalls: 0 });
  });
});

describe('özetin ek alanları (yeni istemciler)', () => {
  it('giden kayıp ses ve görüntü için ayrı; aralığın bitişi ve gönderim anı istemci saatiyle', () => {
    const t = new VoiceTelemetry();
    t.setContext(() => ({ channelId: 'ses1', mic: null }));
    feed(t, 16, { screen: true });
    const r = sent()[0]!;
    // Ses: 100 paketin 2'si; görüntü: 500 paketin 0'ı (toplam oran ikisinin karışımı: %0,33)
    expect(r.lossOutAudioPct).toBe(2);
    expect(r.lossOutVideoPct).toBe(0);
    expect(r.lossOutPct).toBe(0.33);
    expect(r.endAt).toBe(1_000_000 + 14 * 2000);
    expect(typeof r.sentAt).toBe('number');
    // Saat farkı henüz ölçülmedi
    expect(r.offsetMs).toBeNull();
  });

  it('yayın yokken görüntü kaybı null; takılma tepe değeri özetin ölçümlerinden bağımsız okunur', () => {
    let now = 0;
    const lag = new LoopLagMeter(() => now);
    const t = new VoiceTelemetry(lag);
    t.setContext(() => ({ channelId: 'ses1', mic: null }));
    feed(t, 2);
    now += 800;
    lag.tick();
    now += 500;
    lag.tick();
    expect(t.lagPeak()).toBe(300);
    expect(t.lagPeak()).toBeNull();
    feed(t, 14, { start: 1_004_000 });
    const r = sent()[0]!;
    expect(r.lossOutVideoPct).toBeNull();
    // Tepe değerin okunması özetteki takılma ölçümünü silmez
    expect(r.jsLag).toEqual({ maxMs: 300, p95Ms: 300, stalls: 1 });
  });
});

describe('ses seviyesi özeti', () => {
  it('%100 dışındaki seviyelerin sayısı ve en yükseği; kimlik yok', () => {
    expect(volumeSummary({ u1: 1, u2: 1.8, u3: 0.4, u4: Number.NaN })).toEqual({ userVolumesChanged: 2, userVolumeMax: 1.8 });
    expect(volumeSummary({})).toEqual({ userVolumesChanged: 0, userVolumeMax: null });
    expect(volumeSummary(undefined)).toEqual({ userVolumesChanged: 0, userVolumeMax: null });
  });
});
