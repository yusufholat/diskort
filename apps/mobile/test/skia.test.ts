// Skia'nın kurulumu (üretimde ölümcül hata: "Native Skia Module failed to correctly install JSI Bindings!").
// Denetlenen: yerel install() başarısızsa ya da fırlatırsa paket hiç require edilmez (Metro'da paketin açılış
// hatası ölümcüldür), null döner, fırlatılmaz; JSI küreselleri varsa install() çağrılmadan require edilir;
// yerel modül yoksa sessizce null. Kurulum bir kez yapılır, yerel kurulum hatasında bir kez yeniden denenir,
// oturumda bir kez bildirilir.

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ TurboModuleRegistry: { get: () => null } }));
vi.mock('@diskort/client-core', () => ({ reportClientError: () => undefined }));

import {
  createSkiaStore,
  loadSkia,
  requireGuarded,
  type SkiaEnv,
  type SkiaModule,
} from '../src/components/cosmetics/skia';

const fakeSkia = { Skia: { PictureRecorder: function PictureRecorder() {} } } as unknown as SkiaModule;

function env(over: Partial<SkiaEnv> & { install?: () => unknown; noNative?: boolean } = {}) {
  const global: { SkiaApi?: unknown } = over.global ?? {};
  const install = vi.fn(
    over.install ??
      (() => {
        global.SkiaApi = {};
        return true;
      }),
  );
  const requireSkia = vi.fn(over.requireSkia ?? (() => fakeSkia));
  const e: SkiaEnv = {
    nativeModule: over.nativeModule ?? (() => (over.noNative ? null : { install })),
    global,
    requireSkia,
  };
  return { e, install, requireSkia, global };
}

const failed = (r: ReturnType<typeof loadSkia>): { error?: Error; retryable?: boolean } =>
  r.module === null ? r : {};

describe('loadSkia', () => {
  it('install() false: paket require edilmez, null, yeniden denenebilir hata', () => {
    const t = env({ install: () => false });
    let result!: ReturnType<typeof loadSkia>;
    expect(() => (result = loadSkia(t.e))).not.toThrow();
    expect(result.module).toBeNull();
    expect(t.install).toHaveBeenCalledTimes(1);
    expect(t.requireSkia).not.toHaveBeenCalled();
    expect(failed(result).retryable).toBe(true);
    expect(failed(result).error?.message).toContain('false');
  });

  it('install() fırlatırsa: paket require edilmez, null', () => {
    const t = env({
      install: () => {
        throw new Error('yerel hata');
      },
    });
    const result = loadSkia(t.e);
    expect(result.module).toBeNull();
    expect(t.requireSkia).not.toHaveBeenCalled();
    expect(failed(result).retryable).toBe(true);
  });

  it('install() true ama küresel yok: paket require edilmez', () => {
    const t = env({ install: () => true });
    expect(loadSkia(t.e).module).toBeNull();
    expect(t.requireSkia).not.toHaveBeenCalled();
  });

  it('JSI küreselleri zaten varsa: install() çağrılmaz, paket require edilir', () => {
    const t = env({ global: { SkiaApi: {} } });
    expect(loadSkia(t.e).module).toBe(fakeSkia);
    expect(t.install).not.toHaveBeenCalled();
    expect(t.requireSkia).toHaveBeenCalledTimes(1);
  });

  it('install() başarılı: küresel kurulur, sonra paket require edilir', () => {
    const t = env();
    expect(loadSkia(t.e).module).toBe(fakeSkia);
    expect(t.install).toHaveBeenCalledTimes(1);
    expect(t.global.SkiaApi).toBeDefined();
    expect(t.install.mock.invocationCallOrder[0]!).toBeLessThan(t.requireSkia.mock.invocationCallOrder[0]!);
  });

  it('yerel modül yoksa (eski APK): sessizce null, require ve hata yok', () => {
    const t = env({ noNative: true });
    const result = loadSkia(t.e);
    expect(result.module).toBeNull();
    expect(failed(result).error).toBeUndefined();
    expect(t.requireSkia).not.toHaveBeenCalled();
  });

  it('TurboModuleRegistry.get fırlatırsa: null, fırlatmaz', () => {
    const t = env({
      nativeModule: () => {
        throw new Error('kayıt yok');
      },
    });
    expect(loadSkia(t.e).module).toBeNull();
    expect(t.requireSkia).not.toHaveBeenCalled();
  });

  it('paketin açılışı fırlatırsa ya da (Metro gibi) undefined dönerse: null, yeniden denenmez', () => {
    const a = env({
      requireSkia: () => {
        throw new Error('açılış hatası');
      },
    });
    const ra = loadSkia(a.e);
    expect(ra.module).toBeNull();
    expect(failed(ra).error).toBeDefined();
    expect(failed(ra).retryable).toBeFalsy();

    const rb = loadSkia(env({ requireSkia: () => undefined }).e);
    expect(rb.module).toBeNull();
    expect(failed(rb).retryable).toBeFalsy();
  });
});

