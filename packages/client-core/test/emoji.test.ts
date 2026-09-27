import { describe, expect, it } from 'vitest';
import { EMOJI_CATEGORIES, isJumboEmoji, JUMBO_EMOJI_MAX, splitEmoji } from '../src/emoji';
import { parseInline, plainText } from '../src/markdown';
import { reactionSummary } from '../src/reactions';

describe('metindeki emojiler', () => {
  it('seçicideki her emoji tek bir emoji olarak tanınır', () => {
    for (const emoji of EMOJI_CATEGORIES.flatMap((c) => c.emojis)) {
      expect(splitEmoji(emoji), emoji).toEqual([{ text: emoji, emoji: true }]);
    }
  });

  it('ten rengi, ZWJ dizileri, bayraklar ve tuş başlıkları tek emojidir', () => {
    for (const emoji of ['👍🏽', '👨‍👩‍👧', '🏳️‍🌈', '🇹🇷', '1️⃣', '❤️', '☝🏻', '🧑‍💻', '🏴󠁧󠁢󠁳󠁣󠁴󠁿']) {
      expect(splitEmoji(emoji), emoji).toEqual([{ text: emoji, emoji: true }]);
    }
  });

  it('düz metni, sayıları ve metin biçimli sembolleri emoji saymaz', () => {
    for (const text of ['selam', '123 #1 *', '© ® ™ → ☺', 'a-b']) {
      expect(splitEmoji(text).some((p) => p.emoji), text).toBe(false);
    }
  });

  it('metni emoji ve metin parçalarına ayırır', () => {
    expect(splitEmoji('selam 👋 nasılsın😀?')).toEqual([
      { text: 'selam ', emoji: false },
      { text: '👋', emoji: true },
      { text: ' nasılsın', emoji: false },
      { text: '😀', emoji: true },
      { text: '?', emoji: false },
    ]);
  });

  it('yalnızca emojiden oluşan mesaj dev boyuttadır (boşluk serbest, en fazla sınır kadar)', () => {
    expect(isJumboEmoji('😀')).toBe(true);
    expect(isJumboEmoji(' 😀 🎉\n👍🏽 ')).toBe(true);
    expect(isJumboEmoji('😀'.repeat(JUMBO_EMOJI_MAX))).toBe(true);
    expect(isJumboEmoji('😀'.repeat(JUMBO_EMOJI_MAX + 1))).toBe(false);
    expect(isJumboEmoji('😀 tamam')).toBe(false);
    expect(isJumboEmoji('   ')).toBe(false);
    expect(isJumboEmoji('')).toBe(false);
  });

  it('ayrıştırıcı emojileri ayrı düğüm yapar; kod içindekiler metin kalır', () => {
    expect(parseInline('**süper 🔥** `🔥` 👍')).toEqual([
      { type: 'bold', children: [{ type: 'text', text: 'süper ' }, { type: 'emoji', text: '🔥' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: '🔥' },
      { type: 'text', text: ' ' },
      { type: 'emoji', text: '👍' },
    ]);
    expect(plainText('merhaba 👋 dünya', () => undefined)).toBe('merhaba 👋 dünya');
  });
});

describe('tepki ipucu', () => {
  it('Discord gibi özetler', () => {
    expect(reactionSummary(['Ali'], 1, '👍')).toBe('Ali 👍 ile tepki verdi');
    expect(reactionSummary(['Ali', 'Veli'], 2, '👍')).toBe('Ali ve Veli 👍 ile tepki verdi');
    expect(reactionSummary(['Ali', 'Veli', 'Ayşe'], 3, '👍')).toBe('Ali, Veli ve Ayşe 👍 ile tepki verdi');
    expect(reactionSummary(['Ali', 'Veli', 'Ayşe', 'Can'], 6, '🎉')).toBe('Ali, Veli, Ayşe ve 3 kişi daha 🎉 ile tepki verdi');
    expect(reactionSummary([], 4, '🔥')).toBe('4 kişi 🔥 ile tepki verdi');
  });
});
