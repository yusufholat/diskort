import { StyleSheet, type PressableAndroidRippleConfig, type TextStyle } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import { create } from 'zustand';

/**
 * Tasarım belirteçleri: renkler, boşluklar, köşeler, yazı ölçüleri. Temalar masaüstündekilerle aynı ad ve
 * renklerde (bkz. apps/desktop/src/shared/themes.ts); ekranlar sayı yazmak yerine buradaki adları kullanır.
 *
 * Temalar: Siyah (OLED, varsayılan), Koyu, Açık, Gece Mavisi, Mor Gece, Orman, Gün Batımı. Seçim açılışta eşzamanlı okunur (modüllerdeki stiller ilk kez
 * kurulmadan önce). Çalışırken değiştirilince `colors` yerinde güncellenir, `createStyles` ile kurulan
 * stiller yeniden hesaplanır ve ekranlar yeniden kurulur (bkz. app/_layout.tsx).
 */

export type ThemeName = 'black' | 'dark' | 'light' | 'midnight' | 'purple' | 'forest' | 'sunset';

const dark = {
  // Yüzeyler (koyudan açığa)
  deep: '#111214',
  rail: '#1e1f22',
  panel: '#232428',
  side: '#2b2d31',
  main: '#313338',
  /** Sunucu çubuğundaki yuvarlak düğmeler (ana sayfa, sunucu ekle) */
  raised: '#313338',
  /** Sohbetin altında beliren "yazıyor" şeridi (sohbet zemini, hafif saydam) */
  mainTranslucent: 'rgba(49,51,56,0.94)',
  input: '#1e1f22',
  /** Satır içi kod ve gizli spoiler zemini */
  code: '#1e1f22',
  hover: '#35373c',
  /** Yazma kutusu ve yanındaki yuvarlak düğmeler (sohbet zemininden bir ton açık) */
  field: '#383a40',
  active: '#404249',
  /** İkincil düğme, kaydırıcı yolu, kapalı anahtar; üzerindeki yazı onControl */
  control: '#4e5058',
  controlPressed: '#6d6f78',
  onControl: '#ffffff',
  line: '#3f4147',
  /** Kutu kenarları ve şerit altı çizgileri (koyu temada gölge gibi, siyah temada görünür gri) */
  edge: 'rgba(0,0,0,0.3)',

  // Metin
  text: '#dbdee1',
  muted: '#949ba4',
  /** Zaman damgası gibi ikincil bilgiler */
  faint: '#878b95',
  head: '#f2f3f5',

  // Vurgu
  brand: '#5865f2',
  brandPressed: '#4752c4',
  brandSoft: 'rgba(88,101,242,0.18)',
  brandText: '#949cf7',
  /** @bahsetme yazısı */
  mention: '#c9cdfb',
  ok: '#23a55a',
  okSoft: 'rgba(35,165,90,0.16)',
  /** Zemin üzerinde yeşil yazı */
  okText: '#2dc770',
  danger: '#f23f43',
  dangerPressed: '#da373c',
  dangerSoft: 'rgba(242,63,67,0.14)',
  dangerText: '#fa777c',
  warn: '#f0b232',
  warnSoft: 'rgba(240,178,50,0.1)',
  link: '#00a8fc',

  backdrop: 'rgba(0,0,0,0.6)',
  white: '#ffffff',

  /** Zemine bindirilen ton (dokunma dalgası, açılmış spoiler, kaydırıcı yolu): "r,g,b"; bkz. tint() */
  overlay: '255,255,255',
  /** Marka renginin "r,g,b" hâli (seçim rengi, vurgulu zeminler); bkz. brandTint() */
  brandRgb: '88,101,242',
  /** Durum çubuğu simgeleri: koyu temalarda açık, açık temada koyu */
  statusBar: 'light' as 'light' | 'dark',
};

export type Palette = typeof dark;

