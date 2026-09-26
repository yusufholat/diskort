import type { DiskortBridge } from '../../../shared/bridge';

/**
 * Electron preload köprüsü. Arayüz düz bir tarayıcıda açılırsa (ör. geliştirme/test)
 * null olur ve masaüstüne özgü özellikler devre dışı kalır.
 */
export const bridge: DiskortBridge | null = (window as unknown as { diskort?: DiskortBridge }).diskort ?? null;

export const platform = bridge?.platform ?? 'web';
export const isWindows = platform === 'win32';
export const isMac = platform === 'darwin';
