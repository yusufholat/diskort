import { describe, expect, it } from 'vitest';
import {
  describeCandidate,
  describeTransport,
  formatBitrate,
  formatPercent,
  isHardwareCodec,
  linkQuality,
  mainInboundVideo,
  minuteTicks,
  outboundDelta,
  parseTransportStats,
  perFrameMs,
  pingAxis,
  pushSample,
  summarizePings,
  type PingSample,
} from '../src/connectionStats';
import { publisherReport, subscriberReport } from './fixtures/rtcStats';

const asReport = <T extends { id: string }>(stats: T[]): Map<string, unknown> => new Map(stats.map((s) => [s.id, s]));

/** İzlenen ekran yayını: gelen VP9 görüntü (react-native-webrtc / Chrome alan adları) */
function inboundVideoReport(t: number, over: Record<string, unknown> = {}): { id: string; type: string; [k: string]: unknown }[] {
  return [
    { id: 'COT01_98', type: 'codec', mimeType: 'video/VP9', clockRate: 90000, payloadType: 98 },
    {
      id: 'IT01V123',
      type: 'inbound-rtp',
      kind: 'video',
      ssrc: 123,
      codecId: 'COT01_98',
      trackIdentifier: 'yayin-track',
      packetsReceived: 1000 * t,
      bytesReceived: 1_500_000 * t,
      packetsLost: 0,
      jitter: 0.004,
      frameWidth: 2560,
      frameHeight: 1440,
      framesPerSecond: 60,
      framesReceived: 121 * t,
      framesDecoded: 120 * t,
      framesDropped: t,
      totalDecodeTime: 120 * t * (t > 1 ? 0.0069 : 0.00185),
      freezeCount: 0,
      totalFreezesDuration: 0,
      jitterBufferDelay: 120 * t * 0.03,
      jitterBufferEmittedCount: 120 * t,
      decoderImplementation: 'c2.qti.vp9.decoder',
      powerEfficientDecoder: true,
      ...over,
    },
  ];
}

