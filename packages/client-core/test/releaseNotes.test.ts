import { describe, expect, it } from 'vitest';
import { parseReleaseNotes } from '../src/releaseNotes';

describe('sürüm notları', () => {
  it('başlıkları, bölümleri, maddeleri ve kalın yazıyı ayırır; sürüm başlığını atlar', () => {
    const blocks = parseReleaseNotes('## Diskort 0.5.0\n\n**Masaüstü**\n- **DM:** bire bir\n- düz madde\nAçıklama');
    expect(blocks).toEqual([
      { kind: 'heading', text: 'Masaüstü' },
      { kind: 'item', parts: [{ text: 'DM:', bold: true }, { text: ' bire bir', bold: false }] },
      { kind: 'item', parts: [{ text: 'düz madde', bold: false }] },
      { kind: 'text', parts: [{ text: 'Açıklama', bold: false }] },
    ]);
  });
});