/** OLED ekranlar için simsiyah: zeminler #000, katmanlar çok az açık, kenarlar belirgin */
const black: Palette = {
  ...dark,
  deep: '#000000',
  rail: '#000000',
  panel: '#101010',
  side: '#0b0b0b',
  main: '#000000',
  raised: '#1a1a1a',
  mainTranslucent: 'rgba(0,0,0,0.94)',
  input: '#161616',
  code: '#1a1a1a',
  hover: '#1a1a1a',
  field: '#161616',
  active: '#262626',
  control: '#2e2f33',
  controlPressed: '#45474e',
  line: '#2a2a2a',
  edge: '#262626',
  backdrop: 'rgba(0,0,0,0.75)',
};

/** Discord'un açık temasına yakın: beyaz sohbet, #f2f3f5 paneller, koyu yazı */
const light: Palette = {
  deep: '#d4d7dc',
  rail: '#e3e5e8',
  panel: '#ebedef',
  side: '#f2f3f5',
  main: '#ffffff',
  raised: '#ffffff',
  mainTranslucent: 'rgba(255,255,255,0.94)',
  input: '#ebedef',
  code: '#ebedef',
  hover: '#e3e5e8',
  field: '#ebedef',
  active: '#d4d7dc',
  control: '#d4d7dc',
  controlPressed: '#c4c9ce',
  onControl: '#313338',
  line: '#d4d7dc',
  edge: 'rgba(0,0,0,0.1)',
  text: '#313338',
  muted: '#5c5e66',
  faint: '#6a6c75',
  head: '#060607',
  brand: '#5865f2',
  brandPressed: '#4752c4',
  brandSoft: 'rgba(88,101,242,0.14)',
  brandText: '#3c46b8',
  mention: '#3c46b8',
  ok: '#1f9150',
  okSoft: 'rgba(31,145,80,0.12)',
  okText: '#187a43',
  danger: '#da373c',
  dangerPressed: '#a12829',
  dangerSoft: 'rgba(218,55,60,0.1)',
  dangerText: '#c4262b',
  warn: '#e59f1e',
  warnSoft: 'rgba(229,159,30,0.14)',
  link: '#0062d6',
  backdrop: 'rgba(0,0,0,0.5)',
  white: '#ffffff',
  overlay: '0,0,0',
  brandRgb: '88,101,242',
  statusBar: 'dark',
};

/** Lacivert / mavi-arduvaz */
const midnight: Palette = {
  ...dark,
  deep: '#070b14',
  rail: '#0b1120',
  panel: '#0f1729',
  side: '#111a2e',
  main: '#16213a',
  raised: '#16213a',
  mainTranslucent: 'rgba(22,33,58,0.94)',
  input: '#0e1628',
  code: '#0e1628',
  hover: '#1c2946',
  field: '#1d2a47',
  active: '#25355a',
  control: '#34456b',
  controlPressed: '#44587f',
  line: '#2a3a5c',
  edge: 'rgba(0,0,0,0.35)',
  text: '#d6dff0',
  muted: '#94a3c2',
  faint: '#7a8bad',
  head: '#f0f4fc',
  brand: '#3b6fe0',
  brandPressed: '#2f5bc0',
  brandSoft: 'rgba(59,111,224,0.2)',
  brandText: '#8fb2ff',
  mention: '#c2d6ff',
  link: '#5cb8ff',
  brandRgb: '59,111,224',
};

/** Koyu mor, eflatun vurgu */
const purple: Palette = {
  ...dark,
  deep: '#0e0a17',
  rail: '#140e21',
  panel: '#181127',
  side: '#1c142d',
  main: '#221936',
  raised: '#221936',
  mainTranslucent: 'rgba(34,25,54,0.94)',
  input: '#150f24',
  code: '#150f24',
  hover: '#2a1f42',
  field: '#2b2043',
  active: '#362852',
  control: '#45375f',
  controlPressed: '#574775',
  line: '#3a2d55',
  edge: 'rgba(0,0,0,0.35)',
  text: '#e2dcef',
  muted: '#a79bc2',
  faint: '#8a7ea6',
  head: '#f6f2fd',
  brand: '#8a4fe0',
  brandPressed: '#7339c7',
  brandSoft: 'rgba(138,79,224,0.22)',
  brandText: '#c9a4ff',
  mention: '#e3cfff',
  link: '#d49cff',
  brandRgb: '138,79,224',
};

