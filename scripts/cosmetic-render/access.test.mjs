// AVIF sırasız çözme kararının sınaması: node --test scripts/cosmetic-render/access.test.mjs
// (araç dosyası; uygulamaların test komutlarına girmez)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessVerdict } from './access.mjs';

const scenario = (worstColor, worstAlpha = 0, errors = [], frames = 3) => ({ worstColor, worstAt: 0, worstAlpha, frames, errors });
const good = () => ({
  summary: {
    skip: scenario(1.3),
    inOrder: scenario(1.3, 0, [], 180),
    wrap: scenario(1.2),
    cold: scenario(1.3),
    coldNext: scenario(1.3, 0, ['91: Failed to decode frame at index 91'], 1),
  },
  points: {},
});

test('doğru dosya geçer (coldNext çözücü hatası bilgi için)', () => {
  assert.equal(accessVerdict(good()).ok, true);
});

test('başa dönüşte renk kayması düşer', () => {
  const a = good();
  a.summary.wrap = scenario(13.6);
  assert.equal(accessVerdict(a).ok, false);
});

test('sırasız çözmede alfa kayması düşer', () => {
  const a = good();
  a.summary.skip = scenario(1.3, 40);
  assert.equal(accessVerdict(a).ok, false);
});

test('sıralı çözme de ffmpeg\'den uzaksa (taban bozuk) düşer', () => {
  const a = good();
  for (const s of Object.values(a.summary)) s.worstColor = 30;
  assert.equal(accessVerdict(a).ok, false);
  const b = good();
  for (const s of Object.values(b.summary)) s.worstAlpha = 60;
  assert.equal(accessVerdict(b).ok, false);
});

test('ölçüm hatası, eksik sonuç ya da çözülemeyen kare düşer', () => {
  assert.equal(accessVerdict({ error: 'karşılaştırma tabanı kısa' }).ok, false);
  assert.equal(accessVerdict(undefined).ok, false);
  const a = good();
  a.summary.cold = scenario(1.3, 0, ['45: Failed to decode frame at index 45'], 3);
  assert.equal(accessVerdict(a).ok, false);
  const b = good();
  b.summary.inOrder.frames = 0;
  assert.equal(accessVerdict(b).ok, false);
});
