// GIF seçici (GIPHY, sunucu üzerinden) ve mesajdaki GIF'in gösterimi: masaüstü ve mobil ortak.

import { create } from 'zustand';
import type { GifEmbed, GifPage, GifResult, Message } from '@diskort/shared';
import { errorMessage, request } from './api';
import { gateway } from './gateway';

interface FeaturesStore {
  /** Sunucuda GIF araması açık (GIPHY anahtarı tanımlı); kapalıysa GIF düğmesi gösterilmez */
  gifs: boolean;
}

/** Sunucunun READY'de bildirdiği isteğe bağlı özellikler (eski sunucularda hepsi kapalı) */
export const useFeatures = create<FeaturesStore>()(() => ({ gifs: false }));

gateway.on((msg) => {
  if (msg.t === 'READY') useFeatures.setState({ gifs: msg.d.features?.gifs === true });
});

export const trendingGifs = (offset = 0): Promise<GifPage> =>
  request<GifPage>('GET', `/api/gifs/trending${offset ? `?offset=${offset}` : ''}`);

export const searchGifs = (query: string, offset = 0): Promise<GifPage> =>
  request<GifPage>('GET', `/api/gifs/search?q=${encodeURIComponent(query)}${offset ? `&offset=${offset}` : ''}`);

/** GIPHY'nin medya sunucuları: yalnızca bunlardan gelen adresler gösterilir */
const GIPHY_MEDIA = /^https:\/\/(?:media[0-9]?|i)\.giphy\.com\//;

export const isGiphyMedia = (url: string | null | undefined): url is string => !!url && GIPHY_MEDIA.test(url);

/**
 * Mesajdaki GIF: sunucu yalnızca metni tek bir GIPHY bağlantısı olan mesaja ekler; bu durumda bağlantı
 * yazısı gösterilmez, yalnızca GIF gösterilir (Discord gibi).
 */
export function gifOf(message: Pick<Message, 'embeds'>): GifEmbed | null {
  const embed = message.embeds?.find((e) => e.type === 'gif');
  return embed && isGiphyMedia(embed.gif) ? embed : null;
}

/** Seçicideki sonucun mesajda görünecek hâli (gönderilirken hemen gösterilir; sunucu onaylar) */
export const gifEmbed = ({ preview: _preview, ...gif }: GifResult): GifEmbed => ({ type: 'gif', provider: 'giphy', ...gif });

/** Gösterim kutusu: en-boy oranı korunarak sınırlara sığdırılır */
export function fitBox(
  width: number | null | undefined,
  height: number | null | undefined,
  max: { width: number; height: number },
): { width: number; height: number } | null {
  if (!width || !height) return null;
  const scale = Math.min(1, max.width / width, max.height / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// ---------- Arama ----------

export interface GifPickerState {
  /** Arama metni; boşsa popüler GIF'ler */
  query: string;
  results: GifResult[];
  /** İlk sayfa yükleniyor */
  loading: boolean;
  /** Sonraki sayfa yükleniyor */
  loadingMore: boolean;
  error: string | null;
  /** Sonraki sayfanın başlangıcı; yoksa null */
  next: number | null;
}

/** Açık olan GIF seçicinin durumu (bir uygulamada aynı anda tek seçici açılır) */
export const useGifPicker = create<GifPickerState>()(() => ({
  query: '',
  results: [],
  loading: false,
  loadingMore: false,
  error: null,
  next: null,
}));

const SEARCH_DELAY_MS = 300;
const TRENDING_TTL_MS = 5 * 60_000;
/** Seçici her açıldığında popüler GIF'ler beklenmeden gösterilsin */
let trendingCache: { at: number; page: GifPage } | null = null;
/** Yalnızca en son aramanın yanıtı işlenir */
let generation = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const normalized = (query: string): string => query.replace(/\s+/g, ' ').trim();

function load(delay: number): void {
  const id = ++generation;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = null;
  const q = normalized(useGifPicker.getState().query);
  if (!q && trendingCache && Date.now() - trendingCache.at < TRENDING_TTL_MS) {
    const { results, next } = trendingCache.page;
    useGifPicker.setState({ results, next, loading: false, error: null });
    return;
  }
  useGifPicker.setState({ loading: true, error: null });
  searchTimer = setTimeout(
    () => {
      searchTimer = null;
      (q ? searchGifs(q) : trendingGifs())
        .then((page) => {
          if (id !== generation) return;
          if (!q) trendingCache = { at: Date.now(), page };
          useGifPicker.setState({ results: page.results, next: page.next, loading: false });
        })
        .catch((err: unknown) => {
          if (id !== generation) return;
          useGifPicker.setState({ results: [], next: null, loading: false, error: errorMessage(err) });
        });
    },
    q ? delay : 0,
  );
}

/** Seçici açılınca: arama temizlenir, popüler GIF'ler gösterilir */
export function openGifPicker(): void {
  useGifPicker.setState({ query: '', loadingMore: false });
  load(0);
}

/** Seçici kapanınca bekleyen istekler yok sayılır */
export function closeGifPicker(): void {
  generation++;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = null;
  useGifPicker.setState({ loading: false, loadingMore: false });
}

/** Yazarken: kısa bir gecikmeyle arar (her tuşta istek gitmez) */
export function setGifQuery(query: string): void {
  const previous = useGifPicker.getState().query;
  if (query === previous) return;
  useGifPicker.setState({ query });
  if (normalized(query) !== normalized(previous)) load(SEARCH_DELAY_MS);
}

/** Hata sonrası yeniden dene */
export function retryGifs(): void {
  load(0);
}

/** Sonraki sayfayı ekler (kaydırma sona gelince ya da "Daha fazla") */
export function loadMoreGifs(): void {
  const { next, loadingMore, loading, query } = useGifPicker.getState();
  if (next === null || loadingMore || loading) return;
  const id = generation;
  const q = normalized(query);
  useGifPicker.setState({ loadingMore: true });
  (q ? searchGifs(q, next) : trendingGifs(next))
    .then((page) => {
      if (id !== generation) return;
      const { results } = useGifPicker.getState();
      const seen = new Set(results.map((r) => r.id));
      useGifPicker.setState({ results: [...results, ...page.results.filter((r) => !seen.has(r.id))], next: page.next });
    })
    .catch((err: unknown) => {
      if (id === generation) useGifPicker.setState({ error: errorMessage(err) });
    })
    .finally(() => {
      if (id === generation) useGifPicker.setState({ loadingMore: false });
    });
}
