// Yerel çökme raporları (modules/crash-reporter → src/crashReports.ts). Denetlenen: yerel modülün JSON'u okunur
// (bozuk olan atlanır), mesaj tek satırlık özet, yığın önce bağlam sonra yığın/döküm; ANR dökümünde ana iş
// parçacığı öne alınır; ekran yolunda kimlikler yazılmaz; yerel modül yoksa (eski APK, iOS) hiçbir şey yapılmaz.

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeModule {
  setCrashContext: (info: string) => void;
  takePendingCrashes: () => Promise<string[]>;
}

const state = vi.hoisted(() => ({
  module: null as FakeModule | null,
  reported: [] as { error: Error; where: string }[],
}));

vi.mock('expo-updates', () => ({
  isEnabled: true,
  isEmbeddedLaunch: false,
  updateId: '1a2b3c4d-0000-4000-8000-000000000000',
}));
vi.mock('@diskort/client-core', () => ({
  reportClientError: (error: Error, where: string) => state.reported.push({ error, where }),
}));
vi.mock('../modules/crash-reporter', () => ({
  get CrashReporter() {
    return state.module;
  },
}));
vi.mock('../src/version', () => ({ APP_VERSION: '0.9.0' }));

import {
  anrExcerpt,
  crashContext,
  crashToError,
  describeRoute,
  noteCrashContext,
  parseCrashReport,
  reportNativeCrashes,
  reportPendingNativeCrashes,
  type CrashReport,
} from '../src/crashReports';

const AT = Date.UTC(2026, 8, 29, 12, 0, 0);

const javaJson = JSON.stringify({
  kind: 'java',
  at: AT,
  pid: 4321,
  thread: 'main',
  stack: [
    'java.lang.IllegalStateException: bozuk durum',
    '\tat a.b.C.d(C.kt:10)',
    'Caused by: java.lang.NullPointerException',
    '\tat x.y.Z.w(Z.kt:1)',
    '',
  ].join('\n'),
  nativeVersion: '0.9.0 (900)',
  context: '/ayarlar/profile · JS 0.9.0 · OTA 1a2b3c4d',
});

const nativeJson = JSON.stringify({
  kind: 'exit',
  at: AT,
  pid: 4322,
  reason: 'CRASH_NATIVE',
  description: '',
  status: 11,
  importance: 100,
  pssKb: 300 * 1024,
  rssKb: 450 * 1024,
  process: 'com.diskort.app',
  traceKind: 'tombstone',
  trace: 'SIGSEGV\nSEGV_MAPERR\nRenderThread\n/system/lib64/libhwui.so\nSkCanvas::drawPath\n',
});

const errorOf = (report: CrashReport | null): Error => {
  if (!report) throw new Error('rapor okunamadı');
  return crashToError(report);
};

beforeEach(() => {
  state.module = null;
  state.reported.length = 0;
});

describe('parseCrashReport', () => {
  it('Java çökmesini ve çıkış kaydını okur', () => {
    expect(parseCrashReport(javaJson)).toMatchObject({ kind: 'java', at: AT, thread: 'main', nativeVersion: '0.9.0 (900)' });
    expect(parseCrashReport(nativeJson)).toMatchObject({
      kind: 'exit',
      reason: 'CRASH_NATIVE',
      status: 11,
      importance: 100,
      context: '',
      traceKind: 'tombstone',
    });
  });

  it('bozuk ya da tanınmayan kayıt: null; eksik alanlar boş', () => {
    expect(parseCrashReport('bozuk{')).toBeNull();
    expect(parseCrashReport('"metin"')).toBeNull();
    expect(parseCrashReport('null')).toBeNull();
    expect(parseCrashReport('[]')).toBeNull();
    expect(parseCrashReport('{"kind":"başka"}')).toBeNull();
    expect(parseCrashReport('{"kind":"exit","traceKind":"x","status":"11"}')).toMatchObject({
      reason: 'BİLİNMİYOR',
      status: 0,
      traceKind: '',
      trace: '',
    });
  });
});

