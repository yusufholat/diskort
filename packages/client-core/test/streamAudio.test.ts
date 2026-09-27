import { describe, expect, it } from 'vitest';
import {
  isStreamMuted,
  setStreamVolume,
  shownStreamVolume,
  streamAudioOutput,
  toggleStreamMute,
  type StreamAudioPrefs,
} from '../src/streamAudio';

const empty: StreamAudioPrefs = { streamVolumes: {}, streamMuted: {} };

describe('yayın sesi tercihi', () => {
  it('varsayılan: %100 ve duyulur', () => {
    expect(isStreamMuted(empty, 'a')).toBe(false);
    expect(streamAudioOutput(empty, 'a', false)).toEqual({ volume: 1, enabled: true });
  });

  it('sessize alıp açınca önceki seviyeye döner', () => {
    const at80 = setStreamVolume(empty, 'a', 0.8);
    const muted = toggleStreamMute(at80, 'a');
    expect(isStreamMuted(muted, 'a')).toBe(true);
    expect(shownStreamVolume(muted, 'a')).toBe(0);
    expect(streamAudioOutput(muted, 'a', false)).toEqual({ volume: 0, enabled: false });
    const back = toggleStreamMute(muted, 'a');
    expect(isStreamMuted(back, 'a')).toBe(false);
    expect(streamAudioOutput(back, 'a', false)).toEqual({ volume: 0.8, enabled: true });
  });

  it('art arda açıp kapamak her seferinde durumu değiştirir', () => {
    let prefs = empty;
    for (let i = 0; i < 6; i++) {
      const before = isStreamMuted(prefs, 'a');
      prefs = toggleStreamMute(prefs, 'a');
      expect(isStreamMuted(prefs, 'a')).toBe(!before);
    }
  });

  it('kaydırıcıyı 0a çekmek sessize alır ama seviyeyi korur; yukarı çekmek açar', () => {
    const at150 = setStreamVolume(empty, 'a', 1.5);
    const zero = setStreamVolume(at150, 'a', 0);
    expect(isStreamMuted(zero, 'a')).toBe(true);
    expect(zero.streamVolumes.a).toBe(1.5);
    expect(toggleStreamMute(zero, 'a').streamVolumes.a).toBe(1.5);
    const up = setStreamVolume(zero, 'a', 0.4);
    expect(isStreamMuted(up, 'a')).toBe(false);
    expect(up.streamVolumes.a).toBe(0.4);
  });

  it('%100 kaydedilmez', () => {
    const p = setStreamVolume(setStreamVolume(empty, 'a', 0.5), 'a', 1.001);
    expect(p.streamVolumes).toEqual({});
  });

  it('eski sürümde 0 kaydedilmiş seviye: açınca %100e döner', () => {
    const legacy: StreamAudioPrefs = { streamVolumes: { a: 0 }, streamMuted: {} };
    expect(isStreamMuted(legacy, 'a')).toBe(true);
    const on = toggleStreamMute(legacy, 'a');
    expect(isStreamMuted(on, 'a')).toBe(false);
    expect(streamAudioOutput(on, 'a', false)).toEqual({ volume: 1, enabled: true });
  });

  it('sağırken hiçbir yayın duyulmaz; tercih değişmez', () => {
    const p = setStreamVolume(empty, 'a', 1.2);
    expect(streamAudioOutput(p, 'a', true)).toEqual({ volume: 0, enabled: false });
    expect(streamAudioOutput(p, 'a', false)).toEqual({ volume: 1.2, enabled: true });
  });

  it('kişiler birbirinden bağımsız', () => {
    const p = toggleStreamMute(setStreamVolume(empty, 'b', 0.3), 'a');
    expect(isStreamMuted(p, 'a')).toBe(true);
    expect(streamAudioOutput(p, 'b', false)).toEqual({ volume: 0.3, enabled: true });
  });
});
