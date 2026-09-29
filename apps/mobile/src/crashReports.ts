// Telefonun yerel (Java/Kotlin, C++) çökmeleri. JavaScript bunları göremez: uygulama bir anda kapanır, küresel
// hata işleyicisi (setup.ts) hiç çalışmaz. Yerel modül (modules/crash-reporter) çökmeyi kaydeder; bir sonraki
// açılışta buradan sunucuya bildirilir (yer: 'yerel-çökme'). Android 11+'da sistemin çıkış kayıtları da okunur:
// yerel kod (Skia, GPU sürücüsü, WebRTC) çökmeleri ve ANR'ler yalnızca oradan görünür.
// Çökme anının bağlamı için açık ekran, ses durumu, JS sürümü ve güncelleme yerel modüle bildirilir.
//
// Yerel modül eski APK'larda (kablosuz güncellemeyle yeni JS almış) ve iOS'ta yoktur: hiçbir şey yapılmaz.

import * as Updates from 'expo-updates';
import { reportClientError } from '@diskort/client-core';
import { NATIVE_CRASH_WHERE } from '@diskort/shared';
import { CrashReporter } from '../modules/crash-reporter';
import { APP_VERSION } from './version';

/** Java/Kotlin'de yakalanmamış istisna (yerel işleyicinin çökme anında yazdığı dosya) */
export interface JavaCrash {
  kind: 'java';
  /** Çökme zamanı (ms) */
  at: number;
  thread: string;
  /** Tam yığın ("Caused by" zinciri dahil) */
  stack: string;
  /** APK sürümü, ör. "0.8.9 (809)" */
  nativeVersion: string;
  /** Çökme anındaki JS bağlamı (bkz. crashContext) */
  context: string;
}

/** Android'in çıkış kaydı (ApplicationExitInfo, Android 11+) */
export interface ExitCrash {
  kind: 'exit';
  at: number;
  /** CRASH, CRASH_NATIVE, ANR, INITIALIZATION_FAILURE, LOW_MEMORY, EXCESSIVE_RESOURCE_USAGE, SIGNALED */
  reason: string;
  description: string;
  /** Çıkış kodu; CRASH_NATIVE ve SIGNALED'da sinyal numarası */
  status: number;
  /** Kapanmadan önceki önem (100 ön planda … 400 önbellekte) */
  importance: number;
  pssKb: number;
  rssKb: number;
  process: string;
  /** Süreç özeti: crashContext'in ilk 128 baytı. Eski APK'da ya da JS başlamadan kapandıysa boş */
  context: string;
  /** ANR dökümünün başı ya da tombstone'daki okunabilir metinler */
  trace: string;
  traceKind: 'anr' | 'tombstone' | '';
}

export type CrashReport = JavaCrash | ExitCrash;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Yerel modülün verdiği JSON metnini okur; bozuksa ya da tanınmıyorsa null */
export function parseCrashReport(raw: string): CrashReport | null {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (data.kind === 'java') {
    return {
      kind: 'java',
      at: num(data.at),
      thread: str(data.thread),
      stack: str(data.stack),
      nativeVersion: str(data.nativeVersion),
      context: str(data.context),
    };
  }
  if (data.kind === 'exit') {
    return {
      kind: 'exit',
      at: num(data.at),
      reason: str(data.reason) || 'BİLİNMİYOR',
      description: str(data.description),
      status: num(data.status),
      importance: num(data.importance),
      pssKb: num(data.pssKb),
      rssKb: num(data.rssKb),
      process: str(data.process),
      context: str(data.context),
      trace: str(data.trace),
      traceKind: data.traceKind === 'anr' || data.traceKind === 'tombstone' ? data.traceKind : '',
    };
  }
  return null;
}

const SIGNALS: Record<number, string> = {
  4: 'SIGILL',
  5: 'SIGTRAP',
  6: 'SIGABRT',
  7: 'SIGBUS',
  8: 'SIGFPE',
  9: 'SIGKILL',
  11: 'SIGSEGV',
  15: 'SIGTERM',
};

