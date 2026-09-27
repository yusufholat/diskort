import { cn } from '../../lib/utils';

/** Yeni öğe sayısı (Discord'un kırmızı rozeti gibi; ör. yeni geri bildirimler) */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        'anim-pill-in ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 align-[1px] text-[11px] leading-none font-bold text-white',
        className,
      )}
      aria-label={`${count} yeni`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
