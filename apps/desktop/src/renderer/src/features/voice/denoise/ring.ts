// Ses iş parçacığı (bridge-worklet.js) ile gürültü engelleme işçisi (denoise.worker.ts) arasındaki paylaşımlı
// bellek düzeni. bridge-worklet.js içe aktarma yapamadığından aynı sabitler orada da tanımlıdır; değiştirirken
// ikisini birlikte değiştir.
//
// [Int32 × CTRL_INTS denetim][Float32 × CAP giriş halkası][Float32 × CAP çıkış halkası]
// Sayaçlar toplam örnek sayısıdır (int32, taşınca sarar); halka konumu = sayaç & (CAP − 1).
// Yazan taraf veriyi yazıp sonra sayacı Atomics.store ile ilerletir, okuyan Atomics.load ile okur.

export const HOP = 480;
export const CAP = 8192;
export const CTRL_INTS = 8;
export const IN_WRITE = 0; // worklet yazar
export const IN_READ = 1; // işçi yazar
export const OUT_WRITE = 2; // işçi yazar
export const OUT_READ = 3; // worklet yazar
export const UNDERRUNS = 4; // worklet: çıkış tamponu boşaldı (ses boşluğu)
export const BUFFER_SAMPLES = 5; // worklet: şu anki hedef tampon (örnek)
export const DROPPED = 6; // worklet: işçi takıldığı için atılan örnekler (giriş taşması + gecikme kırpma)

/** Köprünün yazdığı sayaçlar (istatistik iletisi için) */
export function ringCounters(ctrl: Int32Array): { underruns: number; droppedSamples: number; bufferMs: number } {
  return {
    underruns: Atomics.load(ctrl, UNDERRUNS),
    droppedSamples: Atomics.load(ctrl, DROPPED),
    bufferMs: (Atomics.load(ctrl, BUFFER_SAMPLES) / 48000) * 1000,
  };
}

/**
 * Giriş halkasında tam bir kare varsa `hop` içine okur ve true döner. `pos.inR` okuma sayacıdır.
 */
export function readHop(
  ctrl: Int32Array,
  input: Float32Array,
  pos: { inR: number },
  hop: Float32Array,
): boolean {
  if (((Atomics.load(ctrl, IN_WRITE) - pos.inR) | 0) < HOP) return false;
  const mask = CAP - 1;
  for (let i = 0; i < HOP; i++) hop[i] = input[(pos.inR + i) & mask]!;
  pos.inR = (pos.inR + HOP) | 0;
  Atomics.store(ctrl, IN_READ, pos.inR);
  return true;
}

/** Temiz kareyi çıkış halkasına yazar (köprü okumuyorsa taşmasın diye atlar). `pos.outW` yazma sayacıdır. */
export function writeHop(ctrl: Int32Array, output: Float32Array, pos: { outW: number }, out: Float32Array): void {
  if (((pos.outW - Atomics.load(ctrl, OUT_READ)) | 0) + HOP > CAP) return;
  const mask = CAP - 1;
  for (let i = 0; i < HOP; i++) output[(pos.outW + i) & mask] = out[i]!;
  pos.outW = (pos.outW + HOP) | 0;
  Atomics.store(ctrl, OUT_WRITE, pos.outW);
}

export function createRing(): SharedArrayBuffer {
  return new SharedArrayBuffer(CTRL_INTS * 4 + 2 * CAP * 4);
}

export function ringViews(sab: SharedArrayBuffer): { ctrl: Int32Array; input: Float32Array; output: Float32Array } {
  return {
    ctrl: new Int32Array(sab, 0, CTRL_INTS),
    input: new Float32Array(sab, CTRL_INTS * 4, CAP),
    output: new Float32Array(sab, CTRL_INTS * 4 + CAP * 4, CAP),
  };
}
