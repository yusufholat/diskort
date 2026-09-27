import type { CSSProperties } from 'react';
import { THEME_IDS, THEME_INFO, THEME_PALETTES, THEME_TOKENS, type ThemeId } from '../../../shared/themes';
import { useSettings } from '../stores/settings';
import { bridge } from './bridge';

/**
 * Tema: renk belirteçlerinin değerleri src/shared/themes.ts'te. Seçili temanın değerleri <html> üzerine
 * CSS değişkeni olarak yazılır (styles.css'teki @theme varsayılanlarını ezer). Ayar değişince beklemeden
 * uygulanır; pencerenin başlık çubuğu ve zemini de uyar.
 */
export const THEMES: { id: ThemeId; label: string; description: string }[] = THEME_IDS.map((id) => ({
  id,
  ...THEME_INFO[id],
}));

/** Bir temanın belirteçleri, bir öğenin `style`'ına verilecek CSS değişkenleri olarak (önizlemeler için) */
export function themeVars(theme: ThemeId): CSSProperties {
  const p = THEME_PALETTES[theme];
  return Object.fromEntries(THEME_TOKENS.map((t) => [`--color-${t}`, p[t]])) as CSSProperties;
}

function applyTheme(theme: ThemeId): void {
  const root = document.documentElement;
  const p = THEME_PALETTES[theme];
  for (const t of THEME_TOKENS) root.style.setProperty(`--color-${t}`, p[t]);
  root.dataset.theme = theme;
  // Tarayıcının kendi çizdiği parçalar (takvim, kaydırma okları vb.) için
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  bridge?.setTheme(theme);
}

/** Kayıtlı temayı ilk çizimden önce uygular ve değişiklikleri izler. */
export function installTheme(): void {
  applyTheme(useSettings.getState().theme);
  useSettings.subscribe((s, prev) => {
    if (s.theme !== prev.theme) applyTheme(s.theme);
  });
}
