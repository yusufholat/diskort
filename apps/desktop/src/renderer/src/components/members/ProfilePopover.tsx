import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Crown, Eye, MessageCircle } from 'lucide-react';
import { create } from 'zustand';
import { userProfileEffect } from '@diskort/shared';
import {
  sortedRoles,
  useCustomStatus,
  useGuild,
  useSession,
  useStatus,
} from '@diskort/client-core';
import { startDm } from '../../lib/dm';
import { useEscapeLayer } from '../../lib/escape';
import { usePresence } from '../../lib/motion';
import { watchUserStream } from '../../lib/watchStream';
import { cn } from '../../lib/utils';
import {
  framedPadding,
  ProfileCardTop,
  ProfileEffectLayer,
  ProfileFrameLayer,
  StatusBubble,
  themedCardStyle,
  useProfileFramed,
} from '../profile/ProfileLook';

const MARGIN = 8;
const GAP = 8;

export interface ProfileAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ProfileTarget {
  userId: string;
  /** Kartın açıldığı kanal (yoksa null) */
  channelId: string | null;
  anchor: ProfileAnchor;
  /** Tercih edilen taraf: sohbetteki avatardan sağa, sağdaki üye listesinden sola açılır */
  side: 'right' | 'left';
}

const useProfilePopover = create<{ target: ProfileTarget | null }>(() => ({ target: null }));

/** Son kapanan kart: açan öğeye yeniden tıklamak (dışarı tıklama sayılıp kapatır) kartı yeniden açmasın */
let lastClosed: { key: string; at: number } | null = null;
const keyOf = (t: ProfileTarget): string => `${t.userId}:${Math.round(t.anchor.left)}:${Math.round(t.anchor.top)}`;

/** Üyenin profil kartını açıldığı öğenin yanında açar (Discord'daki "profil kartı"). */
export function openProfile(target: ProfileTarget): void {
  if (lastClosed && lastClosed.key === keyOf(target) && Date.now() - lastClosed.at < 400) return;
  useProfilePopover.setState({ target });
}

export function closeProfile(): void {
  const current = useProfilePopover.getState().target;
  if (!current) return;
  lastClosed = { key: keyOf(current), at: Date.now() };
  useProfilePopover.setState({ target: null });
}

/** Profil kartı: afiş, büyük avatar, ad, roller ve "Mesaj gönder". App'te bir kez çizilir. */
export function ProfilePopover() {
  const target = useProfilePopover((s) => s.target);
  const { value: shown, closing } = usePresence(target, 100);
  const user = useGuild((s) => (shown ? s.users[shown.userId] : undefined));
  const status = useStatus(shown?.userId);
  const custom = useCustomStatus(shown?.userId);
  const owner = useGuild((s) => (shown ? s.guild?.ownerId === shown.userId : false));
  const allRoles = useGuild((s) => s.roles);
  const selfId = useSession((s) => s.user?.id);
  // Yayın yapıyorsa kanalı (kartta "Yayını izle" düğmesi için)
  const streamChannel = useGuild((s) => {
    const v = shown ? s.voiceStates[shown.userId] : undefined;
    return v?.streaming ? v.channelId : null;
  });
  const framed = useProfileFramed(user?.profileFrame);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; origin: string } | null>(null);

  const roles = useMemo(
    () => (user ? sortedRoles({ roles: allRoles }).filter((r) => user.roles.includes(r.id)) : []),
    [user, allRoles],
  );

  // Tercih edilen tarafa sığmıyorsa öbür tarafa; dikeyde ekranın içinde kalır
  useLayoutEffect(() => {
    if (!target || !ref.current) return;
    const { offsetWidth: width, offsetHeight: height } = ref.current;
    const { anchor } = target;
    const right = anchor.right + GAP;
    const left = anchor.left - width - GAP;
    const fitsRight = right + width <= window.innerWidth - MARGIN;
    const fitsLeft = left >= MARGIN;
    const onRight = target.side === 'right' ? fitsRight || !fitsLeft : !fitsLeft && fitsRight;
    const x = Math.max(MARGIN, Math.min(onRight ? right : left, window.innerWidth - width - MARGIN));
    const y = Math.max(MARGIN, Math.min(anchor.top, window.innerHeight - height - MARGIN));
    setPos({ x, y, origin: `${onRight ? '0' : '100%'} ${Math.max(0, anchor.top - y)}px` });
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) closeProfile();
    };
    // Açan tıklamanın kendisi kartı hemen kapatmasın
    const timer = window.setTimeout(() => window.addEventListener('mousedown', onDown));
    window.addEventListener('blur', closeProfile);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', closeProfile);
    };
  }, [target]);
  useEscapeLayer(closeProfile, Boolean(target));

  // Üye bu arada ayrıldıysa kart kapanır
  useEffect(() => {
    if (target && !user) closeProfile();
  }, [target, user]);

  if (!shown || !user) return null;

  // Kendisi dışındaki üyeyle bire bir konuşmayı açar (yoksa oluşturur)
  const canMessage = user.id !== selfId;
  const message = (): void => {
    closeProfile();
    void startDm(user.id);
  };
  const watch = (): void => {
    closeProfile();
    if (streamChannel) void watchUserStream(user.id, streamChannel);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${user.displayName} profili`}
      className={cn(
        'fixed z-50 w-[300px] overflow-hidden rounded-lg border border-edge bg-bg-float shadow-[0_8px_24px_rgb(0_0_0/0.45)]',
        closing ? 'anim-pop-out pointer-events-none' : 'anim-pop-in',
      )}
      style={{
        ...(pos ? { left: pos.x, top: pos.y, transformOrigin: pos.origin } : { left: -9999, top: -9999 }),
        ...themedCardStyle(user.profileTheme),
        ...framedPadding(framed),
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ProfileCardTop
        user={user}
        status={status}
        bannerClassName={framed ? 'rounded-md' : undefined}
        aside={custom && <StatusBubble custom={custom} />}
        badge={owner && <Crown size={16} aria-label="Sunucunun sahibi" className="shrink-0 text-warn" />}
      />
      <div className="px-4 pb-4">
        {roles.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-bold text-text-muted uppercase">Roller</div>
            <div className="flex flex-wrap gap-1">
              {roles.map((role) => (
                <span
                  key={role.id}
                  className="flex items-center gap-1 rounded bg-bg-side px-1.5 py-0.5 text-xs text-text-normal"
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: role.color ?? '#99aab5' }} />
                  {role.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {streamChannel && !user.removed && (
          <button
            type="button"
            className="press mt-4 flex w-full items-center justify-center gap-1.5 rounded bg-danger px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-danger-hover"
            onClick={watch}
          >
            <Eye size={16} className="ico-blink" />
            {user.id === selfId ? 'Yayınını göster' : 'Yayını izle'}
          </button>
        )}
        {user.removed ? (
          <div className="mt-3 text-sm text-text-muted italic">Artık sunucuda değil.</div>
        ) : (
          canMessage && (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="press flex flex-1 items-center justify-center gap-1.5 rounded bg-brand px-3 py-2 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-brand-hover"
                onClick={message}
              >
                <MessageCircle size={16} className="ico-pop" />
                Mesaj gönder
              </button>
            </div>
          )
        )}
      </div>
      <ProfileEffectLayer effect={userProfileEffect(user)} />
      <ProfileFrameLayer frame={user.profileFrame} />
    </div>
  );
}
