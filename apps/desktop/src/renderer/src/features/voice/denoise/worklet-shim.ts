// AudioWorkletGlobalScope'ta olmayan ama onnxruntime-web paketinin yüklenirken dokunduğu genel nesneler.
// compute.worklet.ts'de her şeyden ÖNCE içe aktarılmalı. Hiçbiri gerçek iş için kullanılmaz: wasm ikili
// dosyası doğrudan verilir (env.wasm.wasmBinary), iş parçacığı yok (numThreads = 1), ağ erişimi yok.
const g = globalThis as Record<string, unknown>;

if (typeof g.URL === 'undefined') {
  g.URL = class {
    href: string;
    constructor(u: unknown, base?: unknown) {
      const s = String(u);
      this.href = /^[a-z][a-z0-9+.-]*:/i.test(s) || base === undefined ? s : String(base).replace(/[^/]*$/, '') + s;
    }
    toString(): string {
      return this.href;
    }
  };
}
if (typeof g.self === 'undefined') g.self = g;
if (typeof g.navigator === 'undefined') g.navigator = { hardwareConcurrency: 1, userAgent: 'AudioWorklet' };
if (typeof g.location === 'undefined') g.location = { href: 'about:blank' };
if (typeof g.performance === 'undefined') {
  const t0 = Date.now();
  g.performance = { now: () => Date.now() - t0, timeOrigin: t0 };
}

export {};