describe('görüntü çözme / kodlama', () => {
  it('gelen görüntü: kodek, çözücü, kare sayaçları', () => {
    const t = parseTransportStats(asReport(inboundVideoReport(1)), 1000)!;
    const s = t.streams[0]!;
    expect(s).toMatchObject({
      direction: 'in',
      kind: 'video',
      codec: 'video/VP9',
      implementation: 'c2.qti.vp9.decoder',
      frameWidth: 2560,
      frameHeight: 1440,
      framesPerSecond: 60,
    });
    expect(s.video).toMatchObject({ powerEfficient: true, frames: 120, framesReceived: 121, framesDropped: 1, freezeCount: 0 });
    expect(isHardwareCodec(s.implementation, s.video!.powerEfficient)).toBe(true);
  });

  it('kare başına çözme süresi iki ölçüm arasındaki farktan; önceki yoksa baştan beri', () => {
    const a = parseTransportStats(asReport(inboundVideoReport(1)), 1000)!;
    const b = parseTransportStats(asReport(inboundVideoReport(2)), 2000)!;
    const first = describeTransport(a, null).streams[0]!;
    expect(first.frameMs).toBeCloseTo(1.85, 5);
    const view = describeTransport(b, a).streams[0]!;
    // 2. ölçümde toplam 240 × 6,9 ms; ilk 120 kare 1,85 ms → aradaki 120 kare (1656 - 222) / 120
    expect(view.frameMs).toBeCloseTo((240 * 6.9 - 120 * 1.85) / 120, 5);
    expect(view.jitterBufferMs).toBeCloseTo(30, 5);
    expect(view.bitrate).toBe(12_000_000);
    // Kare çözülmediyse (duraklatılmış) süre yok
    expect(perFrameMs(a.streams[0]!.video, a.streams[0]!.video)).toBeNull();
  });

  it('yazılım çözücü: libvpx, Android yazılım kodeği ve yedeğe düşme', () => {
    expect(isHardwareCodec('libvpx', null)).toBe(false);
    expect(isHardwareCodec('libvpx', true)).toBe(false);
    expect(isHardwareCodec('c2.android.vp9.decoder', null)).toBe(false);
    expect(isHardwareCodec('OMX.google.vp9.decoder', null)).toBe(false);
    expect(isHardwareCodec('libvpx (fallback from: c2.qti.vp9.decoder)', null)).toBe(false);
    expect(isHardwareCodec('FFmpeg', null)).toBe(false);
    expect(isHardwareCodec('dav1d', null)).toBe(false);
  });

  it('donanım çözücü/kodlayıcı adları; ad bir şey söylemiyorsa powerEfficient', () => {
    expect(isHardwareCodec('c2.qti.vp9.decoder', null)).toBe(true);
    expect(isHardwareCodec('OMX.qcom.video.decoder.vp9', null)).toBe(true);
    expect(isHardwareCodec('MediaCodecVideoDecoder', null)).toBe(true);
    expect(isHardwareCodec('ExternalDecoder', null)).toBe(true);
    expect(isHardwareCodec('D3D11VideoDecoder', null)).toBe(true);
    expect(isHardwareCodec('NvEnc', null)).toBe(true);
    expect(isHardwareCodec('MediaFoundationVideoEncodeAccelerator', null)).toBe(true);
    expect(isHardwareCodec('bilinmeyen', false)).toBe(false);
    expect(isHardwareCodec(null, true)).toBe(true);
    expect(isHardwareCodec(null, null)).toBeNull();
  });

  it('eksik alanlar (eski sürüm / başka tarayıcı): sayaçlar null, oranlar hesaplanmaz', () => {
    const report = inboundVideoReport(1, {
      decoderImplementation: undefined,
      powerEfficientDecoder: undefined,
      totalDecodeTime: undefined,
      framesDropped: undefined,
      freezeCount: undefined,
      totalFreezesDuration: undefined,
      jitterBufferDelay: undefined,
      codecId: undefined,
    });
    const t = parseTransportStats(asReport(report), 1000)!;
    const s = describeTransport(t, t).streams[0]!;
    expect(s.codec).toBeNull();
    expect(s.implementation).toBeNull();
    expect(s.video).toMatchObject({ powerEfficient: null, totalTime: null, framesDropped: null, freezeCount: null, jitterBufferDelay: null });
    expect(s.frameMs).toBeNull();
    expect(s.jitterBufferMs).toBeNull();
    expect(isHardwareCodec(s.implementation, s.video!.powerEfficient)).toBeNull();
  });

  it('giden görüntü: kodlayıcı ve kodlama süresi; ses akışında sayaç yok', () => {
    const t = parseTransportStats(
      asReport([
        { id: 'OT1', type: 'outbound-rtp', kind: 'video', ssrc: 5, packetsSent: 10, bytesSent: 1000, framesEncoded: 300, totalEncodeTime: 1.5, encoderImplementation: 'libvpx', powerEfficientEncoder: false, qualityLimitationReason: 'cpu' },
        { id: 'OT2', type: 'outbound-rtp', kind: 'audio', ssrc: 6, packetsSent: 10, bytesSent: 1000 },
      ]),
      1000,
    )!;
    const video = t.streams.find((s) => s.kind === 'video')!;
    expect(video.video).toMatchObject({ powerEfficient: false, frames: 300, totalTime: 1.5, framesDropped: null });
    expect(perFrameMs(video.video, null)).toBeCloseTo(5, 5);
    expect(t.streams.find((s) => s.kind === 'audio')!.video).toBeNull();
  });

  it('izlenen görüntü: gelen görüntüler arasında en büyük kare', () => {
    const small = parseTransportStats(asReport(inboundVideoReport(1, { id: 'kucuk', frameWidth: 320, frameHeight: 180 })), 1)!.streams[0]!;
    const big = parseTransportStats(asReport(inboundVideoReport(1)), 1)!.streams[0]!;
    expect(mainInboundVideo([small, big])?.frameWidth).toBe(2560);
    expect(mainInboundVideo([])).toBeNull();
  });
});

