/**
 * Arayüz temaları: her tema tüm renk belirteçlerinin tam bir kümesi. Tek kaynak burası:
 * - arayüz (renderer/lib/theme.ts) seçili temanın belirteçlerini <html> üzerine CSS değişkeni olarak yazar,
 *   Ayarlar → Görünüm'deki önizlemeler aynı değişkenleri kendi kutularına yazar;
 * - ana süreç (main/windowTheme.ts) pencere zemini ve Windows başlık çubuğu düğmelerini buradan alır;
 * - styles.css'teki @theme varsayılanları (arayüz yüklenmeden önceki ilk çizim) Siyah temayla aynıdır
 *   (test/themes.test.ts denetler, okunabilirlik oranlarını da).
 * Mobil uygulamadaki paletler (apps/mobile/src/theme.ts) aynı adlar ve renklerle tutulur.
 */

export const THEME_IDS = ['black', 'dark', 'light', 'midnight', 'purple', 'forest', 'sunset'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** Yeni kurulumların ve eski varsayılan (koyu) kullanıcılarının teması */
export const DEFAULT_THEME: ThemeId = 'black';

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export const THEME_INFO: Record<ThemeId, { label: string; description: string }> = {
  black: { label: 'Siyah (OLED)', description: 'Simsiyah zemin; OLED ekranlarda daha koyu ve pil dostu' },
  dark: { label: 'Koyu', description: 'Klasik koyu gri' },
  light: { label: 'Açık', description: 'Beyaz ve açık gri yüzeyler, koyu yazı' },
  midnight: { label: 'Gece Mavisi', description: 'Lacivert ve mavi-arduvaz tonları' },
  purple: { label: 'Mor Gece', description: 'Koyu mor zemin, eflatun vurgular' },
  forest: { label: 'Orman', description: 'Koyu yeşil ve deniz yeşili' },
  sunset: { label: 'Gün Batımı', description: 'Sıcak koyu kahve, turuncu vurgu' },
};

/** Belirteç adları: styles.css'teki `--color-<ad>` değişkenleri ve `bg-<ad>`, `text-<ad>` sınıfları */
export const THEME_TOKENS = [
  'bg-deep',
  'bg-rail',
  'bg-side',
  'bg-main',
  'bg-input',
  'bg-hover',
  'bg-active',
  'bg-float',
  'bg-panel',
  'line',
  /** Yan yana panelleri (sunucu şeridi, kanal listesi, sohbet, üye listesi) ayıran ince çizgi; yalnız
   *  panellerin aynı renkte olduğu Siyah temada görünür, diğerlerinde saydam */
  'divider',
  'text-normal',
  'text-muted',
  'text-faint',
  'text-head',
  /** Kutu kenarları (koyu temada gölge gibi, siyah/açık temada görünür çizgi) */
  'edge',
  'edge-strong',
  /** Modal çerçevesi (koyu temada yok, siyah temada görünür) */
  'frame',
  'msg-hover',
  /** İkincil düğme, kaydırıcı yolu; üzerindeki yazı on-control */
  'control',
  'control-hover',
  'on-control',
  /** Sesli sohbet sahnesindeki yuvarlak düğmeler, sunucu şeridindeki düğmeler */
  'bg-raised',
  'bg-raised-hover',
  'scrollbar',
  'scrollbar-hover',
  'skeleton',
  'skeleton-hi',
  'brand',
  'brand-hover',
  'ok',
  'ok-hover',
  /** Zemin üzerinde yeşil yazı */
  'ok-text',
  'danger',
  'danger-hover',
  /** Zemin üzerinde kırmızı yazı (hata iletileri) */
  'danger-text',
  'warn',
  'link',
  /** @bahsetme yazısı (marka renginin soluk zemini üstünde) */
  'mention',
  /** Zemine bindirilen hafif ton (açılmış spoiler, pasif etiket) */
  'tint',
  /** İpucu balonunun kenarı */
  'float-edge',
  /** Onay kutusu / seçenek düğmesi kenarı, kapalı anahtar */
  'check',
  'check-hover',
  'toggle-off',
] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];
export type ThemePalette = Record<ThemeToken, string>;

