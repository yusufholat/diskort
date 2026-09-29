// Kozmetik motorunun yerel görünümlerle sözleşmesi (geri bildirim #28: Ayarlar → Profil'de çökme): sahte bir
// SkiaViewApi ve sahte Skia ile görünüm bağlanır, çizilir, güncellenir, kaldırılıp yeniden kurulur. Denetlenen:
// kalkmış görünüme setJsiProperty çağrılmaz, yerel görünüme verilmiş resim hemen bırakılmaz (RETIRE_MS
// sonra, tam bir kez), geçersiz boyut ve kimlik yerel tarafa gitmez, motorun zamanlayıcıları hata fırlatmaz.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => undefined }),
  },
  Dimensions: { get: () => ({ width: 400, height: 800 }) },
}));

vi.mock('../src/components/cosmetics/draw', () => ({
  compileCosmetic: () => null,
  drawCosmetic: () => undefined,
}));

interface FakePic {
  id: number;
  disposed: number;
  /** Yerel görünümdeki yerini yenisine bıraktığı (ya da görünüm kalktığı) an */
  replacedAt: number | null;
  dispose(): void;
}

let pics: FakePic[] = [];
/** Yerel tarafın her görünümde tuttuğu son resim */
let native = new Map<number, FakePic>();
/** Kalkmış görünümlerin kimlikleri (setJsiProperty bunlara gelmemeli) */
let dropped = new Set<number>();
let calls: { id: number; pic: FakePic }[] = [];
let failNext = false;

const fakeSkia = {
  Skia: {
    XYWHRect: (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h }),
    PictureRecorder: () => ({
      beginRecording: () => ({ scale: () => undefined }),
      finishRecordingAsPicture: () => {
        const pic: FakePic = {
          id: pics.length,
          disposed: 0,
          replacedAt: null,
          dispose() {
            // Yerel görünümün şu an çizdiği resim bırakılmamalı; yerini bıraktıysa en az RETIRE_MS geçmeli
            for (const [id, p] of native) if (p === pic && !dropped.has(id)) throw new Error(`resim ${pic.id} görünüm ${id}'de çizilirken bırakıldı`);
            if (pic.replacedAt !== null && Date.now() - pic.replacedAt < RETIRE_MS) throw new Error(`resim ${pic.id} erken bırakıldı`);
            pic.disposed++;
          },
        };
        pics.push(pic);
        return pic;
      },
      dispose: () => undefined,
    }),
  },
};
vi.mock('../src/components/cosmetics/skia', () => ({ skia: () => fakeSkia, hasSkia: () => true }));

let RETIRE_MS = 150;
let rafQueue: FrameRequestCallback[] = [];

/** Bir kare ilerletir (motorun requestAnimationFrame geri çağrıları) */
function tick(ms = 16): void {
  vi.advanceTimersByTime(ms);
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(Date.now());
}

async function load() {
  vi.resetModules();
  const engine = await import('../src/components/cosmetics/engine');
  RETIRE_MS = engine.RETIRE_MS;
  return engine;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  pics = [];
  native = new Map();
  dropped = new Set();
  calls = [];
  failNext = false;
  rafQueue = [];
  (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => rafQueue.push(cb);
  (globalThis as Record<string, unknown>).cancelAnimationFrame = () => undefined;
  (globalThis as Record<string, unknown>).SkiaViewApi = {
    setJsiProperty(id: number, name: string, value: FakePic) {
      if (dropped.has(id)) throw new Error(`setJsiProperty kalkmış görünüme (${id})`);
      if (failNext) {
        failNext = false;
        throw new Error('yerel hata');
      }
      expect(name).toBe('picture');
      const old = native.get(id);
      if (old && old !== value) old.replacedAt = Date.now();
      native.set(id, value);
      calls.push({ id, pic: value });
    },
  };
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).SkiaViewApi;
});

/** Görünüm React'teki gibi kaldırılır: önce motordan çıkar, sonra yerel görünüm düşer */
function unmount(handle: { dispose(): void }, id: number): void {
  handle.dispose();
  const last = native.get(id);
  if (last) last.replacedAt = Date.now();
  dropped.add(id);
}

