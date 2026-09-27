import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ChannelSoundGate,
  DEFAULT_SOUND_PACK,
  encodeWav,
  isSoundPack,
  OTHERS_QUIET_MS,
  OTHERS_SOUNDS,
  renderSound,
  SFX_PEAK_DBFS,
  SFX_SAMPLE_RATE,
  SOUND_LABELS,
  SOUND_NAMES,
  SOUND_PACK_LABELS,
  SOUND_PACK_PEAK_DBFS,
  SOUND_PACKS,
  type SoundName,
  type SoundPack,
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

/** Örneklerin FNV-1a özeti (Float32 baytları üzerinden) */
function fnv(b: Float32Array): string {
  const bytes = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  let h = 0x811c9dc5;
  for (const v of bytes) h = Math.imul(h ^ v, 0x01000193) >>> 0;
  return `${h.toString(16).padStart(8, '0')}:${b.length}`;
}

/** Yumuşak paketin tasarımdaki seviye ayarları (dB): tepe = -15 dBFS + bu değer */
const SOFT_TRIM_DB: Record<SoundName, number> = {
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

/** Klasik paketin ses paketleri eklenmeden önceki çıktısı (örnek örnek aynı kalmalı) */
const CLASSIC_BEFORE_PACKS: Record<SoundName, string> = {
  join: '3a1bfebf:24916',
  leave: '42908258:26802',
  userJoin: '4d4bc5cc:24413',
  userLeave: '7d238ec4:20247',
  mute: '71080b36:11845',
  unmute: 'ee0a0914:11846',
  deafen: '2771b245:17594',
  undeafen: '853c3e2f:17553',
  streamStart: '12a4e27c:27781',
  streamStop: '2d70a5f4:29872',
  userStreamStart: '05ff9b9e:22064',
  userStreamStop: '82ac96cb:22884',
  mention: '78dd777e:25689',
  disconnect: '479b8dee:30877',
  reconnected: '00a3a375:19722',
  pttOn: 'bbbf7d9d:3847',
  pttOff: 'd93f86f8:3844',
};

/** Paket başına sınırlar: en uzun süre (ms), ardışık örnekler arası en büyük fark */
const LIMITS: Record<SoundPack, { maxMs: number; maxJump: number }> = {
  soft: { maxMs: 600, maxJump: 0.04 },
  classic: { maxMs: 750, maxJump: 0.15 },
};

describe('ses paketleri', () => {
  it('paketlerin adı var, varsayılan Yumuşak', () => {
    expect(DEFAULT_SOUND_PACK).toBe('soft');
    for (const pack of SOUND_PACKS) expect(SOUND_PACK_LABELS[pack]).toBeTruthy();
    expect(SOUND_PACK_LABELS.soft).toBe('Yumuşak');
    expect(isSoundPack('classic')).toBe(true);
    expect(isSoundPack('loud')).toBe(false);
    expect(isSoundPack(undefined)).toBe(false);
  });

  it('paket verilmezse Yumuşak paket üretilir', () => {
    expect(renderSound('join')).toEqual(renderSound('join', SFX_SAMPLE_RATE, 'soft'));
    expect(renderSound('join')).not.toEqual(renderSound('join', SFX_SAMPLE_RATE, 'classic'));
  });

  it('Klasik paket değişmedi (paketlerden önceki sesle örnek örnek aynı)', () => {
    for (const name of SOUND_NAMES) {
      expect(fnv(renderSound(name, SFX_SAMPLE_RATE, 'classic')), name).toBe(CLASSIC_BEFORE_PACKS[name]);
    }
  });

  it('Yumuşak paket: her sesin tepesi hedefinde (-15 dBFS + sese özel ayar, ±0,5 dB)', () => {
    expect(SOUND_PACK_PEAK_DBFS.soft).toBe(-15);
    for (const name of SOUND_NAMES) {
      const p = dbfs(peak(renderSound(name, SFX_SAMPLE_RATE, 'soft')));
      expect(Math.abs(p - (SOUND_PACK_PEAK_DBFS.soft + SOFT_TRIM_DB[name])), name).toBeLessThanOrEqual(0.5);
    }
  });

  it('Yumuşak paket: sert başlangıç yok (ilk 1 ms tepenin %5 altında)', () => {
    for (const name of SOUND_NAMES) {
      const b = renderSound(name, SFX_SAMPLE_RATE, 'soft');
      const onset = peak(b.subarray(0, Math.round(0.001 * SFX_SAMPLE_RATE)));
      expect(onset, name).toBeLessThan(0.05 * peak(b));
    }
  });

  for (const pack of SOUND_PACKS) {
    describe(`${SOUND_PACK_LABELS[pack]} paketi`, () => {
      it("her sesin adı var, tepe paketin seviyesini (ve -12 dBFS'yi) geçmez, kırpılma yok", () => {
        const cap = SOUND_PACK_PEAK_DBFS[pack];
        expect(cap).toBeLessThanOrEqual(SFX_PEAK_DBFS);
        for (const name of SOUND_NAMES) {
          expect(SOUND_LABELS[name], name).toBeTruthy();
          const b = renderSound(name, SFX_SAMPLE_RATE, pack);
          expect(b.every((v) => Number.isFinite(v) && Math.abs(v) < 1), name).toBe(true);
          const p = dbfs(peak(b));
          expect(p, name).toBeLessThanOrEqual(cap + 0.01);
          // Bas-konuş sesleri bilerek kısık; diğerleri paket seviyesinin 6 dB altından cılız değil
          expect(p, name).toBeGreaterThan(cap - (name.startsWith('ptt') ? 12 : 6));
        }
      });

      it('kısa ve tıksız: sessizlikle başlar ve biter, kesinti yok, DC yok', () => {
        for (const name of SOUND_NAMES) {
          const b = renderSound(name, SFX_SAMPLE_RATE, pack);
          expect(ms(b), name).toBeGreaterThanOrEqual(60);
          expect(ms(b), name).toBeLessThanOrEqual(LIMITS[pack].maxMs);
          expect(Math.abs(b[0]!), name).toBeLessThan(1e-3);
          expect(Math.abs(b[b.length - 1]!), name).toBeLessThan(1e-3);
          expect(maxJump(b), name).toBeLessThan(LIMITS[pack].maxJump);
          const mean = b.reduce((s, v) => s + v, 0) / b.length;
          expect(Math.abs(mean), name).toBeLessThan(1e-4);
        }
      });

      it('başkalarının olayları kendi katılma/ayrılma sesinden en az 2 dB kısık', () => {
        const own = Math.min(
          peak(renderSound('join', SFX_SAMPLE_RATE, pack)),
          peak(renderSound('leave', SFX_SAMPLE_RATE, pack)),
        );
        for (const name of OTHERS_SOUNDS) {
          expect(dbfs(peak(renderSound(name, SFX_SAMPLE_RATE, pack))), name).toBeLessThan(dbfs(own) - 2);
        }
      });

      it('her çalışta aynı örnekler', () => {
        expect(renderSound('join', SFX_SAMPLE_RATE, pack)).toEqual(renderSound('join', SFX_SAMPLE_RATE, pack));
      });
    });
  }
});

describe('arayüz sesleri', () => {
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
    for (const pack of SOUND_PACKS) {
      const dir = join(__dirname, '..', '..', '..', 'apps', 'mobile', 'assets', 'sounds', pack);
      for (const name of SOUND_NAMES) {
        const file = readFileSync(join(dir, `${name}.wav`));
        const expected = encodeWav(renderSound(name, SFX_SAMPLE_RATE, pack));
        expect(file.length, `${pack}/${name}`).toBe(expected.length);
        const a = new Int16Array(Uint8Array.from(file.subarray(44)).buffer);
        const b = new Int16Array(expected.buffer, 44, (expected.length - 44) / 2);
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i]! - b[i]!));
        expect(diff, `${pack}/${name}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
