import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CosmeticsCatalog } from '@diskort/shared';
import { configureClient, cosmeticUrl, loadCosmetics, useCosmetics, type KeyValueStorage } from '../src';

const memory = new Map<string, string>();
const storage: KeyValueStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

const catalog: CosmeticsCatalog = {
  decorations: [{ id: 'neon', name: 'Neon halka', url: '/api/cosmetics/decorations/neon.webp?v=abc' }],
  frames: [{ id: 'gold', name: 'Altın süsler', url: '/api/cosmetics/frames/gold.webp?v=def' }],
};

let server = 'sunucu.test';

beforeEach(async () => {
  server = 'sunucu.test';
  useCosmetics.setState({ server: null, catalog: null });
  await configureClient({
    platform: 'android',
    version: '9.9.9',
    storage,
    serverUrl: () => server,
    notifyError: () => undefined,
    upload: async () => ({ status: 0, body: '' }),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('kozmetik kataloğu', () => {
  it('bir kez alınır; adresler sunucu adresiyle tamamlanır, bilinmeyen kimlik null', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(cosmeticUrl('decorations', 'neon')).toBeNull();
    await Promise.all([loadCosmetics(), loadCosmetics()]);
    await loadCosmetics();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(cosmeticUrl('decorations', 'neon')).toBe('http://sunucu.test/api/cosmetics/decorations/neon.webp?v=abc');
    expect(cosmeticUrl('frames', 'gold')).toBe('http://sunucu.test/api/cosmetics/frames/gold.webp?v=def');
    // Tür karışmaz, bilinmeyen ve boş kimlik çizilmez
    expect(cosmeticUrl('frames', 'neon')).toBeNull();
    expect(cosmeticUrl('decorations', 'eski-tasarim')).toBeNull();
    expect(cosmeticUrl('decorations', null)).toBeNull();

    // Sunucu değişince yeniden alınır
    server = 'baska.test';
    await loadCosmetics();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cosmeticUrl('decorations', 'neon')).toBe('http://baska.test/api/cosmetics/decorations/neon.webp?v=abc');
  });
});
