import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Crown, MessageCircle } from 'lucide-react';
import { create } from 'zustand';
import { hasComposer, mentionInComposer, sortedRoles, useGuild, useSession } from '@diskort/client-core';
import { startDm } from '../../lib/dm';
import { useEscapeLayer } from '../../lib/escape';
import { usePresence } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { Avatar } from '../ui/Avatar';

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
  /** "Bahset" bu kanalın yazma kutusuna ekler */
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

/** Profil kartı: renkli şerit, büyük avatar, ad, roller ve "Bahset". App'te bir kez çizilir. */
export function ProfilePopover() {
  const target = useProfilePopover((s) => s.target);
  const { value: shown, closing } = usePresence(target, 100);
  const user = useGuild((s) => (shown ? s.users[shown.userId] : undefined));
  const online = useGuild((s) => (shown ? s.online[shown.userId] === true : false));
  const owner = useGuild((s) => (shown ? s.guild?.ownerId === shown.userId : false));
  const allRoles = useGuild((s) => s.roles);
  const selfId = useSession((s) => s.user?.id);
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

  const canMention = shown.channelId !== null && !user.removed && hasComposer(shown.channelId);
  const mention = (): void => {
    if (shown.channelId) mentionInComposer(shown.channelId, user.username);
    closeProfile();
  };
  // Kendisi dışındaki üyeyle bire bir konuşmayı açar (yoksa oluşturur)
  const canMessage = user.id !== selfId;
  const message = (): void => {
    closeProfile();
    void startDm(user.id);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${user.displayName} profili`}
      className={cn(
        'fixed z-50 w-[300px] overflow-hidden rounded-lg border border-black/30 bg-bg-float shadow-[0_8px_24px_rgb(0_0_0/0.45)]',
        closing ? 'anim-pop-out pointer-events-none' : 'anim-pop-in',
      )}
      style={pos ? { left: pos.x, top: pos.y, transformOrigin: pos.origin } : { left: -9999, top: -9999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="h-[60px]" style={{ background: user.avatarColor }} />
      <div className="px-4 pb-4">
        <div className="-mt-10 mb-2 w-fit rounded-full border-[6px] border-bg-float">
          <Avatar user={user} size={80} online={online} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xl leading-tight font-bold text-text-head">{user.displayName}</span>
          {owner && <Crown size={16} aria-label="Sunucunun sahibi" className="shrink-0 text-warn" />}
        </div>
        <div className="text-sm text-text-normal">{user.username}</div>

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

        {user.removed ? (
          <div className="mt-3 text-sm text-text-muted italic">Artık sunucuda değil.</div>
        ) : (
          (canMessage || canMention) && (
            <div className="mt-4 flex gap-2">
              {canMessage && (
                <button
                  type="button"
                  className="press flex flex-1 items-center justify-center gap-1.5 rounded bg-brand px-3 py-2 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-brand-hover"
                  onClick={message}
                >
                  <MessageCircle size={16} />
                  Mesaj gönder
                </button>
              )}
              {canMention && (
                <button
                  type="button"
                  className={cn(
                    'press flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                    canMessage
                      ? 'bg-bg-active text-text-head hover:bg-bg-hover'
                      : 'bg-brand text-white hover:bg-brand-hover',
                  )}
                  onClick={mention}
                >
                  <AtSign size={16} />
                  Bahset
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
