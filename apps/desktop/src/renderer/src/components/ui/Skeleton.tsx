import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils';

/** Parlayan yer tutucu çubuk (styles/motion.css: .skeleton) */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={cn('skeleton rounded-full', className)} style={style} />;
}

// Her satırın genişliği farklı olsun ama her çizimde aynı kalsın
const WIDTHS = [
  [22, 64, 38],
  [16, 82],
  [28, 46, 70],
  [19, 58],
  [24, 90, 34],
  [14, 40],
  [26, 72, 52],
  [20, 66],
];

/** Mesaj geçmişi yüklenirken gösterilen, mesaj biçimli iskelet satırları. */
export function MessageSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col', className)} role="status" aria-label="Mesajlar yükleniyor">
      {Array.from({ length: rows }, (_, i) => {
        const [name, ...lines] = WIDTHS[i % WIDTHS.length]!;
        // Liste alttan dolduğu için üsttekiler (daha eski mesajlar) daha soluk
        return (
          <div key={i} className="mt-[17px] flex gap-4 pr-12 pl-4" style={{ opacity: 1 - (rows - 1 - i) * 0.1 }}>
            <Skeleton className="h-10 w-10 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
              <Skeleton className="h-3.5" style={{ width: `${name}%`, maxWidth: 180 }} />
              {lines.map((w, j) => (
                <Skeleton key={j} className="h-3" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
