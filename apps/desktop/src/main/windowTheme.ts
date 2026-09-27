import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { AppTheme } from '../shared/bridge';
import { DEFAULT_THEME, isThemeId, THEME_IDS, windowColors } from '../shared/themes';

/**
 * Pencerenin kendi renkleri (açılırken görünen zemin, Windows'taki başlık çubuğu düğmeleri) arayüzün
 * temasına uyar. Seçim arayüzden gelir ve bir sonraki açılış için saklanır: pencere, arayüz yüklenmeden
 * doğru renkle açılsın. Kayıt yoksa (yeni kurulum) varsayılan tema (Siyah) kullanılır.
 */
export const WINDOW_COLORS = Object.fromEntries(THEME_IDS.map((id) => [id, windowColors(id)])) as Record<
  AppTheme,
  { background: string; symbol: string }
>;

export const isAppTheme = isThemeId;

const themeFile = (): string => join(app.getPath('userData'), 'window-theme');

export function savedWindowTheme(): AppTheme {
  try {
    const file = themeFile();
    if (!existsSync(file)) return DEFAULT_THEME;
    const [theme, format] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
    // Eski biçimdeki (yalnızca tema adı) koyu, eski varsayılandı ve arayüzde siyaha taşınıyor (ayar sürümü 6):
    // pencere de siyah açılsın. Yeni biçimde ikinci satır '2'dir, koyu orada bilerek seçilmiştir.
    if (theme === 'dark' && format !== '2') return DEFAULT_THEME;
    return isAppTheme(theme) ? theme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveWindowTheme(theme: AppTheme): void {
  try {
    writeFileSync(themeFile(), `${theme}\n2`);
  } catch {
    // önemli değil: bir sonraki açılışta varsayılan zeminle açılır, arayüz yüklenince düzelir
  }
}
