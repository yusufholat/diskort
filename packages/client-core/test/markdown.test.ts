import { describe, expect, it } from 'vitest';
import { broadcastMention, parseInline, parseMarkdown } from '../src/markdown';

describe('satır içi biçimlendirme', () => {
  it('iç içe stilleri ayrıştırır', () => {
    expect(parseInline('**kalın *italik* son**')).toEqual([
      {
        type: 'bold',
        children: [
          { type: 'text', text: 'kalın ' },
          { type: 'italic', children: [{ type: 'text', text: 'italik' }] },
          { type: 'text', text: ' son' },
        ],
      },
    ]);
  });

  it('kod içindeki işaretleri biçimlendirmez', () => {
    expect(parseInline('`**değil**` ve __altı__')).toEqual([
      { type: 'code', text: '**değil**' },
      { type: 'text', text: ' ve ' },
      { type: 'underline', children: [{ type: 'text', text: 'altı' }] },
    ]);
  });

  it('snake_case adlarını italik saymaz', () => {
    expect(parseInline('dosya_adi_uzun')).toEqual([{ type: 'text', text: 'dosya_adi_uzun' }]);
  });

  it('bağlantının sonundaki noktalama bağlantıya dahil değildir', () => {
    expect(parseInline('bak: https://ziroo.net/a?b=1).')).toEqual([
      { type: 'text', text: 'bak: ' },
      { type: 'link', url: 'https://ziroo.net/a?b=1' },
      { type: 'text', text: ').' },
    ]);
  });

  it('bahsetmeler: e-posta sayılmaz, sondaki nokta noktalama sayılır', () => {
    expect(parseInline('mail@uye.com @Ali. ~~x~~ ||s||')).toEqual([
      { type: 'text', text: 'mail@uye.com ' },
      { type: 'mention', username: 'ali', raw: '@Ali' },
      { type: 'text', text: '. ' },
      { type: 'strike', children: [{ type: 'text', text: 'x' }] },
      { type: 'text', text: ' ' },
      { type: 'spoiler', children: [{ type: 'text', text: 's' }] },
    ]);
  });

  it('HTML düz metin kalır', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { type: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});

describe('bloklar', () => {
  it('alıntı, kod bloğu ve paragrafları ayırır', () => {
    const blocks = parseMarkdown('önce:\n> alıntı 1\n>alıntı 2\n```js\nconst x = 1;\n```\nsonra');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'quote', 'codeblock', 'paragraph']);
    expect(blocks[1]).toEqual({ type: 'quote', children: [{ type: 'text', text: 'alıntı 1\nalıntı 2' }] });
    expect(blocks[2]).toEqual({ type: 'codeblock', lang: 'js', text: 'const x = 1;' });
    expect(blocks[3]).toEqual({ type: 'paragraph', children: [{ type: 'text', text: 'sonra' }] });
  });

  it('dilsiz ve tek satırlık kod bloğu', () => {
    expect(parseMarkdown('```merhaba```')).toEqual([{ type: 'codeblock', lang: null, text: 'merhaba' }]);
  });
});

describe('@everyone ve @here', () => {
  it('yalnızca mesajda bildirim olduysa bahsetme sayılır', () => {
    const [everyone, , here] = parseInline('@everyone ve @here');
    expect(everyone).toEqual({ type: 'mention', username: 'everyone', raw: '@everyone' });
    expect(here).toEqual({ type: 'mention', username: 'here', raw: '@here' });
    expect(broadcastMention('everyone', { mentionEveryone: true, mentionHere: false })).toBe('everyone');
    expect(broadcastMention('here', { mentionEveryone: true, mentionHere: false })).toBeNull();
    expect(broadcastMention('here', { mentionEveryone: false, mentionHere: true })).toBe('here');
    expect(broadcastMention('everyone', { mentionEveryone: false })).toBeNull();
    expect(broadcastMention('ali', { mentionEveryone: true, mentionHere: true })).toBeNull();
    expect(broadcastMention('everyone', undefined)).toBeNull();
  });
});
