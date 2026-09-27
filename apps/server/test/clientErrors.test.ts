import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
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
