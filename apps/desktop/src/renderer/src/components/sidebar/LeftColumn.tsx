import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { clampSidebarWidth, SIDEBAR_WIDTH, useSettings } from '../../stores/settings';
import { UserPanel } from './UserPanel';
import { VoiceConnectionPanel } from './VoiceConnectionPanel';

/**
 * Sunucu çubuğu ve kanal/konuşma listesi; altlarında, ikisinin üstüne binen yuvarlak kart (Discord'daki gibi):
 * ses bağlantısı (ses kanalındayken) ve kullanıcı paneli. Kartın yüksekliği `--footer-h` olarak verilir; listeler
 * alttan bu kadar boşluk bırakır ki son öğeler kartın altında kalmasın. Listenin genişliği (`--sidebar-w`) sağ
 * kenardaki çizgi sürüklenerek değiştirilir; çift tıklama varsayılana döndürür.
 */
export function LeftColumn({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const width = useSettings((s) => s.sidebarWidth);
  const drag = useRef<{ startX: number; startW: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const footer = footerRef.current;
    if (!root || !footer) return;
    const update = (): void => root.style.setProperty('--footer-h', `${footer.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  const setWidth = (w: number): void => useSettings.getState().set({ sidebarWidth: clampSidebarWidth(w) });

  // Sürüklerken yalnızca CSS değişkeni güncellenir (her piksel için ayar yazılmaz); bırakınca kaydedilir.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: width, w: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    d.w = clampSidebarWidth(d.startW + e.clientX - d.startX);
    rootRef.current?.style.setProperty('--sidebar-w', `${d.w}px`);
  };
  const endDrag = (): void => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setWidth(d.w);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') setWidth(width - step);
    else if (e.key === 'ArrowRight') setWidth(width + step);
    else if (e.key === 'Home') setWidth(SIDEBAR_WIDTH.min);
    else if (e.key === 'End') setWidth(SIDEBAR_WIDTH.max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 shrink-0"
      style={{ '--footer-h': '68px', '--sidebar-w': `${width}px` } as CSSProperties}
    >
      {children}
      <div ref={footerRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-2 pb-2">
        <div className="pointer-events-auto">
          <VoiceConnectionPanel />
          <UserPanel />
        </div>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Kanal listesinin genişliği"
        aria-valuemin={SIDEBAR_WIDTH.min}
        aria-valuemax={SIDEBAR_WIDTH.max}
        aria-valuenow={width}
        tabIndex={0}
        className="group absolute top-0 -right-1 bottom-0 z-30 w-2 cursor-col-resize outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={() => setWidth(SIDEBAR_WIDTH.default)}
        onKeyDown={onKeyDown}
      >
        <div className="mx-auto h-full w-0.5 bg-brand opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-100 group-active:opacity-100" />
      </div>
    </div>
  );
}
