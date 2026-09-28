import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import type { GifResult } from '@diskort/shared';
import { isGiphyMedia, loadMoreGifs, retryGifs, setGifQuery, useGifPicker } from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { Skeleton } from '../ui/Skeleton';

/** İki sütunlu (duvar örgüsü) ızgara: sütun aralığı ve ızgaranın yan boşluğu (px) */
const GAP = 8;
const PADDING = 8;
/** Ölçülmeden önceki sütun genişliği (panel 424 px) */
const DEFAULT_COLUMN = 196;
/** Sona bu kadar kala sonraki sayfa yüklenir */
const LOAD_MORE_MARGIN = 400;

interface Placed {
  gif: GifResult;
  column: number;
  /** Sütun içindeki sırası */
  row: number;
  top: number;
  height: number;
}

/** Her GIF kısa olan sütuna yerleşir (yükseklik önizlemenin en-boy oranından) */
function layout(results: GifResult[], columnWidth: number): { columns: Placed[][]; height: number } {
  const columns: Placed[][] = [[], []];
  const heights = [0, 0];
  for (const gif of results) {
    const column = heights[0]! <= heights[1]! ? 0 : 1;
    const ratio = gif.preview.height / Math.max(1, gif.preview.width);
    const height = Math.max(60, Math.min(360, Math.round(columnWidth * ratio)));
    columns[column]!.push({ gif, column, row: columns[column]!.length, top: heights[column]!, height });
    heights[column]! += height + GAP;
  }
  return { columns, height: Math.max(...heights) };
}

const previewSrc = (gif: GifResult): string | null =>
  isGiphyMedia(gif.preview.webp) ? gif.preview.webp : isGiphyMedia(gif.preview.gif) ? gif.preview.gif : null;

/**
 * GIF sekmesi: arama kutusu (boşken popüler GIF'ler), kaydırdıkça devam eden ızgara, ok tuşlarıyla
 * gezinme ve Enter/tıklamayla hemen gönderme. GIPHY şartı gereği altta "Powered by GIPHY".
 */