describe('getStats raporunu okuma', () => {
  it('seçili aday çiftinden ping, adaylar ve şifreleme bilgisi', () => {
    const t = parseTransportStats(asReport(publisherReport(0)), 1000)!;
    expect(t.rttMs).toBe(41);
    expect(t.availableOutgoingBitrate).toBe(2_450_000);
    expect(t.local).toMatchObject({ candidateType: 'relay', relayProtocol: 'tls', protocol: 'udp', port: 54321 });
    expect(t.remote).toMatchObject({ candidateType: 'host', address: '203.0.113.7' });
    expect(t.dtlsState).toBe('connected');
    expect(t.srtpCipher).toBe('AEAD_AES_128_GCM');
  });

  it('giden akış: kodek, kaynak track ve karşı tarafın kayıp raporu; kapalı katman atlanır', () => {
    const t = parseTransportStats(publisherReport(0), 1000)!;
    expect(t.streams).toHaveLength(1);
    expect(t.streams[0]).toMatchObject({
      direction: 'out',
      kind: 'audio',
      trackId: 'mic-track-1',
      codec: 'audio/opus',
      channels: 2,
      packets: 1000,
      packetsLost: 3,
      jitterMs: 4,
      rttMs: 45,
    });
  });

  it('gelen akışlar ve transport kaydı olmadan aday çifti seçimi', () => {
    const report = subscriberReport(0).filter((s) => s.type !== 'transport');
    const t = parseTransportStats(report, 1000)!;
    expect(t.rttMs).toBe(44);
    expect(t.local).toMatchObject({ candidateType: 'srflx', address: '10.0.0.5' });
    expect(t.availableIncomingBitrate).toBe(5_000_000);
    const video = t.streams.find((s) => s.kind === 'video')!;
    expect(video).toMatchObject({ direction: 'in', codec: 'video/AV1', frameWidth: 1920, framesPerSecond: 60 });
  });

  it('react-native-webrtc raporu: yerel modülün JSON [id, kayıt] dizisinden kurulan Map aynı okunur', () => {
    // @livekit/react-native-webrtc: getStats() → new Map(JSON.parse(peerConnectionGetStats(...)));
    // Android'de zaman damgası mikro saniyeden ondalıklı milisaniyeye çevrilir
    const toNative = (stats: { id: string; timestamp?: number }[]): Map<string, unknown> =>
      new Map(
        JSON.parse(
          JSON.stringify(stats.map((s) => [s.id, { ...s, timestamp: (s.timestamp ?? 0) + 0.123 }])),
        ) as [string, unknown][],
      );
    for (const report of [publisherReport(1), subscriberReport(1)]) {
      const native = parseTransportStats(toNative(report), 1000);
      expect(native).toEqual(parseTransportStats(report, 1000));
      expect(native!.rttMs).not.toBeNull();
      expect(native!.local?.candidateType).not.toBeNull();
    }
    const a = parseTransportStats(toNative(publisherReport(0)), 0)!;
    const b = parseTransportStats(toNative(publisherReport(1)), 2000)!;
    expect(describeTransport(b, a).bitrateOut).toBe(32_000);
  });

  it('boş rapor', () => {
    expect(parseTransportStats([])).toBeNull();
    expect(parseTransportStats(new Map())).toBeNull();
  });
});

