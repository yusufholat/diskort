import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ChannelSoundGate,
  encodeWav,
  OTHERS_QUIET_MS,
  OTHERS_SOUNDS,
  renderSound,
  SFX_PEAK_DBFS,
  SFX_SAMPLE_RATE,
  SOUND_LABELS,
  SOUND_NAMES,
  type SoundName,
} from '../src/sfx';

const dbfs = (v: number): number => 20 * Math.log10(v);
const peak = (b: Float32Array): number => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const ms = (b: Float32Array): number => (b.length / SFX_SAMPLE_RATE) * 1000;

/** Ardışık iki örnek arasındaki en büyük fark: kesinti/tık olursa sıçrar */
function maxJump(b: Float32Array): number {
  let jump = 0;
  for (let i = 1; i < b.length; i++) jump = Math.max(jump, Math.abs(b[i]! - b[i - 1]!));
  return jump;
}

/** Ardışık 25 ms'lik pencerelerin RMS'i (dBFS) */
function envelope(b: Float32Array): number[] {
  const w = Math.round(0.025 * SFX_SAMPLE_RATE);
  const out: number[] = [];
  for (let i = 0; i + w <= b.length; i += w) {
    let sum = 0;
    for (let k = i; k < i + w; k++) sum += b[k]! * b[k]!;
    out.push(dbfs(Math.sqrt(sum / w)));
  }
  return out;
}

/** Tasarımdaki seviye ayarları (dB): tepe = -15 dBFS + bu değer */
const TRIM_DB: Record<SoundName, number> = {
  join: 0,
  leave: 0,
  userJoin: -5,
  userLeave: -5,
  mute: 0,
  unmute: 0,
  deafen: 0,
  undeafen: 0,
  streamStart: -1,
  streamStop: -1,
  userStreamStart: -5,
  userStreamStop: -5,
  mention: 0,
  disconnect: 0,
  reconnected: -2,
  pttOn: -10,
  pttOff: -10,
};

describe('arayüz sesleri', () => {
  it('her sesin adı var, tepe hedefinde (-15 dBFS + sese özel ayar, ±0,5 dB), kırpılma yok', () => {
    expect(SFX_PEAK_DBFS).toBe(-15);
    for (const name of SOUND_NAMES) {
      expect(SOUND_LABELS[name], name).toBeTruthy();
      const b = renderSound(name);
      expect(b.every((v) => Number.isFinite(v) && Math.abs(v) < 1), name).toBe(true);
      const p = dbfs(peak(b));
      expect(p, name).toBeLessThanOrEqual(SFX_PEAK_DBFS + 0.01);
      expect(Math.abs(p - (SFX_PEAK_DBFS + TRIM_DB[name])), name).toBeLessThanOrEqual(0.5);
    }
  });

  it('kısa ve tıksız: sessizlikle başlar ve biter, sert başlangıç ve kesinti yok, DC yok', () => {
    for (const name of SOUND_NAMES) {
      const b = renderSound(name);
      expect(ms(b), name).toBeGreaterThanOrEqual(60);
      expect(ms(b), name).toBeLessThanOrEqual(600);
      expect(Math.abs(b[0]!), name).toBeLessThan(1e-3);
      expect(Math.abs(b[b.length - 1]!), name).toBeLessThan(1e-3);
      // İlk 1 ms tepenin %5 altında
      expect(peak(b.subarray(0, Math.round(0.001 * SFX_SAMPLE_RATE))), name).toBeLessThan(0.05 * peak(b));
      expect(maxJump(b), name).toBeLessThan(0.04);
      const mean = b.reduce((s, v) => s + v, 0) / b.length;
      expect(Math.abs(mean), name).toBeLessThan(1e-4);
    }
  });

  it('katılma/ayrılma düz: ilk 150 ms boyunca seviye 3 dB içinde kalır (zıplayan iki vuruş değil)', () => {
    for (const name of ['join', 'leave'] as const) {
      const head = envelope(renderSound(name)).slice(0, 6);
      expect(Math.max(...head) - Math.min(...head), name).toBeLessThanOrEqual(3);
    }
  });

  it('başkalarının olayları kendi katılma/ayrılma sesinden en az 2 dB kısık', () => {
    const own = Math.min(peak(renderSound('join')), peak(renderSound('leave')));
    for (const name of OTHERS_SOUNDS) {
      expect(dbfs(peak(renderSound(name))), name).toBeLessThan(dbfs(own) - 2);
    }
  });

  it('her çalışta aynı örnekler', () => {
    expect(renderSound('join')).toEqual(renderSound('join'));
    expect(renderSound('join')).toEqual(renderSound('join', SFX_SAMPLE_RATE));
  });

  it('başkalarının olayları: bağlanınca sel yok, aynı anda gelenler tek ses, öncelikli olan duyulur', () => {
    vi.useFakeTimers();
    try {
      const played: string[] = [];
      const gate = new ChannelSoundGate((n) => played.push(n));
      gate.quiet();
      gate.push('userJoin');
      gate.push('userStreamStart');
      vi.advanceTimersByTime(OTHERS_QUIET_MS + 100);
      expect(played).toEqual([]);

      gate.push('userStreamStop');
      gate.push('userLeave');
      vi.advanceTimersByTime(100);
      expect(played).toEqual(['userLeave']);

      // Hemen ardından gelen ikinci giriş yutulur, biraz sonra gelen çalınır
      gate.push('userJoin');
      vi.advanceTimersByTime(100);
      expect(played).toEqual(['userLeave']);
      vi.advanceTimersByTime(400);
      gate.push('userJoin');
      vi.advanceTimersByTime(100);
      expect(played).toEqual(['userLeave', 'userJoin']);

      gate.push('userLeave');
      gate.cancel();
      vi.advanceTimersByTime(1000);
      expect(played).toEqual(['userLeave', 'userJoin']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('WAV başlığı: 48 kHz, mono, 16 bit', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]));
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getInt16(46, true)).toBe(16384);
  });

  it('telefondaki hazır sesler güncel (değişince: node apps/mobile/scripts/generate-sounds.mjs)', () => {
    const dir = join(__dirname, '..', '..', '..', 'apps', 'mobile', 'assets', 'sounds');
    for (const name of SOUND_NAMES) {
      const file = readFileSync(join(dir, `${name}.wav`));
      const expected = encodeWav(renderSound(name));
      expect(file.length, name).toBe(expected.length);
      const a = new Int16Array(Uint8Array.from(file.subarray(44)).buffer);
      const b = new Int16Array(expected.buffer, 44, (expected.length - 44) / 2);
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i]! - b[i]!));
      expect(diff, name).toBeLessThanOrEqual(1);
    }
  });
});
