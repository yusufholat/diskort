import { describe, expect, it } from 'vitest';
import {
  describeCandidate,
  describeTransport,
  formatBitrate,
  formatPercent,
  linkQuality,
  minuteTicks,
  outboundDelta,
  parseTransportStats,
  pingAxis,
  pushSample,
  summarizePings,
  type PingSample,
} from '../src/connectionStats';
import { publisherReport, subscriberReport } from './fixtures/rtcStats';

const asReport = (stats: { id: string }[]): Map<string, unknown> => new Map(stats.map((s) => [s.id, s]));

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
