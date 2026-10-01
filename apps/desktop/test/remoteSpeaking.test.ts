import { describe, expect, it } from 'vitest';
import {
  heldSpeaking,
  rmsDb,
  SPEAKING_HOLD_MS,
  SPEAKING_THRESHOLD_DB,
} from '../src/renderer/src/features/voice/remoteSpeaking';

describe('uzak konuşma halkası (remoteSpeaking)', () => {
  it('RMS seviyesi dBFS olarak ölçülür; sessizlik -100', () => {
    expect(rmsDb(new Float32Array(2048))).toBe(-100);
    expect(rmsDb(new Float32Array(2048).fill(1))).toBeCloseTo(0, 5);
    expect(rmsDb(new Float32Array(2048).fill(0.1))).toBeCloseTo(-20, 5);
  });

  it('kısık konuşma eşiği aşar, gürültüsü engellenmiş arka plan aşmaz', () => {
    const tone = (amp: number): Float32Array => Float32Array.from({ length: 2048 }, (_, i) => amp * Math.sin(i / 7));
    expect(rmsDb(tone(0.01))).toBeGreaterThan(SPEAKING_THRESHOLD_DB); // ~-43 dBFS
    expect(rmsDb(tone(0.0005))).toBeLessThan(SPEAKING_THRESHOLD_DB); // ~-69 dBFS
  });

  it('ilk aşımda açılır, son aşımdan sonra bekleme süresince açık kalır', () => {
    expect(heldSpeaking(0, 1000)).toBe(false);
    expect(heldSpeaking(1000, 1000)).toBe(true);
    expect(heldSpeaking(1000, 1000 + SPEAKING_HOLD_MS - 1)).toBe(true);
    expect(heldSpeaking(1000, 1000 + SPEAKING_HOLD_MS)).toBe(false);
  });
});
