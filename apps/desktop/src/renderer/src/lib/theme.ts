import { useSettings, type ThemeId } from '../stores/settings';
import { bridge } from './bridge';

/**
 * Tema: renk belirteçleri styles.css'te; siyah tema <html data-theme="black"> ile etkinleşir.
 * Ayar değişince beklemeden uygulanır, pencerenin başlık çubuğu ve zemini de uyar.
 */
export const THEMES: { id: ThemeId; label: string; description: string }[] = [
  { id: 'dark', label: 'Koyu', description: 'Varsayılan koyu gri tema' },
  { id: 'black', label: 'Siyah (OLED)', description: 'Simsiyah zemin; OLED ekranlarda daha koyu ve pil dostu' },
];

function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  bridge?.setTheme(theme);
}

/** Kayıtlı temayı ilk çizimden önce uygular ve değişiklikleri izler. */
export function installTheme(): void {
  applyTheme(useSettings.getState().theme);
  useSettings.subscribe((s, prev) => {
    if (s.theme !== prev.theme) applyTheme(s.theme);
  });
}
