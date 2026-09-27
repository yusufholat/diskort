// Tepki seçicisindeki emojiler: büyük bir emoji kütüphanesi yerine elle seçilmiş, eski telefonlarda da
// görünen (Emoji 12 ve öncesi) küçük bir liste. Bayraklar Windows'ta resim olarak çizilmediği için yok.
// Her öğe sunucunun kabul ettiği tam (renkli) biçimdedir; test ile denetlenir.

export interface EmojiCategory {
  id: string;
  label: string;
  emojis: string[];
}

const list = (s: string): string[] => s.trim().split(/\s+/);

/** Mesajın üstündeki hızlı tepki düğmeleri ve seçicinin ilk satırı */
export const QUICK_REACTIONS = list('👍 ❤️ 😂 😮 😢 🔥 🎉 👀');

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { id: 'quick', label: 'Sık kullanılanlar', emojis: QUICK_REACTIONS },
  {
    id: 'faces',
    label: 'Yüzler',
    emojis: list(`
      😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗
      🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶
      🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱
      😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖
    `),
  },
  {
    id: 'people',
    label: 'Eller ve insanlar',
    emojis: list(`
      👋 👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 👏 🙌 👐 🤲 🙏 💪 🤝 ✍️ 🤳
      👀 🧠 👑 🙈 🙉 🙊 🤷 🤦 🙋 🙇 💃 🕺
    `),
  },
  {
    id: 'symbols',
    label: 'Kalpler ve semboller',
    emojis: list(`
      ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 💕 💞 💯 💢 💥 💫 💦 💤 ✨ ⭐ 🌟 ⚡ 🔥 🎵
      🎶 ✅ ❌ ❓ ❗ ⚠️ 🚫 ➕ ➖ 🆗 🆒 🆕 💬 💭
    `),
  },
  {
    id: 'nature',
    label: 'Hayvanlar ve doğa',
    emojis: list(`
      🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦉 🐺 🐴 🦄 🐝
      🦋 🐢 🐍 🐙 🐟 🐬 🐳 🌈 ☀️ 🌙 ❄️ 🌧️ 🌸 🌹 🌻 🍀 🌲 🌵
    `),
  },
  {
    id: 'objects',
    label: 'Yiyecek, etkinlik ve nesneler',
    emojis: list(`
      🍕 🍔 🍟 🌭 🍿 🍩 🍰 🎂 🍫 🍉 🍎 🍌 🍓 ☕ 🍺 🍻 🥂 🍷 🎉 🎊 🎁 🏆 🥇 ⚽
      🏀 🎮 🕹️ 🎲 🎯 🎧 🎤 🎬 📷 💻 🖥️ 📱 💡 📌 📎 🔔 ⏰ 💰 🚀 🚗 ✈️ 🏠
    `),
  },
];

// ---------- Metindeki emojiler ----------
// Mesajdaki emojiler (Discord gibi) metinden büyük çizilir; yalnızca emojiden oluşan kısa mesajlar
// "dev" boyutta gösterilir. Düzenli ifade \p{…} kullanmaz: telefonlardaki JS motoru (Hermes) her
// Unicode özelliğini tanımıyor. Kapsam: renkli emojiler, ten rengi, ZWJ dizileri, bayraklar, tuş başlıkları.

/** Tek başına renkli çizilen (VS16 istemeyen) BMP emojileri */
const BMP_PRESENTATION =
  '\\u231A\\u231B\\u23E9-\\u23EC\\u23F0\\u23F3\\u25FD\\u25FE\\u2614\\u2615\\u2648-\\u2653\\u267F\\u2693\\u26A1' +
  '\\u26AA\\u26AB\\u26BD\\u26BE\\u26C4\\u26C5\\u26CE\\u26D4\\u26EA\\u26F2\\u26F3\\u26F5\\u26FA\\u26FD\\u2705' +
  '\\u270A\\u270B\\u2728\\u274C\\u274E\\u2753-\\u2755\\u2757\\u2795-\\u2797\\u27B0\\u27BF\\u2B1B\\u2B1C\\u2B50\\u2B55';
const SKIN = '[\\u{1F3FB}-\\u{1F3FF}]';
/** Tek bir emoji öğesi (ZWJ ile birleşen parçaların her biri) */
const ELEMENT =
  `(?:[\\u{1F000}-\\u{1FAFF}](?:\\uFE0F|${SKIN})?` +
  `|[${BMP_PRESENTATION}](?:\\uFE0F|${SKIN})?` +
  // Metin biçimli semboller (©, ❤, ☀ …) yalnızca VS16 ile ya da ten rengiyle emoji sayılır
  `|[\\u00A9\\u00AE\\u203C-\\u3299](?:\\uFE0F${SKIN}?|${SKIN}))`;
const SEQUENCE =
  `(?:[\\u{1F1E6}-\\u{1F1FF}]{2}` + // bayrak
  `|[0-9#*]\\uFE0F?\\u20E3` + // tuş başlığı (1️⃣)
  `|${ELEMENT}(?:\\u200D${ELEMENT})*[\\u{E0020}-\\u{E007F}]*)`;

const EMOJI_GLOBAL = new RegExp(SEQUENCE, 'gu');

/** Yalnızca emojiden oluşan mesajın dev boyutta çizildiği en fazla emoji sayısı (Discord gibi) */
export const JUMBO_EMOJI_MAX = 27;

export interface TextPart {
  text: string;
  emoji: boolean;
}

/** Metni emoji ve düz metin parçalarına ayırır (sırası korunur). */
export function splitEmoji(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(EMOJI_GLOBAL)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), emoji: false });
    parts.push({ text: m[0], emoji: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), emoji: false });
  return parts;
}

/** Mesaj yalnızca emojiden (ve boşluktan) mı oluşuyor, en fazla JUMBO_EMOJI_MAX tane: dev boyutta çizilir */
export function isJumboEmoji(content: string): boolean {
  if (!content || content.length > JUMBO_EMOJI_MAX * 16) return false;
  let count = 0;
  for (const part of splitEmoji(content)) {
    if (part.emoji) count++;
    else if (part.text.trim()) return false;
  }
  return count > 0 && count <= JUMBO_EMOJI_MAX;
}
