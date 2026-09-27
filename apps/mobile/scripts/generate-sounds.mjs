// Sesli sohbet seslerini (assets/sounds/*.wav) üretir. Masaüstü bu sesleri Web Audio ile anında
// sentezliyor (apps/desktop/src/renderer/src/lib/sfx.ts); telefonda aynı notalar dosyaya yazılıp
// expo-audio ile çalınır. Notalar değişirse: node scripts/generate-sounds.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** [frekans, başlangıç ms, süre ms] — masaüstündeki SOUNDS ile aynı */
const SOUNDS = {
  join: { notes: [[523, 0, 90], [784, 80, 140]], type: 'sine', gain: 0.18 },
  leave: { notes: [[659, 0, 90], [440, 80, 160]], type: 'sine', gain: 0.18 },
  userJoin: { notes: [[587, 0, 70], [880, 60, 110]], type: 'triangle', gain: 0.12 },
  userLeave: { notes: [[698, 0, 70], [466, 60, 120]], type: 'triangle', gain: 0.12 },
  mute: { notes: [[392, 0, 80]], type: 'sine', gain: 0.16 },
  unmute: { notes: [[587, 0, 80]], type: 'sine', gain: 0.16 },
  deafen: { notes: [[440, 0, 70], [330, 60, 110]], type: 'sine', gain: 0.16 },
  undeafen: { notes: [[330, 0, 70], [494, 60, 110]], type: 'sine', gain: 0.16 },
  streamStart: { notes: [[523, 0, 70], [659, 60, 70], [784, 120, 120]], type: 'triangle', gain: 0.12 },
  streamStop: { notes: [[784, 0, 70], [659, 60, 70], [523, 120, 120]], type: 'triangle', gain: 0.12 },
};

const RATE = 44100;
// Telefon hoparlörü masaüstü hoparlöründen kısık: dosyalar daha yüksek seviyede yazılır, uygulama
// çalarken seviyeyi kendisi ayarlar (src/sounds.ts)
const BOOST = 3;

function wave(type, phase) {
  const x = phase % 1;
  return type === 'triangle' ? 1 - 4 * Math.abs(x - 0.5) : Math.sin(2 * Math.PI * x);
}

function render({ notes, type, gain }) {
  const endMs = Math.max(...notes.map(([, start, dur]) => start + dur)) + 30;
  const out = new Float32Array(Math.ceil((endMs / 1000) * RATE));
  const peak = gain * BOOST;
  for (const [freq, startMs, durMs] of notes) {
    const t0 = startMs / 1000;
    const t1 = t0 + durMs / 1000;
    const from = Math.floor(t0 * RATE);
    const to = Math.min(out.length, Math.ceil((t1 + 0.02) * RATE));
    for (let i = from; i < to; i++) {
      const t = i / RATE;
      // Web Audio'daki zarf: 10 ms'de doğrusal yükseliş, t1'e kadar üstel sönüm
      let g;
      if (t < t0 + 0.01) g = (peak * (t - t0)) / 0.01;
      else if (t < t1) g = peak * Math.pow(0.0001 / peak, (t - t0 - 0.01) / (t1 - t0 - 0.01));
      else g = 0;
      out[i] += g * wave(type, freq * (t - t0));
    }
  }
  return out;
}

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return buf;
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');
mkdirSync(dir, { recursive: true });
for (const [name, spec] of Object.entries(SOUNDS)) {
  writeFileSync(join(dir, `${name}.wav`), wav(render(spec)));
}
console.log(`${Object.keys(SOUNDS).length} ses yazıldı: ${dir}`);
