import { describe, expect, it } from 'vitest';
import { MicSequencer } from '../src/renderer/src/features/voice/micSequencer';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Elle bitirilen iş: kaç tanesinin aynı anda sürdüğünü ölçmek için */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

describe('mikrofon kurulum sırası (MicSequencer)', () => {
  it('işler üst üste binmez; biri hata verse de sıra sürer', async () => {
    const seq = new MicSequencer<object>();
    let running = 0;
    let maxRunning = 0;
    const order: string[] = [];
    const g = gate();
    const job = (name: string, wait?: Promise<void>, fail = false) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      order.push(`${name}:başla`);
      await wait;
      await tick();
      running--;
      order.push(`${name}:bitti`);
      if (fail) throw new Error(name);
    };
    const a = seq.run(job('yayınla', g.promise, true));
    const b = seq.run(job('yeniden'));
    await tick();
    expect(order).toEqual(['yayınla:başla']);
    g.open();
    await expect(a).rejects.toThrow('yayınla');
    await b;
    expect(maxRunning).toBe(1);
    expect(order).toEqual(['yayınla:başla', 'yayınla:bitti', 'yeniden:başla', 'yeniden:bitti']);
  });

  it('başlamamış yeniden kurulum istekleri birleşir; sürerken gelen istek ondan sonra ayrıca yapılır', async () => {
    const seq = new MicSequencer<object>();
    let rebuilds = 0;
    const g = gate();
    const busy = seq.run(() => g.promise);
    const rebuild = async () => {
      rebuilds++;
      await tick();
    };
    const r1 = seq.requestRebuild(() => true, rebuild);
    const r2 = seq.requestRebuild(() => true, rebuild);
    const r3 = seq.requestRebuild(() => true, rebuild);
    expect(r2).toBe(r1);
    expect(r3).toBe(r1);
    g.open();
    await busy;
    // Birincisi başladı (sırası geldi): yeni istek ona katılmaz, arkasına girer
    await tick();
    const r4 = seq.requestRebuild(() => true, rebuild);
    expect(r4).not.toBe(r1);
    await Promise.all([r1, r4]);
    expect(rebuilds).toBe(2);
  });

  it('bağlı değilken istenen yeniden kurulum atılmaz, bağlantı gelince bir kez yapılır', async () => {
    const seq = new MicSequencer<object>();
    let connected = false;
    let rebuilds = 0;
    await seq.requestRebuild(
      () => connected,
      async () => {
        rebuilds++;
      },
    );
    expect(rebuilds).toBe(0);
    connected = true;
    expect(seq.takeDeferred()).toBe(true);
    expect(seq.takeDeferred()).toBe(false);
    await seq.requestRebuild(
      () => connected,
      async () => {
        rebuilds++;
      },
    );
    expect(rebuilds).toBe(1);
  });

  it('mikrofon baştan kurulunca ertelenen iş düşer', async () => {
    const seq = new MicSequencer<object>();
    await seq.requestRebuild(
      () => false,
      async () => undefined,
    );
    seq.clearDeferred();
    expect(seq.takeDeferred()).toBe(false);
  });

  it('yalnızca güncel işlemcinin olayları dikkate alınır (eski ve henüz kurulan zincirler yok sayılır)', () => {
    const seq = new MicSequencer<{ id: number }>();
    const old = { id: 1 };
    const next = { id: 2 };
    const levels: number[] = [];
    const onLevel = (p: { id: number }) => () => {
      if (seq.isCurrent(p)) levels.push(p.id);
    };
    seq.current = old;
    onLevel(old)();
    onLevel(next)(); // kuruluyor, henüz yayında değil
    seq.current = null; // yeniden yayınlanıyor
    onLevel(old)();
    seq.current = next;
    onLevel(old)(); // eski zincirin geç gelen seviyesi
    onLevel(next)();
    expect(levels).toEqual([1, 2]);
  });
});
