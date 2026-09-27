import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { AppTheme } from '../shared/bridge';

/**
 * Pencerenin kendi renkleri (açılırken görünen zemin, Windows'taki başlık çubuğu düğmeleri) arayüzün
 * temasına uyar. Seçim arayüzden gelir ve bir sonraki açılış için saklanır: pencere, arayüz yüklenmeden
 * doğru renkle açılsın.
 */
export const WINDOW_COLORS: Record<AppTheme, { background: string; symbol: string }> = {
  dark: { background: '#1e1f22', symbol: '#b5bac1' },
  black: { background: '#000000', symbol: '#b5bac1' },
};

export function isAppTheme(value: unknown): value is AppTheme {
  return value === 'dark' || value === 'black';
}

const themeFile = (): string => join(app.getPath('userData'), 'window-theme');

export function savedWindowTheme(): AppTheme {
  try {
    const file = themeFile();
    if (!existsSync(file)) return 'dark';
    const theme = readFileSync(file, 'utf8').trim();
    return isAppTheme(theme) ? theme : 'dark';
  } catch {
    return 'dark';
  }
}

export function saveWindowTheme(theme: AppTheme): void {
  try {
    writeFileSync(themeFile(), theme);
  } catch {
    // önemli değil: bir sonraki açılışta koyu zeminle açılır, arayüz yüklenince düzelir
  }
}