describe('iki ölçüm arasındaki değişim', () => {
  it('bit hızı ve akış başına kayıp', () => {
    const a = parseTransportStats(subscriberReport(1), 0)!;
    const b = parseTransportStats(subscriberReport(2), 2000)!;
    const view = describeTransport(b, a);
    expect(view.bitrateIn).toBe(1_000_000); // 250 kB / 2 sn
    const audio = view.streams.find((s) => s.kind === 'audio')!;
    expect(audio.bitrate).toBe(32_000);
    expect(audio.lossPercent).toBe(5); // 5 kayıp / (95 alınan + 5 kayıp)
    const video = view.streams.find((s) => s.kind === 'video')!;
    expect(video.lossPercent).toBe(0);
  });

  it('önceki ölçüm yoksa oranlar boş', () => {
    const view = describeTransport(parseTransportStats(subscriberReport(0), 0)!, null);
    expect(view.bitrateIn).toBeNull();
    expect(view.streams.every((s) => s.bitrate === null && s.lossPercent === null)).toBe(true);
  });

  it('giden paket ve kayıp farkı; yeniden yayınlanan akış sayılmaz', () => {
    const a = parseTransportStats(publisherReport(1), 0);
    const b = parseTransportStats(publisherReport(2), 2000);
    expect(outboundDelta(b, a)).toEqual({ sent: 100, lost: 5 });
    expect(outboundDelta(b, null)).toEqual({ sent: 0, lost: 0 });
    const renamed = { ...b!, streams: b!.streams.map((s) => ({ ...s, id: 'OT01A9999' })) };
    expect(outboundDelta(renamed, a)).toEqual({ sent: 0, lost: 0 });
  });
});

describe('ping geçmişi', () => {
  const sample = (at: number, rttMs: number | null, sent = 50, lost = 0): PingSample => ({ at, rttMs, sent, lost });

  it('halka arabellek son 5 dakikayı tutar', () => {
    let buf: PingSample[] = [];
    for (let i = 0; i <= 200; i++) buf = pushSample(buf, sample(i * 2000, 40));
    expect(buf).toHaveLength(151);
    expect(buf[0]!.at).toBe(400_000 - 300_000);
  });

  it('ortalama, son ping ve kayıp oranı', () => {
    const buf = [sample(0, 40, 100, 0), sample(2000, null, 100, 20), sample(4000, 60, 100, 10)];
    expect(summarizePings(buf)).toEqual({ averageMs: 50, lastMs: 60, lossPercent: 10 });
    expect(summarizePings(buf, 3000)).toEqual({ averageMs: 60, lastMs: 60, lossPercent: 10 });
    expect(summarizePings([])).toEqual({ averageMs: null, lastMs: null, lossPercent: null });
  });

  it('kalite rengi', () => {
    expect(linkQuality(null, null)).toBe('unknown');
    expect(linkQuality(40, 0)).toBe('good');
    expect(linkQuality(150, 0)).toBe('fair');
    expect(linkQuality(40, 4)).toBe('fair');
    expect(linkQuality(260, 0)).toBe('poor');
    expect(linkQuality(40, 12)).toBe('poor');
  });

  it('grafik ekseni', () => {
    expect(pingAxis([])).toEqual({ max: 100, ticks: [0, 50, 100] });
    expect(pingAxis([sample(0, 45)])).toEqual({ max: 100, ticks: [0, 50, 100] });
    expect(pingAxis([sample(0, 130)]).max).toBe(200);
    expect(pingAxis([sample(0, 480)]).max).toBe(600);
  });

  it('dakika etiketleri', () => {
    const min = 60_000;
    expect(minuteTicks(10 * min + 5000, 15 * min + 5000)).toEqual([11, 12, 13, 14, 15].map((m) => m * min));
    expect(minuteTicks(0, 30 * min)).toEqual([0, 10, 20, 30].map((m) => m * min));
    expect(minuteTicks(5, 5)).toEqual([]);
  });
});

describe('metinler', () => {
  it('aday türü', () => {
    const t = parseTransportStats(publisherReport(0))!;
    expect(describeCandidate(t.local)).toBe('Aktarıcı (TURN) · TLS');
    expect(describeCandidate(t.remote)).toBe('Doğrudan (host) · UDP');
    expect(describeCandidate(null)).toBe('Bilinmiyor');
  });

  it('bit hızı ve yüzde', () => {
    expect(formatBitrate(null)).toBe('—');
    expect(formatBitrate(64_000)).toBe('64 kb/sn');
    expect(formatBitrate(2_450_000)).toBe('2,5 Mb/sn');
    expect(formatPercent(3.25)).toBe('%3,3');
  });
});
