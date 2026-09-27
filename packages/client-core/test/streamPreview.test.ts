import { describe, expect, it } from 'vitest';
import { formatStreamElapsed } from '../src/streamPreview';

describe('yayın süresi', () => {
  it('saatten kısa: dd:ss, uzun: s:dd:ss', () => {
    expect(formatStreamElapsed(0)).toBe('00:00');
    expect(formatStreamElapsed(-5000)).toBe('00:00');
    expect(formatStreamElapsed(247_900)).toBe('04:07');
    expect(formatStreamElapsed(3_729_000)).toBe('1:02:09');
  });
});
