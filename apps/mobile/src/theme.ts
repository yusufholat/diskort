import type { PressableAndroidRippleConfig, TextStyle } from 'react-native';

/**
 * Tasarım belirteçleri: renkler, boşluklar, köşeler, yazı ölçüleri. Renkler masaüstüyle aynı
 * (Discord'a yakın koyu tema, bkz. apps/desktop/src/renderer/src/styles.css); ekranlar sayı yazmak
 * yerine buradaki adları kullanır.
 */
export const colors = {
  // Yüzeyler (koyudan açığa)
  deep: '#111214',
  rail: '#1e1f22',
  panel: '#232428',
  side: '#2b2d31',
  main: '#313338',
  input: '#1e1f22',
  hover: '#35373c',
  /** Yazma kutusu ve yanındaki yuvarlak düğmeler (sohbet zemininden bir ton açık) */
  field: '#383a40',
  active: '#404249',
  /** İkincil düğme, kaydırıcı yolu */
  control: '#4e5058',
  controlPressed: '#6d6f78',
  line: '#3f4147',

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
} as const;

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

/** Sık kullanılan metin biçimleri */
export const text = {
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