/** ActivityManager.RunningAppProcessInfo.IMPORTANCE_* */
const IMPORTANCE: Record<number, string> = {
  100: 'ön planda',
  125: 'ön plan servisi',
  200: 'görünür',
  230: 'algılanabilir',
  300: 'servis',
  325: 'ön planda, ekran kapalı',
  400: 'önbellekte',
};

const hasSignal = (report: ExitCrash): boolean => report.reason === 'CRASH_NATIVE' || report.reason === 'SIGNALED';

/** Tek satırlık özet (hatanın mesajı; sunucuda aynı çökmeler bununla gruplanır) */
export function crashTitle(report: CrashReport): string {
  if (report.kind === 'java') return report.stack.split('\n', 1)[0]?.trim() || 'Java çökmesi (yığın yok)';
  const signal = hasSignal(report) ? (SIGNALS[report.status] ?? `sinyal ${report.status}`) : '';
  const head = [report.reason, signal].filter(Boolean).join(' ');
  return report.description ? `${head}: ${report.description}` : head;
}

/**
 * ANR dökümü çok uzun: başlık satırları, sonra ana iş parçacığı (ANR'nin sebebi hep odur) ve ardından
 * diğerleri. Ana iş parçacığı bulunamazsa döküm olduğu gibi.
 */
export function anrExcerpt(trace: string): string {
  const main = trace.search(/^"main"/m);
  if (main < 0) return trace;
  const head = trace
    .slice(0, main)
    .split('\n')
    .filter((line) => line.trim())
    .slice(0, 5)
    .join('\n');
  return `${head}\n…\n${trace.slice(main)}`;
}

const time = (at: number): string => (at > 0 ? new Date(at).toISOString() : 'zaman bilinmiyor');
const mb = (kb: number): string => `${Math.round(kb / 1024)} MB`;

/**
 * Sunucuya yığın olarak giden ayrıntı: önce bağlam (kısa; yığın sunucu sınırında kesilince kaybolmasın),
 * sonra yığın ya da döküm.
 */
export function crashDetails(report: CrashReport): string {
  if (report.kind === 'java') {
    return [
      `Java çökmesi · iş parçacığı "${report.thread || '?'}" · ${time(report.at)}`,
      `APK ${report.nativeVersion || '?'} · bağlam: ${report.context || 'yok'}`,
      '',
      report.stack,
    ].join('\n');
  }
  const facts = [
    `önem ${report.importance} (${IMPORTANCE[report.importance] ?? '?'})`,
    report.pssKb > 0 ? `PSS ${mb(report.pssKb)}` : '',
    report.rssKb > 0 ? `RSS ${mb(report.rssKb)}` : '',
    hasSignal(report) ? `sinyal ${report.status}` : report.status ? `çıkış kodu ${report.status}` : '',
    report.process ? `süreç ${report.process}` : '',
  ].filter(Boolean);
  const lines = [
    `Android çıkış kaydı ${report.reason} · ${time(report.at)}`,
    facts.join(' · '),
    `bağlam: ${report.context || 'yok (eski APK ya da JavaScript başlamadan kapandı)'}`,
  ];
  if (report.traceKind === 'anr' && report.trace) lines.push('', 'ANR dökümü:', anrExcerpt(report.trace));
  if (report.traceKind === 'tombstone' && report.trace) {
    lines.push('', 'Tombstone (ayrıştırılmadı; okunabilir metinler):', report.trace);
  }
  return lines.join('\n');
}

/** Raporu sunucuya gidecek hataya çevirir: mesaj = özet, yığın = bağlam ve ayrıntı */
export function crashToError(report: CrashReport): Error {
  const error = new Error(crashTitle(report));
  const details = crashDetails(report);
  try {
    error.stack = details;
    // JS motoru atamayı yok saydıysa özellik doğrudan tanımlanır
    if (error.stack !== details) {
      Object.defineProperty(error, 'stack', { value: details, configurable: true, writable: true });
    }
  } catch {
    // yığın yazılamadı (beklenmez): en azından özet gider
  }
  return error;
}

