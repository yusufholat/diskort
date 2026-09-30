import { useState, type ReactNode } from 'react';
import { Gamepad2, type LucideIcon } from 'lucide-react';
import type { Activity, ActivityType } from '@diskort/shared';
import {
  activityIconUrl,
  activityLabel,
  activityTitle,
  formatElapsed,
  sublineActivity,
  useActivity,
  useCustomStatus,
} from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { useNow } from '../sidebar/ElapsedTime';
import { CustomStatusLine } from './CustomStatusLine';

// Etkinlik (oynanan oyun) gösterimi: adın altındaki tek satır ve profil kartındaki "Oynuyor" kartı.
// Türe özgü olan yalnızca simgedir; başlık ACTIVITY_TYPE_LABELS'tan gelir (ileride müzik de aynı karta sığar).

const GLYPHS: Record<ActivityType, LucideIcon> = {
  game: Gamepad2,
};

/** Etkinliğin tek satırlık gösterimi: küçük simge ve ad (sığmazsa kırpılır; tamamı ipucunda) */
export function ActivityLine({ activity, className }: { activity: Activity; className?: string }) {
  const Glyph = GLYPHS[activity.type];
  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)} title={activityLabel(activity)}>
      <Glyph size={13} className="shrink-0" aria-hidden />
      <span className="truncate">{activity.name}</span>
    </div>
  );
}

/**
 * Adın altındaki satır (üye listesi, DM'ler): özel durum, yoksa etkinlik, o da yoksa `fallback`
 * (ör. "Sesli sohbette"). `userId` null ise yalnızca `fallback`.
 */
export function PresenceSubline({
  userId,
  className,
  fallback = null,
}: {
  userId: string | null | undefined;
  className?: string;
  fallback?: ReactNode;
}) {
  const custom = useCustomStatus(userId);
  const activity = sublineActivity(custom, useActivity(userId));
  if (custom) return <CustomStatusLine status={custom} className={className} />;
  if (activity) return <ActivityLine activity={activity} className={className} />;
  return fallback;
}

/** Etkinliğin ikonu; ikon yoksa ya da yüklenemezse türün simgesiyle düz bir karo */
function ActivityIcon({ activity, size }: { activity: Activity; size: number }) {
  const src = activityIconUrl(activity);
  // Yüklenemeyen ikonun yerine simge (adres değişince yeniden denenir)
  const [failed, setFailed] = useState<string | null>(null);
  const Glyph = GLYPHS[activity.type];
  const rounded = size >= 48 ? 'rounded-lg' : 'rounded-md';
  return src && failed !== src ? (
    <img
      src={src}
      alt=""
      draggable={false}
      width={size}
      height={size}
      className={cn('shrink-0 object-cover', rounded)}
      style={{ width: size, height: size }}
      onError={() => setFailed(src)}
    />
  ) : (
    <span
      className={cn('flex shrink-0 items-center justify-center bg-bg-active text-text-muted', rounded)}
      style={{ width: size, height: size }}
    >
      <Glyph size={Math.round(size * 0.55)} aria-hidden />
    </span>
  );
}

/**
 * "Oynuyor" kartı: başlık, ikon, ad ve canlı geçen süre. Zemini yoktur: konduğu yer verir (profil
 * kartında iç kutu, ses kanalındaki üyenin üstünde açılan küçük kart). `compact`: küçük ikon.
 */
export function ActivityCard({
  activity,
  compact = false,
  className,
}: {
  activity: Activity;
  compact?: boolean;
  className?: string;
}) {
  const now = useNow();
  const Glyph = GLYPHS[activity.type];
  return (
    <div className={className} aria-label={activityLabel(activity)}>
      <div className="mb-1.5 text-xs font-bold text-text-muted uppercase">{activityTitle(activity)}</div>
      <div className={cn('flex items-center', compact ? 'gap-2.5' : 'gap-3')}>
        <ActivityIcon activity={activity} size={compact ? 40 : 60} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-semibold text-text-head" title={activity.name}>
            {activity.name}
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs font-medium text-ok-text tabular-nums">
            <Glyph size={14} className="shrink-0" aria-hidden />
            <span aria-label="Geçen süre">{formatElapsed(now - activity.startedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
