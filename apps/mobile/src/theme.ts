import { StyleSheet, type PressableAndroidRippleConfig, type TextStyle } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import { create } from 'zustand';

/**
 * Tasarım belirteçleri: renkler, boşluklar, köşeler, yazı ölçüleri. Koyu tema masaüstüyle aynı
 * (Discord'a yakın, bkz. apps/desktop/src/renderer/src/styles.css); ekranlar sayı yazmak yerine buradaki
 * adları kullanır.
 *
 * İki tema var: Koyu ve Siyah (OLED). Seçim açılışta eşzamanlı okunur (modüllerdeki stiller ilk kez
 * kurulmadan önce). Çalışırken değiştirilince `colors` yerinde güncellenir, `createStyles` ile kurulan
 * stiller yeniden hesaplanır ve ekranlar yeniden kurulur (bkz. app/_layout.tsx).
 */

export type ThemeName = 'dark' | 'black';

const dark = {
  // Yüzeyler (koyudan açığa)
  deep: '#111214',
  rail: '#1e1f22',
  panel: '#232428',
  side: '#2b2d31',
  main: '#313338',
  /** Sohbetin altında beliren "yazıyor" şeridi (sohbet zemini, hafif saydam) */
  mainTranslucent: 'rgba(49,51,56,0.94)',
  input: '#1e1f22',
  /** Satır içi kod ve gizli spoiler zemini */
  code: '#1e1f22',
  hover: '#35373c',
  /** Yazma kutusu ve yanındaki yuvarlak düğmeler (sohbet zemininden bir ton açık) */
  field: '#383a40',
  active: '#404249',
  /** İkincil düğme, kaydırıcı yolu, kapalı anahtar */
  control: '#4e5058',
  controlPressed: '#6d6f78',
  line: '#3f4147',
  /** Kutu kenarları ve şerit altı çizgileri (koyu temada gölge gibi, siyah temada görünür gri) */
  edge: 'rgba(0,0,0,0.3)',

  // Metin
  text: '#dbdee1',
  muted: '#949ba4',
  /** Zaman damgası gibi ikincil bilgiler (masaüstündeki #6d6f78 telefonda okunmuyordu: biraz açıldı) */
  faint: '#80848e',
  head: '#f2f3f5',

  // Vurgu
  brand: '#5865f2',
  brandPressed: '#4752c4',
  brandSoft: 'rgba(88,101,242,0.18)',
  brandText: '#949cf7',
  ok: '#23a55a',
  okSoft: 'rgba(35,165,90,0.16)',
  danger: '#f23f43',
  dangerPressed: '#da373c',
  dangerSoft: 'rgba(242,63,67,0.14)',
  dangerText: '#fa777c',
  warn: '#f0b232',
  warnSoft: 'rgba(240,178,50,0.1)',
  link: '#00a8fc',

  backdrop: 'rgba(0,0,0,0.6)',
  white: '#ffffff',
};

export type Palette = typeof dark;

/** OLED ekranlar için simsiyah: zeminler #000, katmanlar çok az açık, kenarlar belirgin */
const black: Palette = {
  ...dark,
  deep: '#000000',
  rail: '#0c0c0c',
  panel: '#101010',
  side: '#0a0a0a',
  main: '#000000',
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

export const palettes: Record<ThemeName, Palette> = { dark, black };

export const THEME_NAMES: readonly ThemeName[] = ['dark', 'black'];
export const THEME_LABELS: Record<ThemeName, string> = { dark: 'Koyu', black: 'Siyah (OLED)' };

const THEME_KEY = 'diskort-theme';

/** Açılışta kayıtlı tema eşzamanlı okunur: modül düzeyindeki stiller doğru renklerle kurulsun. */
function storedTheme(): ThemeName {
  try {
    return SecureStore.getItem(THEME_KEY) === 'black' ? 'black' : 'dark';
  } catch {
    return 'dark';
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

/** Android dokunma dalgası: satırlar kutunun içinde, simge düğmeleri daire olarak */
export const ripple = {
  row: { color: 'rgba(255,255,255,0.07)', foreground: true },
  strong: { color: 'rgba(255,255,255,0.14)', foreground: true },
  icon: { color: 'rgba(255,255,255,0.12)', borderless: true, radius: 22 },
} satisfies Record<string, PressableAndroidRippleConfig>;

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

/** Kök görünümün (ekran geçişlerinde, klavye açılırken görünen zemin) rengi temaya uyar. */
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