/** Koyu yeşil / deniz yeşili */
const forest: Palette = {
  ...dark,
  deep: '#0a1210',
  rail: '#0e1815',
  panel: '#111d1a',
  side: '#13211d',
  main: '#182a25',
  raised: '#182a25',
  mainTranslucent: 'rgba(24,42,37,0.94)',
  input: '#0f1b18',
  code: '#0f1b18',
  hover: '#1e342e',
  field: '#1f332d',
  active: '#274139',
  control: '#35514a',
  controlPressed: '#44645b',
  line: '#2c4740',
  edge: 'rgba(0,0,0,0.35)',
  text: '#d8e6e1',
  muted: '#96aea6',
  faint: '#7a938b',
  head: '#eff7f4',
  brand: '#0f8a6c',
  brandPressed: '#0b7059',
  brandSoft: 'rgba(15,138,108,0.22)',
  brandText: '#6fe0c4',
  mention: '#bff2e4',
  link: '#4fd6c3',
  brandRgb: '15,138,108',
};

/** Sıcak koyu kahve, turuncu vurgu */
const sunset: Palette = {
  ...dark,
  deep: '#140d0a',
  rail: '#1b120e',
  panel: '#1f1510',
  side: '#241813',
  main: '#2b1d17',
  raised: '#2b1d17',
  mainTranslucent: 'rgba(43,29,23,0.94)',
  input: '#1a110d',
  code: '#1a110d',
  hover: '#34241c',
  field: '#35251d',
  active: '#432f25',
  control: '#57412f',
  controlPressed: '#6b5140',
  line: '#4a3429',
  edge: 'rgba(0,0,0,0.35)',
  text: '#eee0d6',
  muted: '#b8a090',
  faint: '#9a8272',
  head: '#fbf1ea',
  brand: '#c9561a',
  brandPressed: '#a84513',
  brandSoft: 'rgba(201,86,26,0.22)',
  brandText: '#ffa36b',
  mention: '#ffd9bd',
  link: '#ffb074',
  brandRgb: '201,86,26',
};

export const palettes: Record<ThemeName, Palette> = { black, dark, light, midnight, purple, forest, sunset };

/** Seçicideki sıra; masaüstündeki temalarla aynı adlar ve renkler (apps/desktop/src/shared/themes.ts) */
export const THEME_NAMES: readonly ThemeName[] = ['black', 'dark', 'light', 'midnight', 'purple', 'forest', 'sunset'];
export const THEME_LABELS: Record<ThemeName, string> = {
  black: 'Siyah (OLED)',
  dark: 'Koyu',
  light: 'Açık',
  midnight: 'Gece Mavisi',
  purple: 'Mor Gece',
  forest: 'Orman',
  sunset: 'Gün Batımı',
};
export const DEFAULT_THEME: ThemeName = 'black';

/**
 * Kayıtlı seçim. Eski anahtarda ('diskort-theme') yalnızca koyu/siyah vardı ve koyu varsayılandı: o
 * kullanıcılar siyaha geçer. Yeni anahtara yalnızca kullanıcının Görünüm'de yaptığı seçim yazılır.
 */
const THEME_KEY = 'diskort-theme-2';

const isThemeName = (v: unknown): v is ThemeName => typeof v === 'string' && (THEME_NAMES as readonly string[]).includes(v);