describe('createSkiaStore', () => {
  function store(t: ReturnType<typeof env>) {
    const scheduled: { fn: () => void; ms: number }[] = [];
    const report = vi.fn();
    const s = createSkiaStore({
      env: () => t.e,
      report,
      schedule: (fn, ms) => scheduled.push({ fn, ms }),
      retryMs: 5000,
    });
    return { s, scheduled, report };
  }

  it('başarılıysa bir kez kurulur, dinleyiciler haber alır, bildirim yok', () => {
    const t = env();
    const { s, scheduled, report } = store(t);
    const listener = vi.fn();
    s.subscribe(listener);
    expect(s.get()).toBeNull();
    s.init();
    s.init();
    expect(s.get()).toBe(fakeSkia);
    expect(t.install).toHaveBeenCalledTimes(1);
    expect(t.requireSkia).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(0);
    expect(report).not.toHaveBeenCalled();
  });

  it('install() başarısızsa bir kez yeniden denenir; ikincide kurulursa dinleyiciler haber alır, tek bildirim', () => {
    let calls = 0;
    const global: { SkiaApi?: unknown } = {};
    const t = env({
      global,
      install: () => {
        calls++;
        if (calls === 1) return false;
        global.SkiaApi = {};
        return true;
      },
    });
    const { s, scheduled, report } = store(t);
    const listener = vi.fn();
    s.subscribe(listener);
    s.init();
    expect(s.get()).toBeNull();
    expect(t.requireSkia).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![1]).toBe(true);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.ms).toBe(5000);
    // Beklerken yeniden init bir şey yapmaz
    s.init();
    expect(t.install).toHaveBeenCalledTimes(1);

    scheduled[0]!.fn();
    expect(s.get()).toBe(fakeSkia);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('install() iki kez başarısızsa üçüncü deneme ve ikinci bildirim yok', () => {
    const t = env({ install: () => false });
    const { s, scheduled, report } = store(t);
    s.init();
    scheduled[0]!.fn();
    expect(scheduled).toHaveLength(1);
    expect(t.install).toHaveBeenCalledTimes(2);
    expect(t.requireSkia).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    s.init();
    expect(t.install).toHaveBeenCalledTimes(2);
    expect(s.get()).toBeNull();
  });

  it('paketin kendisi yüklenemezse yeniden denenmez', () => {
    const t = env({
      requireSkia: () => {
        throw new Error('açılış hatası');
      },
    });
    const { s, scheduled, report } = store(t);
    s.init();
    expect(scheduled).toHaveLength(0);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![1]).toBe(false);
    s.init();
    expect(t.requireSkia).toHaveBeenCalledTimes(1);
  });

  it('yerel modül yoksa bildirim ve yeniden deneme yok', () => {
    const { s, scheduled, report } = store(env({ noNative: true }));
    s.init();
    expect(scheduled).toHaveLength(0);
    expect(report).not.toHaveBeenCalled();
  });

  it('bildirim fırlatsa da init fırlatmaz', () => {
    const t = env({ install: () => false });
    const s = createSkiaStore({
      env: () => t.e,
      report: () => {
        throw new Error('ağ');
      },
      schedule: () => undefined,
    });
    expect(() => s.init()).not.toThrow();
  });
});

describe('requireGuarded', () => {
  function fakeErrorUtils() {
    const previous = vi.fn();
    let handler: (error: unknown, isFatal?: boolean) => void = previous;
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => handler,
      setGlobalHandler: (fn: typeof handler) => {
        handler = fn;
      },
    };
    return { previous, current: () => handler, fire: (e: Error) => handler(e, true) };
  }
  const cleanup = () => delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;

  it("Metro'nun ölümcül bildirimi yakalanıp fırlatılır, önceki işleyici geri konur", () => {
    const u = fakeErrorUtils();
    try {
      // Metro'nun guardedLoadModule'ü gibi: açılış hatasını reportFatalError'a verir, undefined döner
      const load = (): SkiaModule => {
        u.fire(new Error('Native Skia Module failed to correctly install JSI Bindings! Result: false'));
        return undefined as unknown as SkiaModule;
      };
      expect(() => requireGuarded(load)).toThrow('failed to correctly install');
      expect(u.previous).not.toHaveBeenCalled();
      expect(u.current()).toBe(u.previous);

      expect(requireGuarded(() => fakeSkia)).toBe(fakeSkia);
      expect(u.current()).toBe(u.previous);
    } finally {
      cleanup();
    }
  });

  it('yükleme doğrudan fırlatırsa da önceki işleyici geri konur', () => {
    const u = fakeErrorUtils();
    try {
      expect(() =>
        requireGuarded(() => {
          throw new Error('doğrudan');
        }),
      ).toThrow('doğrudan');
      expect(u.current()).toBe(u.previous);
      expect(u.previous).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});
