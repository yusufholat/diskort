import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ChannelSoundGate,
  encodeWav,
  OTHERS_QUIET_MS,
  renderSound,
  SFX_PEAK_DBFS,
  SFX_SAMPLE_RATE,
  SOUND_LABELS,
  SOUND_NAMES,
} from '../src/sfx';

const dbfs = (v: number): number => 20 * Math.log10(v);
const peak = (b: Float32Array): number => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('arayüz sesleri', () => {
  it("her sesin adı var ve tepe seviyesi -12 dBFS'yi geçmez", () => {
    for (const name of SOUND_NAMES) {
      expect(SOUND_LABELS[name], name).toBeTruthy();
      const p = dbfs(peak(renderSound(name)));
      expect(p, name).toBeLessThanOrEqual(SFX_PEAK_DBFS + 0.01);
      // Bas-konuş sesleri bilerek kısık; diğerleri -17 dBFS'den cılız değil
      expect(p, name).toBeGreaterThan(name.startsWith('ptt') ? -24 : -17);
    }
  });

  it('kısa ve tıksız: sessizlikle başlar, sessizlikle biter', () => {
    for (const name of SOUND_NAMES) {
      const b = renderSound(name);
      const ms = (b.length / SFX_SAMPLE_RATE) * 1000;
      expect(ms, name).toBeGreaterThanOrEqual(60);
      expect(ms, name).toBeLessThanOrEqual(750);
      expect(Math.abs(b[0]!), name).toBeLessThan(1e-3);
      expect(Math.abs(b[b.length - 1]!), name).toBeLessThan(1e-3);
    }
  });

  it('her çalışta aynı örnekler', () => {
    expect(renderSound('join')).toEqual(renderSound('join'));
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
