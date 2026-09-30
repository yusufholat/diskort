// Tarama yardımcısının (scan.ps1) stdout satırları: her satır bir JSON nesnesi. Dışarıdan gelen veri
// olduğundan alanlar tek tek doğrulanır; tanınmayan ya da bozuk satır yok sayılır.
import type { ScannedProcess } from './classify';

export type ScannerMessage =
  /** Yardımcı hazır: `native` Win32 çağrıları kullanılabiliyor mu, `steam` Steam'in klasörü */
  | { t: 'hello'; native: boolean; steam: string | null }
  | { t: 'scan'; procs: ScannedProcess[] }
  /** İkon isteğinin yanıtı. `ok` ve png null: exe'nin kendi ikonu yok; `ok` değil: yardımcı çıkaramadı */
  | { t: 'icon'; id: number; png: string | null; ok: boolean }
  | { t: 'error'; message: string };

const MAX_PROCS = 200;
const MAX_PATH_LENGTH = 1024;
const MAX_TEXT_LENGTH = 128;

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

function processOf(value: unknown): ScannedProcess | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  const path = typeof p.path === 'string' && p.path.length <= MAX_PATH_LENGTH ? p.path : '';
  if (!path || typeof p.pid !== 'number' || !Number.isInteger(p.pid) || p.pid <= 0) return null;
  const startedAt = typeof p.start === 'number' && Number.isFinite(p.start) && p.start > 0 ? p.start : 0;
  return {
    pid: p.pid,
    path,
    startedAt,
    productName: text(p.product, MAX_TEXT_LENGTH),
    fileDescription: text(p.desc, MAX_TEXT_LENGTH),
  };
}

export function parseScannerLine(line: string): ScannerMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const msg = data as Record<string, unknown>;
  switch (msg.t) {
    case 'hello':
      return { t: 'hello', native: msg.native === true, steam: text(msg.steam, MAX_PATH_LENGTH) };
    case 'scan': {
      // PowerShell 5.1 tek öğeli diziyi nesne, boş diziyi null yazabilir
      const list = Array.isArray(msg.procs) ? msg.procs : msg.procs ? [msg.procs] : [];
      const procs = list
        .slice(0, MAX_PROCS)
        .map(processOf)
        .filter((p) => p !== null);
      return { t: 'scan', procs };
    }
    case 'icon':
      if (typeof msg.id !== 'number' || !Number.isInteger(msg.id)) return null;
      return { t: 'icon', id: msg.id, png: typeof msg.png === 'string' && msg.png ? msg.png : null, ok: msg.ok === true };
    case 'error':
      return { t: 'error', message: text(msg.message, 200) ?? '' };
    default:
      return null;
  }
}

/** İkon isteği: yol JSON verisi olarak gider, betiğe metin olarak eklenmez */
export const iconRequestLine = (id: number, path: string): string => JSON.stringify({ t: 'icon', id, path }) + '\n';