describe('crashToError', () => {
  it('Java: mesaj istisnanın ilk satırı, yığın önce bağlam sonra tam yığın ("Caused by" dahil)', () => {
    const error = errorOf(parseCrashReport(javaJson));
    expect(error.message).toBe('java.lang.IllegalStateException: bozuk durum');
    const stack = error.stack ?? '';
    expect(stack.startsWith('Java çökmesi · iş parçacığı "main" · 2026-09-29T12:00:00.000Z')).toBe(true);
    expect(stack).toContain('APK 0.9.0 (900) · bağlam: /ayarlar/profile · JS 0.9.0 · OTA 1a2b3c4d');
    expect(stack).toContain('Caused by: java.lang.NullPointerException');
    expect(stack.indexOf('bağlam:')).toBeLessThan(stack.indexOf('java.lang.IllegalStateException'));
  });

  it('yerel çökme: sinyal adı, önem, bellek ve tombstone metinleri; bağlam yoksa belirtilir', () => {
    const error = errorOf(parseCrashReport(nativeJson));
    expect(error.message).toBe('CRASH_NATIVE SIGSEGV');
    const stack = error.stack ?? '';
    expect(stack).toContain('Android çıkış kaydı CRASH_NATIVE · 2026-09-29T12:00:00.000Z');
    expect(stack).toContain('önem 100 (ön planda) · PSS 300 MB · RSS 450 MB · sinyal 11 · süreç com.diskort.app');
    expect(stack).toContain('bağlam: yok (eski APK');
    expect(stack).toContain('Tombstone (ayrıştırılmadı');
    expect(stack).toContain('SkCanvas::drawPath');
  });

  it('açıklama mesaja eklenir; sinyal yalnızca yerel çökme ve sinyalle kapanmada', () => {
    const exit = (over: Record<string, unknown>) =>
      errorOf(parseCrashReport(JSON.stringify({ kind: 'exit', at: AT, importance: 100, ...over }))).message;
    expect(exit({ reason: 'ANR', description: 'Input dispatching timed out' })).toBe('ANR: Input dispatching timed out');
    expect(exit({ reason: 'SIGNALED', status: 9 })).toBe('SIGNALED SIGKILL');
    expect(exit({ reason: 'CRASH_NATIVE', status: 99 })).toBe('CRASH_NATIVE sinyal 99');
    expect(exit({ reason: 'LOW_MEMORY', status: 9 })).toBe('LOW_MEMORY');
  });
});

describe('anrExcerpt', () => {
  const trace = [
    '----- pid 4321 at 2026-09-29 12:00:00 -----',
    'Cmd line: com.diskort.app',
    "Build fingerprint: 'HONOR/DNY-NX9'",
    "ABI: 'arm64'",
    'Build type: optimized',
    'Zygote loaded classes=1 post zygote classes=2',
    'DALVIK THREADS (40):',
    '"Signal Catcher" daemon prio=10 tid=7 Runnable',
    '  at dalvik.system.X(Native method)',
    '',
    '"main" prio=5 tid=1 Blocked',
    '  at com.diskort.X.y(X.kt:5)',
    '  - waiting to lock <0x0a> held by thread 23',
    '',
    '"Thread-23" prio=5 tid=23 Native',
  ].join('\n');

  it('başlık satırları, sonra ana iş parçacığı ve ardındakiler', () => {
    const excerpt = anrExcerpt(trace);
    expect(excerpt.startsWith('----- pid 4321')).toBe(true);
    expect(excerpt).toContain('Cmd line: com.diskort.app');
    expect(excerpt).not.toContain('Zygote loaded');
    expect(excerpt).not.toContain('Signal Catcher');
    expect(excerpt).toContain('"main" prio=5 tid=1 Blocked\n  at com.diskort.X.y(X.kt:5)');
    expect(excerpt).toContain('"Thread-23"');
  });

  it('ANR raporunun yığınında ayıklanmış döküm', () => {
    const report = parseCrashReport(JSON.stringify({ kind: 'exit', at: AT, reason: 'ANR', traceKind: 'anr', trace }));
    const stack = errorOf(report).stack ?? '';
    expect(stack).toContain('ANR dökümü:\n----- pid 4321');
    expect(stack).toContain('"main" prio=5 tid=1 Blocked');
  });

  it('ana iş parçacığı yoksa döküm olduğu gibi', () => {
    expect(anrExcerpt('yarım döküm')).toBe('yarım döküm');
  });
});

