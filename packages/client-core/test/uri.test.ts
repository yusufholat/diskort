import { describe, expect, it } from 'vitest';
import { lastPathSegment, safeDecodeURIComponent } from '../src';

describe('safeDecodeURIComponent', () => {
  it('geçerli kodlamayı çözer', () => {
    expect(safeDecodeURIComponent('%C3%A7i%C3%A7ek%20resmi.png')).toBe('çiçek resmi.png');
    expect(safeDecodeURIComponent('')).toBe('');
  });

  it('bozuk kaçış dizisinde fırlatmaz, metni olduğu gibi döndürür', () => {
    expect(safeDecodeURIComponent('%zz')).toBe('%zz');
    expect(safeDecodeURIComponent('resim%')).toBe('resim%');
    // Yarım UTF-8 dizisi
    expect(safeDecodeURIComponent('%E0%A4%A')).toBe('%E0%A4%A');
    expect(safeDecodeURIComponent('%C3')).toBe('%C3');
  });
});

describe('lastPathSegment', () => {
  it('sorgu ve çapa olmadan son parçayı çözer', () => {
    expect(lastPathSegment('https://ornek.test/a/b/kedi%20foto.jpg?w=1#x')).toBe('kedi foto.jpg');
    expect(lastPathSegment('https://ornek.test/')).toBe('');
    expect(lastPathSegment('file:///data/user/0/belge.pdf')).toBe('belge.pdf');
  });

  it('bozuk kodlamalı adreste çökmez', () => {
    expect(lastPathSegment('https://ornek.test/resim%zz.png')).toBe('resim%zz.png');
  });
});
