import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChannelPanelPage } from '@diskort/shared';
import { errorMessage } from '@diskort/client-core';

/** Bir "daha yükle" isteğinde art arda izlenen en fazla boş sayfa */
const EMPTY_PAGE_HOPS = 5;

export interface Paged<T> {
  items: T[];
  /** İlk sayfa yükleniyor (liste boş) */
  loading: boolean;
  /** Aşağı çekerek yenileniyor */
  refreshing: boolean;
  /** Sonraki sayfa yükleniyor */
  loadingMore: boolean;
  /** İlk sayfa yüklenemedi */
  error: string | null;
  /** Daha eskisi var */
  hasMore: boolean;
  refresh: () => void;
  loadMore: () => void;
  retry: () => void;
}

/**
 * Kanal paneli listeleri (Medya, Bağlantılar): sayfa sayfa, yeniden eskiye. `key` değişince (başka kanal)
 * baştan yüklenir; eski isteğin cevabı yok sayılır. `enabled` false iken hiç istek atılmaz (sekme açılana kadar).
 */
export function usePaged<T>(
  key: string,
  enabled: boolean,
  fetchPage: (before: string | null) => Promise<ChannelPanelPage<T>>,
  /** Liste bu kadar öğeye ulaşana (ya da sonuna gelinene) kadar sonraki sayfalar kendiliğinden yüklenir */
  minItems = 0,
): Paged<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Her baştan yüklemede artar: geç gelen eski cevaplar yok sayılır
  const generation = useRef(0);
  const busy = useRef(false);
  const fetcher = useRef(fetchPage);
  fetcher.current = fetchPage;
  // Ekranı doldurmak için kendiliğinden yüklenen sayfa sayısı (baştan yüklemede sıfırlanır)
  const [tries, setTries] = useState(0);

  const loadFirst = useCallback((mode: 'initial' | 'refresh') => {
    const gen = ++generation.current;
    busy.current = true;
    setTries(0);
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);
    fetcher.current(null).then(
      (page) => {
        if (gen !== generation.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoaded(true);
      },
      (err: unknown) => {
        if (gen !== generation.current) return;
        // Yenileme başarısızsa eldeki liste kalır
        if (mode === 'initial') setError(errorMessage(err));
      },
    ).finally(() => {
      if (gen !== generation.current) return;
      busy.current = false;
      setLoading(false);
      setRefreshing(false);
    });
  }, []);

  useEffect(() => {
    generation.current++;
    busy.current = false;
    setItems([]);
    setCursor(null);
    setLoaded(false);
    setError(null);
    setLoadingMore(false);
    if (enabled) loadFirst('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Sekme ilk kez açıldığında
  useEffect(() => {
    if (enabled && !loaded && !busy.current && error === null) loadFirst('initial');
  }, [enabled, loaded, error, loadFirst]);

  const loadMore = useCallback(() => {
    if (!cursor || busy.current) return;
    const gen = generation.current;
    busy.current = true;
    setLoadingMore(true);
    // Boş dönen ama devamı olan sayfalar (sunucu bir istekte sınırlı sayıda mesaj tarar) hemen sürdürülür:
    // liste değişmeyince "sona gelindi" olayı yeniden gelmez
    const fetchFrom = async (from: string, hops: number): Promise<void> => {
      const page = await fetcher.current(from);
      if (gen !== generation.current) return;
      if (page.items.length === 0 && page.nextCursor && hops < EMPTY_PAGE_HOPS) return fetchFrom(page.nextCursor, hops + 1);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    };
    fetchFrom(cursor, 0).catch(() => undefined).finally(() => {
      if (gen !== generation.current) return;
      busy.current = false;
      setLoadingMore(false);
    });
  }, [cursor]);

  // Ekranı doldurmayan liste (ör. bağlantısı kod içinde kalan mesajlarla boş dönen sayfa) kendiliğinden sürer:
  // kaydırılamayan listede "sona gelindi" olayı gelmez
  useEffect(() => {
    if (!loaded || loadingMore || refreshing || cursor === null || items.length >= minItems || tries >= 10) return;
    setTries((n) => n + 1);
    loadMore();
  }, [loaded, loadingMore, refreshing, cursor, items.length, minItems, tries, loadMore]);

  return {
    items,
    loading: loading || (enabled && !loaded && error === null),
    refreshing,
    loadingMore,
    error,
    hasMore: cursor !== null,
    refresh: useCallback(() => loadFirst('refresh'), [loadFirst]),
    loadMore,
    retry: useCallback(() => loadFirst('initial'), [loadFirst]),
  };
}
