import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceTelemetryReport } from '@diskort/shared';
import { configureClient, type KeyValueStorage } from '../src';
import type { RtpStream, TransportStats } from '../src/connectionStats';
import { useSession } from '../src/session';
import { VoiceTelemetry } from '../src/voiceTelemetry';

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
  });
});