describe('kozmetik motoru: yerel görünüm yaşam döngüsü', () => {
  it('önceki resmi hemen bırakmaz, RETIRE_MS sonra tam bir kez bırakır', async () => {
    const { attachView } = await load();
    attachView(1, { kind: 'card', set: 'karadelik', w: 300, h: 260 });
    for (let i = 0; i < 10; i++) tick();
    expect(calls.length).toBeGreaterThan(3);
    const current = native.get(1)!;
    // Son resim canlı görünümde: bırakılmamış
    expect(current.disposed).toBe(0);
    vi.advanceTimersByTime(RETIRE_MS * 3);
    for (const p of pics) expect(p.disposed).toBe(p === current ? 0 : 1);
  });

  it('kaldırılan görünüme setJsiProperty çağrılmaz; son resmi gecikmeyle bırakılır', async () => {
    const { attachView } = await load();
    const h = attachView(7, { kind: 'deco', set: 'buz', w: 120, h: 120, R: 40 });
    tick();
    tick();
    const before = calls.length;
    unmount(h, 7);
    // Kalkmış görünüm için güncelleme ve kareler yerel tarafa gitmez (gitseydi sahte API hata fırlatırdı)
    h.update({ w: 200, h: 200 });
    for (let i = 0; i < 20; i++) tick();
    expect(calls.length).toBe(before);
    h.dispose(); // ikinci kez: zararsız
    vi.advanceTimersByTime(RETIRE_MS * 3);
    for (const p of pics) expect(p.disposed).toBe(1);
  });

  it('önizleme yeniden kurulunca (kaldır + yeni kimlikle bağla) sıra doğru, resimler tam bir kez bırakılır', async () => {
    const { attachView } = await load();
    let id = 100;
    let h = attachView(id, { kind: 'card', set: 'neon', w: 300, h: 260, geo: { bh: 106, ax: 62, ay: 112, ar: 46 } });
    for (let round = 0; round < 8; round++) {
      tick();
      h.update({ set: round % 2 ? 'neon' : 'buz', w: 300 + round, h: 260 });
      tick();
      // React: eski yüzeyin temizliği yenisinin kurulumundan önce, aynı kare içinde
      unmount(h, id);
      id++;
      h = attachView(id, { kind: 'card', set: 'neon', w: 300, h: 260 });
      tick();
    }
    for (let i = 0; i < 5; i++) tick();
    unmount(h, id);
    vi.advanceTimersByTime(RETIRE_MS * 3);
    expect(pics.length).toBeGreaterThan(8);
    for (const p of pics) expect(p.disposed).toBe(1);
    // Her çağrı o an canlı bir görünüme gitti
    for (const c of calls) expect(c.id).toBeGreaterThanOrEqual(100);
  });

  it('SkiaViewApi yoksa hata fırlatmaz ve resim kaydetmez', async () => {
    const { attachView } = await load();
    delete (globalThis as Record<string, unknown>).SkiaViewApi;
    attachView(3, { kind: 'thumb', set: 'buz', w: 160, h: 100 });
    expect(() => {
      for (let i = 0; i < 5; i++) tick();
    }).not.toThrow();
    expect(pics.length).toBe(0);
  });

  it('setJsiProperty hata verirse resim bırakılır, görünüm bir daha denenmez, kare döngüsü hata fırlatmaz', async () => {
    const { attachView, cosmeticsStats } = await load();
    failNext = true;
    attachView(4, { kind: 'plate', set: 'buz', w: 300, h: 42 });
    expect(() => tick()).not.toThrow();
    expect(pics.length).toBe(1);
    expect(pics[0]!.disposed).toBe(1);
    for (let i = 0; i < 5; i++) tick();
    expect(pics.length).toBe(1);
    expect(cosmeticsStats().drawing.plate).toBeUndefined();
  });

  it('geçersiz boyut (NaN, sonsuz) ve kimlik yerel tarafa gitmez', async () => {
    const { attachView } = await load();
    const h = attachView(5, { kind: 'card', set: 'buz', w: NaN, h: 260, geo: { bh: NaN, ax: 1, ay: 1, ar: 1 } });
    tick();
    tick();
    expect(calls.length).toBe(0);
    h.update({ w: Infinity, h: 10 });
    tick();
    expect(calls.length).toBe(0);
    h.update({ w: 300, h: 260, scale: NaN, R: NaN, fps: 0 });
    tick();
    expect(calls.length).toBe(1);
    const bad = attachView(Number.NaN, { kind: 'thumb', set: 'buz', w: 100, h: 100 });
    bad.update({ w: 10, h: 10 });
    tick();
    expect(calls.every((c) => c.id === 5)).toBe(true);
    bad.dispose();
  });

  it('ölçüm hata verirse zamanlayıcı hata fırlatmaz; kalkmış görünüm ölçülmez', async () => {
    const { attachView } = await load();
    let measured = 0;
    const h = attachView(6, {
      kind: 'plate',
      set: 'buz',
      w: 300,
      h: 42,
      measure: () => {
        measured++;
        throw new Error('görünüm yok');
      },
    });
    expect(() => {
      tick();
      vi.advanceTimersByTime(1200);
    }).not.toThrow();
    expect(measured).toBeGreaterThan(1);
    unmount(h, 6);
    const n = measured;
    tick();
    vi.advanceTimersByTime(1200);
    expect(measured).toBe(n);
  });

  it('ölçümün geç gelen yanıtı kalkmış görünümü yeniden çizdirmez', async () => {
    const { attachView } = await load();
    let answer: ((visible: boolean) => void) | null = null;
    const h = attachView(8, { kind: 'plate', set: 'buz', w: 300, h: 42, measure: (done) => (answer = done) });
    tick();
    expect(calls.length).toBe(0); // ölçülene kadar çizilmez
    unmount(h, 8);
    answer!(true);
    for (let i = 0; i < 5; i++) tick();
    expect(calls.length).toBe(0);
  });
});