/** Yerel modülün bu dosyada kullanılan kısmı (testlerde sahtesi verilir) */
export interface CrashSource {
  takePendingCrashes(): Promise<string[]>;
}

/**
 * Bekleyen yerel çökmeleri alır ve her birini bildirir; bildirilen sayıyı döner. Yerel modül yoksa (eski APK,
 * iOS) ya da hata verirse hiçbir şey yapmaz, hiçbir durumda fırlatmaz.
 */
export async function reportNativeCrashes(
  source: CrashSource | null,
  report: (error: Error, where: string) => void,
): Promise<number> {
  if (!source) return 0;
  let raw: unknown;
  try {
    raw = await source.takePendingCrashes();
  } catch {
    return 0;
  }
  if (!Array.isArray(raw)) return 0;
  let count = 0;
  for (const item of raw) {
    const crash = typeof item === 'string' ? parseCrashReport(item) : null;
    if (!crash) continue;
    report(crashToError(crash), NATIVE_CRASH_WHERE);
    count++;
  }
  return count;
}

/** Değeri bağlama yazılabilen yol parametreleri (ayar bölümünün adı); kimlikler ve davet kodları yazılmaz */
const SHOWN_PARAMS = new Set(['bolum']);

/**
 * Açık ekranın yolu (expo-router kesimleri): ör. "/ayarlar/profile", "/channel/[id]". Kimlik taşıyan
 * parametreler kalıp olarak kalır.
 */
export function describeRoute(segments: readonly string[], params: Record<string, string | string[] | undefined>): string {
  const parts = segments.map((segment) => {
    const name = /^\[(?:\.\.\.)?(\w+)\]$/.exec(segment)?.[1];
    if (!name || !SHOWN_PARAMS.has(name)) return segment;
    const value = params[name];
    return typeof value === 'string' && value ? value : segment;
  });
  return `/${parts.join('/')}`;
}

/**
 * Çökme bağlamı. Açık ekran başta: Android'in süreç özeti 128 bayttır, yerel çökmede sonu kesilmiş olabilir.
 */
export function crashContext(route: string, inVoice: boolean, jsVersion: string, launch: string): string {
  return [route, inVoice ? 'seste' : '', `JS ${jsVersion}`, launch].filter(Boolean).join(' · ');
}

/** Bu çalıştırmanın JS paketi: kablosuz güncellemenin kimliği (ilk 8 karakter) ya da APK'daki paket */
function launchInfo(): string {
  try {
    return Updates.isEnabled && !Updates.isEmbeddedLaunch && Updates.updateId
      ? `OTA ${Updates.updateId.slice(0, 8)}`
      : 'gömülü paket';
  } catch {
    return '';
  }
}

let launch: string | undefined;
let lastContext = '';

/** Açık ekran ya da ses durumu değişti: çökme bağlamı güncellenir (yerel modül yoksa hiçbir şey yapmaz) */
export function noteCrashContext(route: string, inVoice = false): void {
  if (!CrashReporter) return;
  if (launch === undefined) launch = launchInfo();
  const info = crashContext(route, inVoice, APP_VERSION, launch);
  if (info === lastContext) return;
  lastContext = info;
  try {
    CrashReporter.setCrashContext(info);
  } catch {
    // bağlam yazılamadı: rapor bağlamsız gelir
  }
}

let pendingTaken = false;

/**
 * Önceki çalıştırmaların yerel çökmelerini sunucuya bildirir: açılış bittikten sonra, JS çalıştıkça bir kez
 * (Android ekranı yeniden kurunca kök yerleşim yeniden çizilir; bkz. _layout.tsx).
 */
export function reportPendingNativeCrashes(): void {
  if (pendingTaken) return;
  pendingTaken = true;
  void reportNativeCrashes(CrashReporter, reportClientError);
}
