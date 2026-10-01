import { describe, expect, it } from 'vitest';
import {
  absentParticipants,
  callKey,
  callRecordState,
  callRecordText,
  newIncomingCalls,
  voiceViewTarget,
  wantedCallSounds,
} from '../src/renderer/src/features/calls/callLogic.js';

const base = {
  incoming: 0,
  selfId: 'me',
  voiceChannelId: 'dm1',
  inVoice: true,
  call: { ringing: ['bob'] },
  members: ['me'],
};

describe('arama sesleri', () => {
  it('seni çalan arama varken zil çalar, bekleme sesi çalmaz', () => {
    expect(wantedCallSounds({ ...base, incoming: 1 })).toEqual({ ring: true, ringback: false });
    expect(wantedCallSounds({ ...base, incoming: 1, inVoice: false, voiceChannelId: null, call: undefined })).toEqual({
      ring: true,
      ringback: false,
    });
  });

  it('aradığın kişi henüz açmadıysa ve çalınıyorsa bekleme sesi çalar', () => {
    expect(wantedCallSounds(base)).toEqual({ ring: false, ringback: true });
  });

  it('biri katılınca, çalınan kalmayınca ya da sunucu kanalındayken bekleme sesi susar', () => {
    expect(wantedCallSounds({ ...base, members: ['me', 'bob'] }).ringback).toBe(false);
    expect(wantedCallSounds({ ...base, call: { ringing: [] } }).ringback).toBe(false);
    expect(wantedCallSounds({ ...base, call: { ringing: ['me'] } }).ringback).toBe(false);
    expect(wantedCallSounds({ ...base, call: undefined }).ringback).toBe(false);
    expect(wantedCallSounds({ ...base, inVoice: false }).ringback).toBe(false);
  });
});

describe('aramada olmayanlar', () => {
  it('kendin ve aramadakiler hariç, çalınanlar işaretli', () => {
    expect(absentParticipants(['me', 'a', 'b', 'c'], ['me', 'a'], 'me', ['c'])).toEqual([
      { userId: 'b', ringing: false },
      { userId: 'c', ringing: true },
    ]);
    expect(absentParticipants(['me', 'a'], ['me', 'a'], 'me', [])).toEqual([]);
  });
});

describe('arama kaydı', () => {
  const at = 1_000_000;
  it('sürüyor, cevapsız, süresiyle bitti', () => {
    expect(callRecordState({ type: 'call', call: { participantIds: ['a'], endedAt: null }, createdAt: at })).toEqual({
      kind: 'ongoing',
    });
    expect(callRecordState({ type: 'call', call: { participantIds: ['a'], endedAt: at + 30_000 }, createdAt: at })).toEqual(
      { kind: 'missed' },
    );
    expect(
      callRecordState({ type: 'call', call: { participantIds: ['a', 'b'], endedAt: at + 12 * 60_000 }, createdAt: at }),
    ).toEqual({ kind: 'ended', duration: '12 dk' });
  });

  it('metin arayanın kim olduğuna göre', () => {
    expect(callRecordText({ kind: 'ongoing' }, false)).toBe('arama başlattı');
    expect(callRecordText({ kind: 'missed' }, false)).toBe('aradı · Cevapsız arama');
    expect(callRecordText({ kind: 'missed' }, true)).toBe('arama başlattı · Cevapsız arama');
    expect(callRecordText({ kind: 'ended', duration: '45 sn' }, true)).toBe('arama başlattı · 45 sn sürdü');
  });
});

describe('yeni gelen aramalar', () => {
  it('yalnızca önceden görülmeyenler; aynı konuşmada yeni arama yeni sayılır', () => {
    const a = { channelId: 'dm1', startedAt: 1 };
    const b = { channelId: 'dm2', startedAt: 2 };
    expect(newIncomingCalls(new Set(), [a, b])).toEqual([callKey(a), callKey(b)]);
    expect(newIncomingCalls(new Set([callKey(a)]), [a, b])).toEqual([callKey(b)]);
    expect(newIncomingCalls(new Set([callKey(a)]), [{ channelId: 'dm1', startedAt: 5 }])).toEqual(['dm1:5']);
  });
});

describe('ses sahnesi hedefi', () => {
  it('DM aramasında konuşmanın kendisi, sunucu kanalında sahne', () => {
    expect(voiceViewTarget('dm1', { dm1: {} })).toEqual({ kind: 'dm', channelId: 'dm1' });
    expect(voiceViewTarget('ch1', { dm1: {} })).toEqual({ kind: 'voice' });
    expect(voiceViewTarget(null, {})).toEqual({ kind: 'voice' });
  });
});
