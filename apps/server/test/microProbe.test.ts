import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultMicroTargets, MicroProbe, type MicroEvent, type MicroTarget } from '../src/microProbe.js';

const target: MicroTarget = { label: 'udp x', run: async () => 1, spikeMs: 100 };

function make(opts: { dir?: string | null } = {}): { p: MicroProbe; events: MicroEvent[] } {
  const events: MicroEvent[] = [];
  const p = new MicroProbe({ targets: [target], dir: opts.dir ?? null, onEvent: (e) => events.push(e), now: () => 1_000_000 });
  return { p, events };
}

describe('kısa kesinti dedektörü', () => {
  it('tek kayıp kesinti sayılmaz, art arda kayıp süresiyle olay olur', () => {
    const { p, events } = make();
    p.record(target, 0, 3);
    p.record(target, 100, null);
    p.record(target, 200, 3);
    expect(events).toHaveLength(0);
    p.record(target, 300, null);
    p.record(target, 400, null);
    p.record(target, 500, null);
    p.record(target, 600, 4);
    expect(events).toEqual([{ kind: 'kayip', target: 'udp x', at: 300, durationMs: 300, value: 3 }]);
  });

  it('gecikme sıçraması eşiğin üstünde olay olur', () => {
    const { p, events } = make();
    p.record(target, 0, 4);
    p.record(target, 100, 180);
    expect(events).toEqual([{ kind: 'gecikme', target: 'udp x', at: 100, durationMs: 180, value: 180 }]);
  });

  it('dakika dönünce özet satırı yazılır ve yalnızca kesinti/özet diske gider', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-micro-'));
    try {
      const { p } = make({ dir });
      p.record(target, 1_000, 3);
      p.record(target, 1_100, null);
      p.record(target, 1_200, null);
      p.record(target, 1_300, 3);
      p.record(target, 61_000, 3);
      await p.flush();
      const file = fs.readdirSync(dir).find((f) => f.startsWith('micro-'))!;
      const rows = fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(rows.map((r) => r.kind)).toEqual(['kayip', 'dakika']);
      expect(rows[1]).toMatchObject({ sent: 4, lost: 2, runs: 1, longestMs: 200 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hedef undefined dönerse sonda atlanır (kayıp sayılmaz)', async () => {
    const skip: MicroTarget = { label: 'gw', run: async () => undefined, spikeMs: 30 };
    const { p, events } = make();
    for (let i = 0; i < 5; i++) await p.once(skip, i * 100);
    expect(events).toHaveLength(0);
    expect(p.recent).toHaveLength(0);
  });

  it('ağ geçidi hiç yanıt vermezse bir süre sonra bırakılır, adres yoksa atlanır', async () => {
    const targets = defaultMicroTargets(() => null);
    const gw = targets.find((t) => t.label === 'ağ geçidi')!;
    expect(await gw.run()).toBeUndefined();
  });
});
