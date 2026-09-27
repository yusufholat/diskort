// Gürültü engelleme için YEDEK barındırıcı: Web Worker. Birincil barındırıcı gerçek zamanlı hesap worklet'idir
// (compute.worklet.ts); o kurulamazsa model burada çalışır.
//
// Köprü (bridge-worklet.js) her 480 örnekte bir paylaşımlı giriş halkasına yazıp Atomics.notify ile bu işçiyi
// uyandırır; işçi kareyi işler ve çıkış halkasına yazar. Bekleme Atomics.waitAsync ile yapılır (onnxruntime'ın
// eşzamansız çağrıları için olay döngüsü açık kalır). Not: işçi iş parçacığı normal önceliklidir; işlemci çok
// yoğunken (oyun) ara sıra onlarca ms bekletilebilir, bu yüzden birincil yol gerçek zamanlı ses iş parçacığıdır.
import { createEngineFactory, FrameTimer, warmUp, type Engine, type EngineInit, type HostMessage } from './engine';
import { HOP, IN_WRITE, readHop, ringCounters, ringViews, writeHop } from './ring';

export type WorkerInit = { type: 'init'; sab: SharedArrayBuffer } & EngineInit;

// ES2024 (Chromium 87+); TypeScript kitaplığımız ES2023
const waitAsync = (
  Atomics as unknown as {
    waitAsync(a: Int32Array, i: number, v: number, t: number): { async: boolean; value: Promise<string> | string };
  }
).waitAsync;

function post(msg: HostMessage): void {
  (self as unknown as Worker).postMessage(msg);
}

const now = (): number => performance.now();
let engine: Engine | null = null;

async function run(msg: WorkerInit): Promise<void> {
  const make = await createEngineFactory(msg);
  const warmupFrameMs = await warmUp(make(), now);
  engine = make(); // canlı ses temiz durumla başlar
  post({ type: 'ready', warmupFrameMs });

  const { ctrl, input, output } = ringViews(msg.sab);
  const pos = { inR: 0, outW: 0 };
  const hop = new Float32Array(HOP);
  const out = new Float32Array(HOP);
  const timer = new FrameTimer(now);
  for (;;) {
    if (!readHop(ctrl, input, pos, hop)) {
      const w = waitAsync(ctrl, IN_WRITE, Atomics.load(ctrl, IN_WRITE), 1000);
      if (w.async) await w.value;
      continue;
    }
    const s = now();
    await engine.process(hop, out);
    timer.add(now() - s);
    writeHop(ctrl, output, pos, out);
    const stats = timer.take();
    if (stats) post({ type: 'stats', ...stats, ...ringCounters(ctrl) });
  }
}

self.onmessage = (e: MessageEvent<WorkerInit | { type: 'atten'; db: number }>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    run(msg).catch((err: unknown) => post({ type: 'error', message: String((err as Error)?.message ?? err) }));
  } else if (msg.type === 'atten') {
    engine?.setAttenLimit(msg.db);
  }
};
