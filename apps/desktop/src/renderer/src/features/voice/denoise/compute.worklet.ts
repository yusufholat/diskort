// Gürültü engelleme için BİRİNCİL barındırıcı: ayrı, sessiz bir AudioContext'in AudioWorklet'i.
//
// Neden: Chromium her AudioContext'e kendi gerçek zamanlı öncelikli ses iş parçacığını verir. Model burada
// çalışınca işlemci çok yoğunken (oyun, derleme) bile bekletilmez; normal öncelikli bir Web Worker ise böyle
// anlarda 20–100 ms bekletilebiliyor (ölçüldü). Mikrofonun işlendiği asıl bağlamdaki köprü (bridge-worklet.js)
// yalnızca paylaşımlı halkalara örnek kopyalar; bu bağlam geç kalsa bile (kendi çıkışı sessiz ve kullanılmıyor)
// asıl bağlamın sesi etkilenmez. Bu bağlamın her ses bloğunda (2,67 ms) giriş halkasında tam kare var mı diye
// bakılır; varsa işlenip çıkış halkasına yazılır. DPDFNet (onnxruntime) Promise döndürür; wasm çıkarımı yine
// eşzamanlı yapılır ve blok bitmeden mikro görevlerde tamamlanır.
//
// Vite bu dosyayı ?worker&url ile tek bir ES modülü olarak paketler (onnxruntime-web dahil).
import './worklet-shim';
import { createEngineFactory, FrameTimer, warmUp, type Engine, type EngineInit, type HostMessage } from './engine';
import { HOP, readHop, ringCounters, ringViews, writeHop } from './ring';

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: new (options: { processorOptions: unknown }) => unknown): void;

export type ComputeInit = { sab: SharedArrayBuffer } & EngineInit;

/** AudioWorkletGlobalScope'ta performance yok (1 ms çözünürlüklü Date.now) */
const now = (): number => Date.now();

class DiskortDenoiseCompute extends AudioWorkletProcessor {
  private engine: Engine | null = null;
  private busy = false;
  private failed = false;
  private readonly ring: ReturnType<typeof ringViews>;
  private readonly pos = { inR: 0, outW: 0 };
  private readonly hop = new Float32Array(HOP);
  private readonly out = new Float32Array(HOP);
  private readonly timer = new FrameTimer(now);
  private frameStart = 0;

  constructor(options: { processorOptions: unknown }) {
    super();
    const init = options.processorOptions as ComputeInit;
    this.ring = ringViews(init.sab);
    this.port.onmessage = (e: MessageEvent<{ type: 'atten'; db: number }>) => {
      if (e.data.type === 'atten') this.engine?.setAttenLimit(e.data.db);
    };
    void (async () => {
      const make = await createEngineFactory(init);
      const warmupFrameMs = await warmUp(make(), now);
      this.engine = make(); // canlı ses temiz durumla başlar
      this.post({ type: 'ready', warmupFrameMs });
    })().catch((err: unknown) => this.fail(err));
  }

  private post(msg: HostMessage): void {
    this.port.postMessage(msg);
  }

  private fail(err: unknown): void {
    this.failed = true;
    this.post({ type: 'error', message: String((err as Error)?.message ?? err) });
  }

  private finish = (): void => {
    this.timer.add(now() - this.frameStart);
    writeHop(this.ring.ctrl, this.ring.output, this.pos, this.out);
    this.busy = false;
  };

  process(): boolean {
    const engine = this.engine;
    if (!engine || this.failed) return true;
    // Geride kalındıysa bir blokta en fazla 2 kare (yetişmek için), DPDFNet'te bir seferde tek kare
    for (let k = 0; k < 2 && !this.busy; k++) {
      if (!readHop(this.ring.ctrl, this.ring.input, this.pos, this.hop)) break;
      this.frameStart = now();
      try {
        const r = engine.process(this.hop, this.out);
        if (r instanceof Promise) {
          this.busy = true;
          r.then(this.finish, (err: unknown) => this.fail(err));
        } else this.finish();
      } catch (err) {
        this.fail(err);
      }
    }
    const stats = this.timer.take();
    if (stats) this.post({ type: 'stats', ...stats, ...ringCounters(this.ring.ctrl) });
    return true;
  }
}

registerProcessor('diskort-denoise-compute', DiskortDenoiseCompute);
