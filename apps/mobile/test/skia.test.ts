// Skia'nın kurulumu (üretimde ölümcül hata: "Native Skia Module failed to correctly install JSI Bindings!").
// Denetlenen: yerel install() başarısızsa ya da fırlatırsa paket hiç require edilmez (Metro'da paketin açılış
// hatası ölümcüldür), null döner, fırlatılmaz ve bir kez bildirilir; JSI küreselleri varsa install()
// çağrılmadan require edilir; yerel modül yoksa sessizce null.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ TurboModuleRegistry: { get: () => null } }));
vi.mock('@diskort/client-core', () => ({ reportClientError: () => undefined }));

import { loadSkia, requireGuarded, type SkiaEnv, type SkiaModule } from '../src/components/cosmetics/skia';

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
  const report = vi.fn();
  const e: SkiaEnv = {
    nativeModule: over.nativeModule ?? (() => (over.noNative ? null : { install })),
    global,
    requireSkia,
    report,
  };
  return { e, install, requireSkia, report, global };
}

describe('loadSkia', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('install() false: paket require edilmez, null, bir bildirim', () => {
    const t = env({ install: () => false });
    let result!: ReturnType<typeof loadSkia>;
    expect(() => (result = loadSkia(t.e))).not.toThrow();
    expect(result.module).toBeNull();
    expect(t.install).toHaveBeenCalledTimes(1);
    expect(t.requireSkia).not.toHaveBeenCalled();
    expect(t.report).toHaveBeenCalledTimes(1);
    expect(String(t.report.mock.calls[0]![0].message)).toContain('false');
  });

  it('install() fırlatırsa: paket require edilmez, null, bildirim', () => {
    const t = env({
      install: () => {
        throw new Error('yerel hata');
      },
    });
    const result = loadSkia(t.e);
    expect(result.module).toBeNull();
    expect(t.requireSkia).not.toHaveBeenCalled();
    expect(t.report).toHaveBeenCalledTimes(1);
  });

  it('install() true ama küresel yok: paket require edilmez', () => {
    const t = env({ install: () => true });
    expect(loadSkia(t.e).module).toBeNull();
    expect(t.requireSkia).not.toHaveBeenCalled();
    expect(t.report).toHaveBeenCalledTimes(1);
  });

  it('JSI küreselleri zaten varsa: install() çağrılmaz, paket require edilir', () => {
    const t = env({ global: { SkiaApi: {} } });
    const result = loadSkia(t.e);
    expect(result.module).toBe(fakeSkia);
    expect(t.install).not.toHaveBeenCalled();
    expect(t.requireSkia).toHaveBeenCalledTimes(1);
    expect(t.report).not.toHaveBeenCalled();
  });

  it('install() başarılı: küresel kurulur, sonra paket require edilir', () => {
    const t = env();
    const result = loadSkia(t.e);
    expect(result.module).toBe(fakeSkia);
    expect(t.install).toHaveBeenCalledTimes(1);
    expect(t.global.SkiaApi).toBeDefined();
    expect(t.install.mock.invocationCallOrder[0]!).toBeLessThan(t.requireSkia.mock.invocationCallOrder[0]!);
  });

  it('yerel modül yoksa (eski APK): sessizce null, require ve bildirim yok', () => {
    const t = env({ noNative: true });
    expect(loadSkia(t.e).module).toBeNull();
    expect(t.requireSkia).not.toHaveBeenCalled();
    expect(t.report).not.toHaveBeenCalled();
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

  it('paketin açılışı fırlatırsa ya da (Metro gibi) undefined dönerse: null, bildirim', () => {
    const a = env({
      requireSkia: () => {
        throw new Error('açılış hatası');
      },
    });
    expect(loadSkia(a.e).module).toBeNull();
    expect(a.report).toHaveBeenCalledTimes(1);

    const b = env({ requireSkia: () => undefined });
    expect(loadSkia(b.e).module).toBeNull();
    expect(b.report).toHaveBeenCalledTimes(1);
  });

  it('bildirim fırlatsa da loadSkia fırlatmaz', () => {
    const t = env({ install: () => false });
    t.e.report = () => {
      throw new Error('ağ');
    };
    expect(() => loadSkia(t.e)).not.toThrow();
  });
});

describe('requireGuarded', () => {
  it("Metro'nun ölümcül bildirimi yakalanıp fırlatılır, önceki işleyici geri konur", () => {
    const previous = vi.fn();
    let handler: (error: unknown, isFatal?: boolean) => void = previous;
    const utils = {
      getGlobalHandler: () => handler,
      setGlobalHandler: (fn: typeof handler) => {
        handler = fn;
      },
    };
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = utils;
    try {
      // Metro'nun guardedLoadModule'ü gibi: açılış hatasını reportFatalError'a verir, undefined döner
      const load = (): SkiaModule => {
        handler(new Error('Native Skia Module failed to correctly install JSI Bindings! Result: false'), true);
        return undefined as unknown as SkiaModule;
      };
      expect(() => requireGuarded(load)).toThrow('failed to correctly install');
      expect(previous).not.toHaveBeenCalled();
      expect(handler).toBe(previous);

      expect(requireGuarded(() => fakeSkia)).toBe(fakeSkia);
      expect(handler).toBe(previous);
    } finally {
      delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
    }
  });
});
