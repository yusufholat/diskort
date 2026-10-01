// Olay kaydı testleri için tek bağlantı kipinde (yayın + gelen akışlar aynı raporda) getStats() raporu üretir.
// Chromium 13x'in LiveKit bağlantısında verdiği alan adlarıyla; adresler uydurmadır ve kayda GİRMEMELİDİR.

import type { RtcStat } from '../../src/connectionStats';

/** Sayaçların o anki toplamları (testler adım adım artırır) */
export interface TraceState {
  pairId: string;
  rtt: number;
  requestsSent: number;
  responsesReceived: number;
  availableOut: number;
  bytesSent: number;
  bytesReceived: number;
  discardedOnSend: number;
  mic: { packets: number; bytes: number; lost: number } | null;
  screen: {
    packets: number;
    bytes: number;
    lost: number;
    targetBitrate: number;
    framesEncoded: number;
    framesSent: number;
    keyFrames: number;
    hugeFrames: number;
    nack: number;
    pli: number;
    fir: number;
    retransBytes: number;
    retransPackets: number;
    sendDelay: number;
    encodeTime: number;
    limitation: string;
  } | null;
  audioIn: { packets: number; lost: number; bytes: number; samples: number; concealed: number; silent: number; events: number } | null;
  videoIn: {
    packets: number;
    lost: number;
    bytes: number;
    framesDecoded: number;
    keyFrames: number;
    freezes: number;
    freezeSec: number;
    dropped: number;
    nack: number;
    pli: number;
    bufferDelay: number;
    bufferEmitted: number;
  } | null;
}

export function traceState(over: Partial<TraceState> = {}): TraceState {
  return {
    pairId: 'CPabc_def',
    rtt: 0.04,
    requestsSent: 10,
    responsesReceived: 10,
    availableOut: 4_000_000,
    bytesSent: 100_000,
    bytesReceived: 50_000,
    discardedOnSend: 0,
    mic: { packets: 1000, bytes: 100_000, lost: 0 },
    screen: null,
    audioIn: null,
    videoIn: null,
    ...over,
  };
}

export function screenState(): NonNullable<TraceState['screen']> {
  return {
    packets: 5000,
    bytes: 5_000_000,
    lost: 0,
    targetBitrate: 3_000_000,
    framesEncoded: 900,
    framesSent: 900,
    keyFrames: 2,
    hugeFrames: 0,
    nack: 0,
    pli: 0,
    fir: 0,
    retransBytes: 0,
    retransPackets: 0,
    sendDelay: 1.5,
    encodeTime: 4.5,
    limitation: 'none',
  };
}

export function videoInState(): NonNullable<TraceState['videoIn']> {
  return {
    packets: 3000,
    lost: 0,
    bytes: 3_000_000,
    framesDecoded: 600,
    keyFrames: 1,
    freezes: 0,
    freezeSec: 0,
    dropped: 0,
    nack: 0,
    pli: 0,
    bufferDelay: 30,
    bufferEmitted: 600,
  };
}

export function audioInState(): NonNullable<TraceState['audioIn']> {
  return { packets: 2000, lost: 0, bytes: 200_000, samples: 960_000, concealed: 0, silent: 0, events: 0 };
}

