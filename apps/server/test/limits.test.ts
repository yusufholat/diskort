import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RingLog } from '../src/activity.js';
import { createRateLimiter } from '../src/routes/messages.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('istek sınırlayıcı', () => {
  it('süresi dolan anahtarları temizler; çok sayıda adresle bellek sınırsız büyümez', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const allow = createRateLimiter(2, 1_000);
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(false);
    for (let i = 0; i < 10_001; i++) allow(`ip-${i}`);
    expect(allow.size()).toBe(10_002);

    // Pencere geçti: bir sonraki istek eskileri siler
    vi.setSystemTime(1_000_000 + 2_000);
    expect(allow('yeni')).toBe(true);
    expect(allow.size()).toBe(1);
    // Silinen anahtar sıfırdan başlar
    expect(allow('a')).toBe(true);

    // Pencere içinde sel: üst sınırı aşınca en eskiler unutulur
    for (let i = 0; i < 60_000; i++) allow(`sel-${i}`);
    expect(allow.size()).toBeLessThanOrEqual(50_001);
  });
});

describe('hata kaydı dosyası', () => {
  it('çalışırken 2N satırı aşınca son N kayıtla yeniden yazılır', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-ring-'));
    try {
      const file = path.join(dir, 'client-errors.jsonl');
      const now = Date.now();
      const log = new RingLog<{ at: number; n: number }>(3, file, undefined, now);
      const lines = () => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      for (let n = 1; n <= 6; n++) log.push({ at: now + n, n });
      await log.flushed();
      expect(lines()).toHaveLength(6);
      log.push({ at: now + 7, n: 7 });
      await log.flushed();
      expect(lines().map((l) => (JSON.parse(l) as { n: number }).n)).toEqual([5, 6, 7]);
      for (let n = 8; n <= 100; n++) log.push({ at: now + n, n });
      await log.flushed();
      expect(lines().length).toBeLessThanOrEqual(6);
      expect(lines().at(-1)).toContain('"n":100');
      expect(log.recent(3).map((e) => e.n)).toEqual([100, 99, 98]);
      expect(fs.existsSync(`${file}.tmp`)).toBe(false);

      // Açılışta da en fazla 2N satır kalır
      fs.appendFileSync(file, Array.from({ length: 20 }, (_, i) => JSON.stringify({ at: now, n: 200 + i })).join('\n') + '\n');
      const reopened = new RingLog<{ at: number; n: number }>(3, file, undefined, now + 1000);
      expect(lines()).toHaveLength(6);
      expect(reopened.recent(1)[0]?.n).toBe(219);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
