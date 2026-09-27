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