const dark: ThemePalette = {
  'bg-deep': '#111214',
  'bg-rail': '#1e1f22',
  'bg-side': '#2b2d31',
  'bg-main': '#313338',
  'bg-input': '#1e1f22',
  'bg-hover': '#35373c',
  'bg-active': '#404249',
  'bg-float': '#111214',
  'bg-panel': '#232428',
  line: '#3f4147',
  divider: 'transparent',
  'text-normal': '#dbdee1',
  'text-muted': '#949ba4',
  'text-faint': '#878b95',
  'text-head': '#f2f3f5',
  edge: 'rgb(0 0 0 / 0.3)',
  'edge-strong': 'rgb(0 0 0 / 0.6)',
  frame: 'transparent',
  'msg-hover': '#2e3035',
  control: '#4e5058',
  'control-hover': '#6d6f78',
  'on-control': '#ffffff',
  'bg-raised': '#313338',
  'bg-raised-hover': '#404249',
  scrollbar: '#1a1b1e',
  'scrollbar-hover': '#141517',
  skeleton: '#3b3d44',
  'skeleton-hi': '#484a51',
  brand: '#5865f2',
  'brand-hover': '#4752c4',
  ok: '#23a55a',
  'ok-hover': '#1a8b4c',
  'ok-text': '#2dc770',
  danger: '#f23f43',
  'danger-hover': '#da373c',
  'danger-text': '#fa777c',
  warn: '#f0b232',
  link: '#00a8fc',
  mention: '#c9cdfb',
  tint: 'rgb(255 255 255 / 0.1)',
  'float-edge': 'rgb(255 255 255 / 0.08)',
  check: '#80848e',
  'check-hover': '#b5bac1',
  'toggle-off': '#80848e',
};

/**
 * Discord'un OLED (Midnight) teması gibi: şerit, kanal listesi, sohbet, üye listesi ve kullanıcı paneli
 * simsiyah; katmanlar yalnız ince ayırıcılar ve üstüne gelme/seçili tonlarıyla ayrılır. Açılır pencereler
 * neredeyse siyah ve silik çerçeveli.
 */
const black: ThemePalette = {
  ...dark,
  'bg-deep': '#000000',
  'bg-rail': '#000000',
  'bg-side': '#000000',
  'bg-main': '#000000',
  'bg-input': '#101010',
  'bg-hover': '#161616',
  'bg-active': '#222222',
  'bg-float': '#0b0b0b',
  'bg-panel': '#000000',
  line: '#222222',
  divider: '#1c1c1c',
  edge: '#1c1c1c',
  'edge-strong': '#2e2e2e',
  frame: '#1f1f1f',
  'msg-hover': '#0a0a0a',
  control: '#262626',
  'control-hover': '#363636',
  'bg-raised': '#121212',
  'bg-raised-hover': '#1f1f1f',
  scrollbar: '#1f1f1f',
  'scrollbar-hover': '#2e2e2e',
  skeleton: '#0f0f0f',
  'skeleton-hi': '#1a1a1a',
  'toggle-off': '#4a4a4a',
};

/** Discord'un açık temasına yakın: beyaz sohbet, #f2f3f5 kanal listesi, koyu yazı */
const light: ThemePalette = {
  'bg-deep': '#d4d7dc',
  'bg-rail': '#e3e5e8',
  'bg-side': '#f2f3f5',
  'bg-main': '#ffffff',
  'bg-input': '#ebedef',
  'bg-hover': '#e3e5e8',
  'bg-active': '#d4d7dc',
  'bg-float': '#ffffff',
  'bg-panel': '#ebedef',
  line: '#d4d7dc',
  divider: 'transparent',
  'text-normal': '#313338',
  'text-muted': '#5c5e66',
  'text-faint': '#6a6c75',
  'text-head': '#060607',
  edge: 'rgb(0 0 0 / 0.1)',
  'edge-strong': 'rgb(0 0 0 / 0.2)',
  frame: 'transparent',
  'msg-hover': '#f5f6f7',
  control: '#d4d7dc',
  'control-hover': '#c4c9ce',
  'on-control': '#313338',
  'bg-raised': '#ffffff',
  'bg-raised-hover': '#f2f3f5',
  scrollbar: '#c4c9ce',
  'scrollbar-hover': '#a8aeb5',
  skeleton: '#ebedef',
  'skeleton-hi': '#f5f6f7',
  brand: '#5865f2',
  'brand-hover': '#4752c4',
  ok: '#1f9150',
  'ok-hover': '#187a43',
  'ok-text': '#187a43',
  danger: '#da373c',
  'danger-hover': '#a12829',
  'danger-text': '#c4262b',
  warn: '#e59f1e',
  link: '#0062d6',
  mention: '#3c46b8',
  tint: 'rgb(0 0 0 / 0.06)',
  'float-edge': 'rgb(0 0 0 / 0.1)',
  check: '#6d6f78',
  'check-hover': '#4e5058',
  'toggle-off': '#80848e',
};

