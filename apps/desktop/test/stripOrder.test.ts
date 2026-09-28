import { describe, expect, it } from 'vitest';
import { orderStrip } from '../src/renderer/src/components/stage/stripOrder.js';

describe('katılımcı şeridi sırası', () => {
  it('yayın sahibi başta, kendin sonda, yeni gelenler kendinden önce', () => {
    expect(orderStrip([], ['me', 'a', 'b', 'host'], { pinned: 'host', selfId: 'me' })).toEqual(['host', 'a', 'b', 'me']);
    expect(orderStrip(['host', 'a', 'b', 'me'], ['me', 'a', 'b', 'host', 'c'], { pinned: 'host', selfId: 'me' })).toEqual([
      'host',
      'a',
      'b',
      'c',
      'me',
    ]);
  });

  it('önceki sırayı korur, ayrılanı çıkarır', () => {
    expect(orderStrip(['b', 'a', 'c'], ['a', 'c', 'b'])).toEqual(['b', 'a', 'c']);
    expect(orderStrip(['b', 'a', 'c'], ['a', 'c'])).toEqual(['a', 'c']);
  });

  it('görünmeyen yerde konuşanı görünen ilk yere alır', () => {
    const prev = ['host', 'a', 'b', 'c', 'd', 'me'];
    const users = ['a', 'b', 'c', 'd', 'host', 'me'];
    expect(orderStrip(prev, users, { pinned: 'host', selfId: 'me', promote: ['d'], firstVisible: 0 })).toEqual([
      'host',
      'd',
      'a',
      'b',
      'c',
      'me',
    ]);
    // Şerit kaydırılmış: görünen ilk kişi b (sırada 2.)
    expect(orderStrip(prev, users, { pinned: 'host', selfId: 'me', promote: ['d'], firstVisible: 2 })).toEqual([
      'host',
      'a',
      'd',
      'b',
      'c',
      'me',
    ]);
  });

  it('kendini ve yayın sahibini öne almaz, birden çok konuşanı sırasıyla alır', () => {
    const prev = ['a', 'b', 'c', 'd', 'me'];
    expect(orderStrip(prev, prev, { selfId: 'me', promote: ['me', 'd', 'c', 'd'] })).toEqual(['d', 'c', 'a', 'b', 'me']);
  });
});
