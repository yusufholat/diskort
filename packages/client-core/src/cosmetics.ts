// Kozmetik kataloğu (avatar dekorasyonları, profil çerçeveleri): sunucudan bir kez alınır ve bellekte
// tutulur. Tasarımlar sunucuda durur, uygulamalar yalnızca resmini gösterir; katalogda olmayan kimlik
// (eski ya da kaldırılmış tasarım) hiç çizilmez.

import { create } from 'zustand';
import type { CosmeticsCatalog } from '@diskort/shared';
import { api, normalizeServerUrl } from './api';
import { env } from './env';

export type CosmeticKind = 'decorations' | 'frames';

interface CosmeticsState {
  /** Hangi sunucunun kataloğu (sunucu adresi değişince yeniden alınır) */
  server: string | null;
  catalog: CosmeticsCatalog | null;
}

export const useCosmetics = create<CosmeticsState>()(() => ({ server: null, catalog: null }));

let loading: { server: string; promise: Promise<void> } | null = null;
/** Alınamadıysa bir sonraki deneme en erken bu zamanda (sunucu kapalıyken istek yağmuru olmasın) */
let retryAt = 0;

/** Kataloğu (henüz alınmadıysa ya da sunucu değiştiyse) sunucudan alır. */
export function loadCosmetics(): Promise<void> {
  const server = normalizeServerUrl(env().serverUrl());
  const state = useCosmetics.getState();
  if (state.server === server && state.catalog) return Promise.resolve();
  if (loading?.server === server) return loading.promise;
  if (Date.now() < retryAt) return Promise.resolve();
  const promise = api
    .cosmetics()
    .then((catalog) => useCosmetics.setState({ server, catalog }))
    .catch(() => {
      retryAt = Date.now() + 60_000;
    })
    .finally(() => {
      if (loading?.promise === promise) loading = null;
    });
  loading = { server, promise };
  return promise;
}

/** Tasarımın resminin tam adresi; kimlik yoksa, katalog henüz gelmediyse ya da katalogda yoksa null. */
export function cosmeticUrl(kind: CosmeticKind, id: string | null | undefined): string | null {
  if (!id) return null;
  const { catalog, server } = useCosmetics.getState();
  const item = catalog?.[kind].find((i) => i.id === id);
  return item && server ? server + item.url : null;
}

/**
 * Tasarımın resminin adresi; katalog gerekirse alınır (istek bir kez gider), gelince bileşen yeniden
 * çizilir.
 */
export function useCosmeticUrl(kind: CosmeticKind, id: string | null | undefined): string | null {
  const url = useCosmetics((s) => {
    const item = id ? s.catalog?.[kind].find((i) => i.id === id) : undefined;
    return item && s.server ? s.server + item.url : null;
  });
  if (id) void loadCosmetics();
  return url;
}