/** Lacivert / mavi-arduvaz */
const midnight: ThemePalette = {
  ...dark,
  'bg-deep': '#070b14',
  'bg-rail': '#0b1120',
  'bg-side': '#111a2e',
  'bg-main': '#16213a',
  'bg-input': '#0e1628',
  'bg-hover': '#1c2946',
  'bg-active': '#25355a',
  'bg-float': '#0a1020',
  'bg-panel': '#0f1729',
  line: '#2a3a5c',
  'text-normal': '#d6dff0',
  'text-muted': '#94a3c2',
  'text-faint': '#7a8bad',
  'text-head': '#f0f4fc',
  'msg-hover': '#1a2642',
  control: '#34456b',
  'control-hover': '#44587f',
  'bg-raised': '#16213a',
  'bg-raised-hover': '#25355a',
  scrollbar: '#0b1120',
  'scrollbar-hover': '#070b14',
  skeleton: '#22304f',
  'skeleton-hi': '#2c3c60',
  brand: '#3b6fe0',
  'brand-hover': '#2f5bc0',
  link: '#5cb8ff',
  mention: '#c2d6ff',
  check: '#7a8bad',
  'check-hover': '#b0bdd6',
  'toggle-off': '#61739a',
};

/** Koyu mor, eflatun vurgu */
const purple: ThemePalette = {
  ...dark,
  'bg-deep': '#0e0a17',
  'bg-rail': '#140e21',
  'bg-side': '#1c142d',
  'bg-main': '#221936',
  'bg-input': '#150f24',
  'bg-hover': '#2a1f42',
  'bg-active': '#362852',
  'bg-float': '#100b1b',
  'bg-panel': '#181127',
  line: '#3a2d55',
  'text-normal': '#e2dcef',
  'text-muted': '#a79bc2',
  'text-faint': '#8a7ea6',
  'text-head': '#f6f2fd',
  'msg-hover': '#271d3d',
  control: '#45375f',
  'control-hover': '#574775',
  'bg-raised': '#221936',
  'bg-raised-hover': '#362852',
  scrollbar: '#140e21',
  'scrollbar-hover': '#0e0a17',
  skeleton: '#2e2345',
  'skeleton-hi': '#3a2d55',
  brand: '#8a4fe0',
  'brand-hover': '#7339c7',
  link: '#d49cff',
  mention: '#e3cfff',
  check: '#8a7ea6',
  'check-hover': '#c0b5d8',
  'toggle-off': '#6f6390',
};

/** Koyu yeşil / deniz yeşili */
const forest: ThemePalette = {
  ...dark,
  'bg-deep': '#0a1210',
  'bg-rail': '#0e1815',
  'bg-side': '#13211d',
  'bg-main': '#182a25',
  'bg-input': '#0f1b18',
  'bg-hover': '#1e342e',
  'bg-active': '#274139',
  'bg-float': '#0b1512',
  'bg-panel': '#111d1a',
  line: '#2c4740',
  'text-normal': '#d8e6e1',
  'text-muted': '#96aea6',
  'text-faint': '#7a938b',
  'text-head': '#eff7f4',
  'msg-hover': '#1c302a',
  control: '#35514a',
  'control-hover': '#44645b',
  'bg-raised': '#182a25',
  'bg-raised-hover': '#274139',
  scrollbar: '#0e1815',
  'scrollbar-hover': '#0a1210',
  skeleton: '#22382f',
  'skeleton-hi': '#2c4740',
  brand: '#0f8a6c',
  'brand-hover': '#0b7059',
  link: '#4fd6c3',
  mention: '#bff2e4',
  check: '#7a938b',
  'check-hover': '#b3c9c1',
  'toggle-off': '#5f7a72',
};

/** Sıcak koyu kahve, turuncu vurgu */
const sunset: ThemePalette = {
  ...dark,
  'bg-deep': '#140d0a',
  'bg-rail': '#1b120e',
  'bg-side': '#241813',
  'bg-main': '#2b1d17',
  'bg-input': '#1a110d',
  'bg-hover': '#34241c',
  'bg-active': '#432f25',
  'bg-float': '#150e0b',
  'bg-panel': '#1f1510',
  line: '#4a3429',
  'text-normal': '#eee0d6',
  'text-muted': '#b8a090',
  'text-faint': '#9a8272',
  'text-head': '#fbf1ea',
  'msg-hover': '#30211a',
  control: '#57412f',
  'control-hover': '#6b5140',
  'bg-raised': '#2b1d17',
  'bg-raised-hover': '#432f25',
  scrollbar: '#1b120e',
  'scrollbar-hover': '#140d0a',
  skeleton: '#3a2a21',
  'skeleton-hi': '#4a3429',
  brand: '#c9561a',
  'brand-hover': '#a84513',
  link: '#ffb074',
  mention: '#ffd9bd',
  check: '#9a8272',
  'check-hover': '#d0bcae',
  'toggle-off': '#7a6254',
};

export const THEME_PALETTES: Record<ThemeId, ThemePalette> = { black, dark, light, midnight, purple, forest, sunset };

/** Pencerenin kendi renkleri: açılış zemini ve Windows başlık çubuğu düğmelerinin simge rengi */
export function windowColors(theme: ThemeId): { background: string; symbol: string } {
  const p = THEME_PALETTES[theme];
  return { background: p['bg-rail'], symbol: theme === 'light' ? '#4e5058' : '#b5bac1' };
}
