import type { DiskurtBridge } from '../../../shared/bridge';

/**
 * Electron preload köprüsü. Arayüz düz bir tarayıcıda açılırsa (ör. geliştirme/test)
 * null olur ve masaüstüne özgü özellikler devre dışı kalır.
 */
export const bridge: DiskurtBridge | null = (window as unknown as { diskurt?: DiskurtBridge }).diskurt ?? null;

export const platform = bridge?.platform ?? 'web';
export const isWindows = platform === 'win32';
export const isMac = platform === 'darwin';