/** Açılışta kayıtlı tema eşzamanlı okunur: modül düzeyindeki stiller doğru renklerle kurulsun. */
function storedTheme(): ThemeName {
  try {
    const saved = SecureStore.getItem(THEME_KEY);
    return isThemeName(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

const initial = storedTheme();

/** Etkin temanın renkleri. Tema değişince yerinde güncellenir: çizim sırasında okunmalıdır. */
export const colors: Palette = { ...palettes[initial] };

/** 4'ün katları */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const radius = { xs: 3, sm: 4, md: 8, lg: 16, xl: 20, pill: 999 } as const;

/** Yazı ölçüleri (masaüstünden biraz büyük: telefonda parmak ve göz mesafesi) */
export const font = {
  caption: 12,
  small: 13.5,
  body: 15.5,
  row: 16,
  title: 17,
  heading: 20,
  hero: 26,
} as const;

function textStyles() {
  return {
    /** "METİN KANALLARI" gibi bölüm başlıkları */
    section: {
      color: colors.muted,
      fontSize: font.caption,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    title: { color: colors.head, fontSize: font.title, fontWeight: '700' },
    body: { color: colors.text, fontSize: font.body },
    muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  } satisfies Record<string, TextStyle>;
}

/** Sık kullanılan metin biçimleri (tema değişince yerinde güncellenir) */
export const text = textStyles();

/** Zemine bindirilen ton: koyu temalarda beyaz, açık temada siyah (dokunma dalgası, spoiler, kaydırıcı yolu) */
export const tint = (alpha: number): string => `rgba(${colors.overlay},${alpha})`;

/** Marka renginin saydam hâli (seçim rengi, vurgulu zeminler) */
export const brandTint = (alpha: number): string => `rgba(${colors.brandRgb},${alpha})`;

function ripples() {
  return {
    row: { color: tint(0.07), foreground: true },
    strong: { color: tint(0.14), foreground: true },
    icon: { color: tint(0.12), borderless: true, radius: 22 },
  } satisfies Record<string, PressableAndroidRippleConfig>;
}

/** Android dokunma dalgası: satırlar kutunun içinde, simge düğmeleri daire olarak (tema değişince yerinde güncellenir) */
export const ripple = ripples();

/** Başlık çubuğu yüksekliği ve ortak ekran boşlukları */
export const layout = {
  gutter: 16,
  rowHeight: 44,
  /** Mesaj satırında avatar sütunu */
  avatarColumn: 64,
} as const;

interface ThemeState {
  name: ThemeName;
  /** Her tema değişiminde artar: ekranlar bu anahtarla yeniden kurulur */
  version: number;
}

export const useTheme = create<ThemeState>()(() => ({ name: initial, version: 0 }));

/**
 * Kök görünümün (ekran geçişlerinde, klavye açılırken görünen zemin) rengi temaya uyar. Durum çubuğu
 * simgelerinin rengi app/_layout.tsx'te `colors.statusBar` ile ayarlanır.
 */
function applySystemUi(): void {
  SystemUI.setBackgroundColorAsync(colors.rail).catch(() => undefined);
}
applySystemUi();

/** Temayı değiştirir: kaydedilir ve yeniden başlatmadan hemen uygulanır. */
export function setTheme(name: ThemeName): void {
  if (useTheme.getState().name === name) return;
  try {
    SecureStore.setItem(THEME_KEY, name);
  } catch {
    // Kaydedilemese de bu oturumda uygulanır
  }
  Object.assign(colors, palettes[name]);
  Object.assign(text, textStyles());
  Object.assign(ripple, ripples());
  applySystemUi();
  useTheme.setState((s) => ({ name, version: s.version + 1 }));
}

/**
 * Temaya bağlı stil kağıdı: `StyleSheet.create` yerine kullanılır. Stiller ilk kullanıldıklarında ve her
 * tema değişiminden sonra yeniden hesaplanır (modül yüklenirken bir kez sabitlenmez).
 */
export function createStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: () => T & StyleSheet.NamedStyles<any>,
): T {
  let sheet: T | null = null;
  let version = -1;
  const current = (): T => {
    const v = useTheme.getState().version;
    if (!sheet || version !== v) {
      sheet = StyleSheet.create(factory());
      version = v;
    }
    return sheet;
  };
  return new Proxy({} as T, {
    get: (_target, key) => current()[key as keyof T],
    has: (_target, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, key) => {
      const d = Reflect.getOwnPropertyDescriptor(current(), key);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}
