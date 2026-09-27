// Tepki olarak kabul edilen emojiler: tek bir Unicode emoji (ten rengi, bayrak ve ZWJ dizileri dahil).
// Sunucuya özel (resimli) emoji henüz yok. `v` bayrağı TypeScript hedefinden bağımsız olsun diye
// düzenli ifade metinden kurulur.
const RGI_EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v');
/** En uzun emoji dizileri (aile, bölge bayrakları) 15 UTF-16 birimini geçmez */
const MAX_LENGTH = 32;
const VARIATION_SELECTOR_16 = '️';

/** Geçerli tek bir emojiyse standart biçimini, değilse null döner. */
export function normalizeEmoji(raw: string): string | null {
  const emoji = raw.trim();
  if (!emoji || emoji.length > MAX_LENGTH) return null;
  if (RGI_EMOJI.test(emoji)) return emoji;
  // Metin biçimli yazılmış emoji (ör. U+FE0F'siz ❤) renkli biçimine çevrilir
  const colored = emoji + VARIATION_SELECTOR_16;
  return !emoji.includes(VARIATION_SELECTOR_16) && RGI_EMOJI.test(colored) ? colored : null;
}
