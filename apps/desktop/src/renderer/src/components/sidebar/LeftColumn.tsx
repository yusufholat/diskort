import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { UserPanel } from './UserPanel';
import { VoiceConnectionPanel } from './VoiceConnectionPanel';

/**
 * Sunucu çubuğu ve kanal/konuşma listesi; altlarında, ikisinin üstüne binen yuvarlak kart (Discord'daki gibi):
 * ses bağlantısı (ses kanalındayken) ve kullanıcı paneli. Kartın yüksekliği `--footer-h` olarak verilir; listeler
 * alttan bu kadar boşluk bırakır ki son öğeler kartın altında kalmasın.
 */
export function LeftColumn({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={rootRef} className="relative flex min-h-0 shrink-0" style={{ '--footer-h': '68px' } as CSSProperties}>
      {children}
      <div ref={footerRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-2 pb-2">
        <div className="pointer-events-auto">
          <VoiceConnectionPanel />
          <UserPanel />
        </div>
      </div>
    </div>
  );
}
