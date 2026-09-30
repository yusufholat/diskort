import { useMemo, useState, type ReactNode } from 'react';
import { Gamepad2, Shapes, Volume2, type LucideIcon } from 'lucide-react';
import { isKnownActivity, type Activity } from '@diskort/shared';
import {
  activityIconUrl,
  activityLabel,
  activityTitle,
  formatElapsed,
  presenceSubline,
  useActivities,
  useActivity,
  useCustomStatus,
} from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { useNow } from '../sidebar/ElapsedTime';
import { CustomStatusLine } from './CustomStatusLine';

// Etkinlik (oynanan oyun) gösterimi: adın altındaki satır (durum simgeleri ve yazı) ve profil kartındaki
// "Oynuyor" kartı. Türe özgü olan yalnızca simgedir; başlık ACTIVITY_TYPE_LABELS'tan gelir (ileride müzik de
// aynı karta sığar).

const GLYPHS: Partial<Record<string, LucideIcon>> = {
  game: Gamepad2,
};

/** Türün simgesi; simgesi tanımlanmamış tür genel bir simgeyle çizilir */
const glyphOf = (activity: Pick<Activity, 'type'>): LucideIcon => GLYPHS[activity.type] ?? Shapes;

/**
 * Adın altındaki satır (üye listesi, DM'ler): önce küçük durum simgeleri (oynuyorsa oyun, `voice` verildiyse
 * ses), sonra tek bir yazı: özel durum, yoksa oyunun adı, o da yoksa "Sesli sohbette". Hiçbiri yoksa
 * `fallback` (ör. kullanıcı adı). Simgelerin yalnızca ipucu vardır (oyunun adı, ses kanalı): tıklama satıra
 * geçer. Satırda sayaç yoktur. `userId` null ise yalnızca `fallback`.
 */
export function PresenceSubline({
  userId,
  voice,
  className,
  fallback = null,
}: {
  userId: string | null | undefined;
  /** Kişi sesteyse ses simgesinin ipucu ("Sesli sohbette: Kanal"); seste değilse ya da DM'de verilmez */
  voice?: string | null;
  className?: string;
  fallback?: ReactNode;
}) {
  const custom = useCustomStatus(userId);
  // Satırda yalnızca asıl (en son başlanan) oyun
  const activity = useActivity(userId);
  const { showGame, showVoice, text } = presenceSubline({ custom, activity, inVoice: Boolean(voice) });
  if (text === null) return fallback;
  const Glyph = activity ? glyphOf(activity) : null;
  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      {showGame && activity && Glyph && (
        <span className="flex shrink-0" data-tooltip={activityLabel(activity)} data-tooltip-side="bottom">
          <Glyph size={13} aria-hidden />
        </span>
      )}
      {showVoice && (
        <span className="flex shrink-0" data-tooltip={voice ?? undefined} data-tooltip-side="bottom">
          <Volume2 size={13} aria-hidden />
        </span>
      )}
      {text === 'custom' && custom ? (
        <CustomStatusLine status={custom} className="min-w-0" />
      ) : (
        <span className="truncate">{text === 'activity' ? activity?.name : 'Sesli sohbette'}</span>
      )}
    </div>
  );
}

/** Etkinliğin ikonu; ikon yoksa ya da yüklenemezse türün simgesiyle düz bir karo */
function ActivityIcon({ activity, size }: { activity: Activity; size: number }) {
  const src = activityIconUrl(activity);
  // Yüklenemeyen ikonun yerine simge (adres değişince yeniden denenir)
  const [failed, setFailed] = useState<string | null>(null);
  const Glyph = glyphOf(activity);
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
  more = 0,
  className,
}: {
  activity: Activity;
  compact?: boolean;
  /** Gösterilmeyen öbür etkinliklerin sayısı (başlığın yanında "+2") */
  more?: number;
  className?: string;
}) {
  const now = useNow();
  const Glyph = glyphOf(activity);
  return (
    <div className={className} aria-label={activityLabel(activity)}>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-bold text-text-muted">
        <span className="uppercase">{activityTitle(activity)}</span>
        {more > 0 && <span aria-label={`${more} etkinlik daha`}>+{more}</span>}
      </div>
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

/** Kişinin gösterilebilen etkinlikleri, en son başlayan ilk sırada */
export function useKnownActivities(userId: string | null | undefined): Activity[] {
  const all = useActivities(userId);
  return useMemo(() => all.filter(isKnownActivity), [all]);
}

/**
 * Profil kartındaki etkinlikler: her biri ayrı bir "Oynuyor" kartı, alt alta (asıl olan en üstte). Pencere
 * kısaysa kartlar kendi içinde kayar (profil kartı pencereden taşmasın). Etkinlik yoksa hiçbir şey çizmez.
 */
export function ActivityCards({ userId, className }: { userId: string | null | undefined; className?: string }) {
  const activities = useKnownActivities(userId);
  if (activities.length === 0) return null;
  return (
    <div className={cn('flex max-h-[max(120px,calc(100vh-440px))] flex-col gap-2 overflow-y-auto', className)}>
      {activities.map((activity, i) => (
        <ActivityCard
          key={`${activity.type}:${activity.name}:${activity.startedAt}`}
          activity={activity}
          // Asıl etkinlik büyük ikonla, öbürleri küçük
          compact={i > 0}
          className="shrink-0 rounded-lg bg-bg-side p-3"
        />
      ))}
    </div>
  );
}