export function GifPanel({ onSend }: { onSend: (gif: GifResult) => void }) {
  const query = useGifPicker((s) => s.query);
  const results = useGifPicker((s) => s.results);
  const loading = useGifPicker((s) => s.loading);
  const loadingMore = useGifPicker((s) => s.loadingMore);
  const error = useGifPicker((s) => s.error);
  const hasMore = useGifPicker((s) => s.next !== null);
  const [active, setActive] = useState<{ column: number; row: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Sütun genişliği kaydırma çubuğundan sonra kalan alana göre
  const [columnWidth, setColumnWidth] = useState(DEFAULT_COLUMN);
  const { columns, height } = useMemo(() => layout(results, columnWidth), [results, columnWidth]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = (): void => setColumnWidth(Math.max(80, Math.floor((el.clientWidth - PADDING * 2 - GAP) / 2)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const activeItem = active ? columns[active.column]?.[active.row] : undefined;

  // Yeni arama: seçim ve kaydırma başa döner
  useEffect(() => {
    setActive(null);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  // Klavyeyle seçilen GIF görünür kalsın
  useEffect(() => {
    if (!activeItem) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-gif-id="${activeItem.gif.id}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeItem]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el && el.scrollTop + el.clientHeight > el.scrollHeight - LOAD_MORE_MARGIN) loadMoreGifs();
  };

  // Ilk sayfa kısa kaldıysa (büyük pencere) kaydırma beklenmeden devamı yüklenir
  useEffect(() => {
    const el = scrollRef.current;
    if (el && !loading && hasMore && el.scrollHeight <= el.clientHeight + LOAD_MORE_MARGIN) loadMoreGifs();
  }, [loading, hasMore, results.length]);

  /** Diğer sütunda dikey ortası en yakın GIF */
  const across = (from: Placed): { column: number; row: number } | null => {
    const other = columns[1 - from.column]!;
    if (other.length === 0) return null;
    const center = from.top + from.height / 2;
    let best = other[0]!;
    for (const item of other) {
      if (Math.abs(item.top + item.height / 2 - center) < Math.abs(best.top + best.height / 2 - center)) best = item;
    }
    return { column: best.column, row: best.row };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return;
    const first = columns[0]![0];
    if (!activeItem) {
      if (e.key === 'ArrowDown' && first) {
        e.preventDefault();
        setActive({ column: 0, row: 0 });
      } else if (e.key === 'Enter' && first) {
        // Aramadan sonra Enter: ilk sonuç gider
        e.preventDefault();
        onSend(first.gif);
      }
      return;
    }
    const column = columns[activeItem.column]!;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (activeItem.row + 1 < column.length) setActive({ column: activeItem.column, row: activeItem.row + 1 });
      else loadMoreGifs();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeItem.row > 0 ? { column: activeItem.column, row: activeItem.row - 1 } : null);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const target = (e.key === 'ArrowRight') === (activeItem.column === 0) ? across(activeItem) : null;
      if (target) {
        e.preventDefault();
        setActive(target);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSend(activeItem.gif);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-1 pb-2">
        <div className="flex items-center rounded bg-bg-input">
          <input
            ref={inputRef}
            value={query}
            autoFocus
            maxLength={50}
            placeholder="GIPHY'de ara"
            aria-label="GIF ara"
            onChange={(e) => setGifQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-text-normal outline-none placeholder:text-text-faint"
          />
          {query ? (
            <button
              className="press-icon mr-1 rounded p-1 text-text-muted hover:text-text-head"
              aria-label="Aramayı temizle"
              onClick={() => {
                setGifQuery('');
                inputRef.current?.focus();
              }}
            >
              <X size={16} className="ico-rotate" />
            </button>
          ) : (
            <Search size={16} className="mr-2 text-text-muted" />
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="scroll-thin relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2"
        onScroll={onScroll}
      >
        {!query && !loading && results.length > 0 && (
          <div className="px-1 pb-2 text-xs font-bold text-text-muted uppercase">Popüler GIF'ler</div>
        )}
        {loading ? (
          <div className="flex gap-2" role="status" aria-label="GIF'ler yükleniyor">
            {[0, 1].map((c) => (
              <div key={c} className="flex flex-1 flex-col gap-2">
                {[120, 90, 150, 110].map((h, i) => (
                  <Skeleton key={i} className="rounded-md" style={{ height: c ? 250 - h : h }} />
                ))}
              </div>
            ))}
          </div>
        ) : error && results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-text-muted">
            <span>{error}</span>
            <button className="text-link hover:underline" onClick={retryGifs}>
              Tekrar dene
            </button>
          </div>
        ) : results.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-text-muted">
            {query ? `"${query.trim()}" için GIF bulunamadı.` : 'GIF bulunamadı.'}
          </div>
        ) : (
          <>
            <div className="relative" style={{ height }} role="listbox" aria-label="GIF'ler">
              {columns.flat().map((item) => {
                const src = previewSrc(item.gif);
                const selected = activeItem?.gif.id === item.gif.id;
                return (
                  <button
                    key={item.gif.id}
                    data-gif-id={item.gif.id}
                    role="option"
                    aria-selected={selected}
                    aria-label={item.gif.title || 'GIF'}
                    className={cn(
                      'anim-fade-in absolute overflow-hidden rounded-md bg-bg-hover outline-offset-2 transition-[filter,outline-color] duration-100 hover:brightness-110',
                      selected ? 'outline-2 outline-brand' : 'outline-2 outline-transparent',
                    )}
                    style={{ left: item.column * (columnWidth + GAP), top: item.top, width: columnWidth, height: item.height }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSend(item.gif)}
                  >
                    {src && <img src={src} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />}
                  </button>
                );
              })}
            </div>
            {hasMore && (
              <div className="flex justify-center py-3">
                <button
                  className="rounded px-3 py-1 text-sm text-text-muted hover:bg-bg-hover hover:text-text-head disabled:opacity-60"
                  disabled={loadingMore}
                  onClick={loadMoreGifs}
                >
                  {loadingMore ? 'Yükleniyor…' : 'Daha fazla'}
                </button>
              </div>
            )}
            {error && <div className="pb-3 text-center text-xs text-danger">{error}</div>}
          </>
        )}
      </div>

      {/* GIPHY'nin kullanım şartı: sonuçların yanında kaynak belirtilir */}
      <div className="flex items-center justify-end border-t border-edge px-3 py-1.5">
        <span className="text-[11px] font-bold tracking-wide text-text-muted">Powered by GIPHY</span>
      </div>
    </div>
  );
}