export function traceReport(s: TraceState): RtcStat[] {
  const out: RtcStat[] = [
    { id: 'T01', type: 'transport', selectedCandidatePairId: s.pairId, bytesSent: s.bytesSent, bytesReceived: s.bytesReceived, dtlsState: 'connected' },
    {
      id: s.pairId,
      type: 'candidate-pair',
      localCandidateId: 'Iabc',
      remoteCandidateId: 'Idef',
      state: 'succeeded',
      nominated: true,
      currentRoundTripTime: s.rtt,
      requestsSent: s.requestsSent,
      responsesReceived: s.responsesReceived,
      availableOutgoingBitrate: s.availableOut,
      bytesSent: s.bytesSent,
      bytesReceived: s.bytesReceived,
      packetsDiscardedOnSend: s.discardedOnSend,
    },
    { id: 'Iabc', type: 'local-candidate', address: '192.168.1.20', port: 54321, protocol: 'udp', candidateType: 'srflx' },
    { id: 'Idef', type: 'remote-candidate', address: '203.0.113.7', port: 7882, protocol: 'udp', candidateType: 'host' },
  ];
  if (s.mic) {
    out.push(
      { id: 'SA1', type: 'media-source', kind: 'audio', trackIdentifier: 'mic-track' },
      { id: 'OTA1', type: 'outbound-rtp', kind: 'audio', ssrc: 1, mediaSourceId: 'SA1', packetsSent: s.mic.packets, bytesSent: s.mic.bytes, active: true },
      { id: 'RIA1', type: 'remote-inbound-rtp', kind: 'audio', ssrc: 1, localId: 'OTA1', packetsLost: s.mic.lost, fractionLost: 0, jitter: 0.004, roundTripTime: 0.045 },
    );
  }
  if (s.screen) {
    const v = s.screen;
    out.push(
      { id: 'SV1', type: 'media-source', kind: 'video', trackIdentifier: 'screen-track' },
      {
        id: 'OTV2',
        type: 'outbound-rtp',
        kind: 'video',
        ssrc: 2,
        mediaSourceId: 'SV1',
        active: true,
        packetsSent: v.packets,
        bytesSent: v.bytes,
        targetBitrate: v.targetBitrate,
        framesEncoded: v.framesEncoded,
        framesSent: v.framesSent,
        keyFramesEncoded: v.keyFrames,
        hugeFramesSent: v.hugeFrames,
        nackCount: v.nack,
        pliCount: v.pli,
        firCount: v.fir,
        retransmittedBytesSent: v.retransBytes,
        retransmittedPacketsSent: v.retransPackets,
        totalPacketSendDelay: v.sendDelay,
        totalEncodeTime: v.encodeTime,
        qualityLimitationReason: v.limitation,
        frameWidth: 1920,
        frameHeight: 1080,
        framesPerSecond: 30,
      },
      { id: 'RIV2', type: 'remote-inbound-rtp', kind: 'video', ssrc: 2, localId: 'OTV2', packetsLost: v.lost, fractionLost: 0.1, jitter: 0.01, roundTripTime: 0.05 },
      // Simulcast'in kapalı katmanı: sayılmamalı
      { id: 'OTV9', type: 'outbound-rtp', kind: 'video', ssrc: 9, mediaSourceId: 'SV1', active: false, packetsSent: 0, bytesSent: 0 },
    );
  }
  if (s.audioIn) {
    const a = s.audioIn;
    out.push({
      id: 'ITA5',
      type: 'inbound-rtp',
      kind: 'audio',
      packetsReceived: a.packets,
      packetsLost: a.lost,
      bytesReceived: a.bytes,
      jitter: 0.012,
      totalSamplesReceived: a.samples,
      concealedSamples: a.concealed,
      silentConcealedSamples: a.silent,
      concealmentEvents: a.events,
    });
  }
  if (s.videoIn) {
    const v = s.videoIn;
    out.push({
      id: 'ITV6',
      type: 'inbound-rtp',
      kind: 'video',
      packetsReceived: v.packets,
      packetsLost: v.lost,
      bytesReceived: v.bytes,
      jitter: 0.02,
      framesDecoded: v.framesDecoded,
      keyFramesDecoded: v.keyFrames,
      freezeCount: v.freezes,
      totalFreezesDuration: v.freezeSec,
      framesDropped: v.dropped,
      nackCount: v.nack,
      pliCount: v.pli,
      jitterBufferDelay: v.bufferDelay,
      jitterBufferEmittedCount: v.bufferEmitted,
      framesPerSecond: 30,
      frameWidth: 1920,
      frameHeight: 1080,
    });
  }
  return out;
}
