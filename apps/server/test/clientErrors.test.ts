import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RingLog } from '../src/activity.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('istemci hata bildirimi', () => {
  it('geçerli bildirimi kabul eder, bozuk olanı reddeder, sınır uygular', async () => {
    ({ app } = await buildApp(loadConfig({ NODE_ENV: 'test', DATA_DIR: '.' }), { dbFile: ':memory:', logger: false }));
    const send = (payload: Record<string, unknown>) => app!.inject({ method: 'POST', url: '/api/client-errors', payload });
    const ok = { platform: 'android', version: '0.4.1', where: 'render', message: 'Maximum update depth exceeded', stack: 'at X' };

    expect((await send(ok)).statusCode).toBe(204);
    expect((await send({ ...ok, platform: 'amiga' })).statusCode).toBe(400);
    expect((await send({ ...ok, message: 'x'.repeat(501) })).statusCode).toBe(400);

    let last = 0;
    for (let i = 0; i < 25; i++) last = (await send(ok)).statusCode;
    expect(last).toBe(429);
  });
});

describe('hata kayıtlarının kalıcılığı', () => {
  it('kayıtlar dosyaya eklenir, yeniden açılışta son N geri yüklenir, 14 günden eskiler atılır', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-errors-'));
    try {
      const file = path.join(dir, 'client-errors.jsonl');
      const now = Date.now();
      fs.writeFileSync(file, JSON.stringify({ at: now - 15 * 86_400_000, message: 'eski' }) + '\nbozuk\n');
      const first = new RingLog<{ at: number; message: string }>(2, file, undefined, now);
      expect(first.recent(10)).toEqual([]);
      first.push({ at: now, message: 'a' });
      first.push({ at: now + 1, message: 'b' });
      first.push({ at: now + 2, message: 'c' });
      await new Promise((r) => setTimeout(r, 50));
      const second = new RingLog<{ at: number; message: string }>(2, file, undefined, now + 10);
      expect(second.recent(10).map((e: { message: string }) => e.message)).toEqual(['c', 'b']);
      expect(second.total).toBe(3);
      expect(fs.readFileSync(file, 'utf8')).not.toContain('eski');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