describe('reportNativeCrashes', () => {
  it('yerel modül yoksa (eski APK, iOS) hiçbir şey yapmaz', async () => {
    const report = vi.fn();
    expect(await reportNativeCrashes(null, report)).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });

  it('yerel modül hata verirse fırlatmaz', async () => {
    const report = vi.fn();
    const source = { takePendingCrashes: () => Promise.reject(new Error('yerel hata')) };
    expect(await reportNativeCrashes(source, report)).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });

  it('her geçerli raporu "yerel-çökme" yeriyle bildirir, bozukları atlar', async () => {
    const report = vi.fn();
    const source = { takePendingCrashes: () => Promise.resolve(['bozuk', javaJson, nativeJson]) };
    expect(await reportNativeCrashes(source, report)).toBe(2);
    expect(report.mock.calls.map(([error, where]) => [(error as Error).message, where])).toEqual([
      ['java.lang.IllegalStateException: bozuk durum', 'yerel-çökme'],
      ['CRASH_NATIVE SIGSEGV', 'yerel-çökme'],
    ]);
  });
});

describe('describeRoute', () => {
  it('ayar bölümünün adı yazılır; kimlikler ve davet kodları kalıp olarak kalır', () => {
    expect(describeRoute(['ayarlar', '[bolum]'], { bolum: 'profile' })).toBe('/ayarlar/profile');
    expect(describeRoute(['channel', '[id]'], { id: 'k4n4lKimligi' })).toBe('/channel/[id]');
    expect(describeRoute(['davet', '[code]'], { code: 'ABCD2345' })).toBe('/davet/[code]');
    expect(describeRoute(['sunucu-ayarlari', 'rol', '[id]'], { id: 'r1' })).toBe('/sunucu-ayarlari/rol/[id]');
    expect(describeRoute(['ayarlar', '[bolum]'], { bolum: ['a', 'b'] })).toBe('/ayarlar/[bolum]');
    expect(describeRoute([], {})).toBe('/');
  });
});

describe('çökme bağlamı', () => {
  it('ekran önce (süreç özeti 128 bayt), seste mi, JS sürümü, güncelleme', () => {
    expect(crashContext('/ayarlar/profile', false, '0.9.0', 'OTA 1a2b3c4d')).toBe('/ayarlar/profile · JS 0.9.0 · OTA 1a2b3c4d');
    expect(crashContext('/', true, '0.9.0', 'gömülü paket')).toBe('/ · seste · JS 0.9.0 · gömülü paket');
  });

  it('yerel modül yoksa hiçbir şey yapmaz; varsa yalnızca değişince yazar ve hatası yutulur', () => {
    expect(() => noteCrashContext('/ayarlar/profile')).not.toThrow();

    const setCrashContext = vi.fn();
    state.module = { setCrashContext, takePendingCrashes: () => Promise.resolve([]) };
    noteCrashContext('/ayarlar/profile');
    noteCrashContext('/ayarlar/profile');
    noteCrashContext('/ayarlar/profile', true);
    expect(setCrashContext.mock.calls).toEqual([
      ['/ayarlar/profile · JS 0.9.0 · OTA 1a2b3c4d'],
      ['/ayarlar/profile · seste · JS 0.9.0 · OTA 1a2b3c4d'],
    ]);

    state.module = {
      setCrashContext: () => {
        throw new Error('yerel hata');
      },
      takePendingCrashes: () => Promise.resolve([]),
    };
    expect(() => noteCrashContext('/voice')).not.toThrow();
  });
});

describe('reportPendingNativeCrashes', () => {
  it('bekleyen çökmeleri bir kez alır ve sunucuya bildirir', async () => {
    const takePendingCrashes = vi.fn(() => Promise.resolve([javaJson]));
    state.module = { setCrashContext: () => undefined, takePendingCrashes };
    reportPendingNativeCrashes();
    reportPendingNativeCrashes();
    await vi.waitFor(() => expect(state.reported).toHaveLength(1));
    expect(takePendingCrashes).toHaveBeenCalledTimes(1);
    expect(state.reported[0]?.where).toBe('yerel-çökme');
    expect(state.reported[0]?.error.message).toBe('java.lang.IllegalStateException: bozuk durum');
  });
});
