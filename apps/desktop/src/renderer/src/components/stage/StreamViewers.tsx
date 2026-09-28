import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Eye } from 'lucide-react';
import { useGuild, useMemberColor, useStreamViewers } from '@diskort/client-core';
import { useEscapeLayer } from '../../lib/escape';
import { usePresence } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { Avatar } from '../ui/Avatar';

/** Yığında gösterilen en fazla avatar; fazlası "+N" */
const STACK_MAX = 3;
/** Fare üstünden çıkınca listenin kapanmadan önce beklediği süre (listeye geçebilsin diye) */
const HOVER_CLOSE_MS = 150;
const GAP = 6;
const MARGIN = 8;

/**
 * Yayını izleyenler: üst üste binen küçük avatarlar ("+N") ve sayı. Üstüne gelince ya da tıklayınca
 * "İZLEYİCİLER — N" listesi açılır. İzleyen yoksa hiçbir şey çizilmez. Yayıncı kendisi sayılmaz.
 * `variant="panel"`: sol alttaki ses bağlantısı kartında ("N izleyici" yazısıyla, liste yukarı açılır).
 */
export function StreamViewers({
  userId,
  variant = 'overlay',
  className,
}: {
  userId: string;
  variant?: 'overlay' | 'panel';
  className?: string;
}) {
  const viewers = useStreamViewers(userId);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const open = (hover || pinned) && viewers.length > 0;

  const cancelClose = useCallback((): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const enter = (): void => {
    cancelClose();
    setHover(true);
  };
  const leave = (): void => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setHover(false), HOVER_CLOSE_MS);
  };
  useEffect(() => cancelClose, [cancelClose]);
  const close = useCallback((): void => {
    cancelClose();
    setHover(false);
    setPinned(false);
  }, [cancelClose]);
  useEscapeLayer(close, pinned);
  // İzleyiciler gidince sabitlenmiş liste de kapanır (yeniden gelince kendiliğinden açılmasın)
  const empty = viewers.length === 0;
  useEffect(() => {
    if (empty) setPinned(false);
  }, [empty]);

  if (viewers.length === 0) return null;
  const shown = viewers.slice(0, STACK_MAX);
  const extra = viewers.length - shown.length;
  const label = `${viewers.length} izleyici`;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={`İzleyiciler: ${viewers.length}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'press anim-pill-in pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-full transition-colors',
          variant === 'overlay'
            ? 'bg-black/60 py-0.5 pr-2 pl-1 text-white hover:bg-black/80'
            : 'bg-bg-active py-1 pr-2.5 pl-1.5 text-text-normal hover:bg-control hover:text-text-head',
          className,
        )}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((v) => !v);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <span className="flex items-center">
          {shown.map((id, i) => (
            <StackAvatar key={id} userId={id} first={i === 0} ring={variant === 'overlay' ? '#000' : undefined} />
          ))}
        </span>
        {extra > 0 && <span className="text-xs font-semibold">+{extra}</span>}
        {variant === 'panel' ? (
          <span className="text-xs font-medium">{label}</span>
        ) : (
          <span className="flex items-center gap-0.5 text-xs font-semibold tabular-nums">
            <Eye size={13} aria-hidden />
            {viewers.length}
          </span>
        )}
      </button>
      <ViewerList
        open={open}
        viewers={viewers}
        anchorRef={anchorRef}
        prefer={variant === 'panel' ? 'top' : 'bottom'}
        onEnter={enter}
        onLeave={leave}
        onClose={close}
      />
    </>
  );
}

function StackAvatar({ userId, first, ring }: { userId: string; first: boolean; ring?: string }) {
  const user = useGuild((s) => s.users[userId]);
  return (
    <span
      className={cn('rounded-full', !first && '-ml-1.5')}
      style={{ boxShadow: `0 0 0 2px ${ring ?? 'var(--color-bg-active)'}` }}
    >
      <Avatar user={user} size={18} />
    </span>
  );
}

function ViewerList({
  open,
  viewers,
  anchorRef,
  prefer,
  onEnter,
  onLeave,
  onClose,
}: {
  open: boolean;
  viewers: string[];
  anchorRef: RefObject<HTMLButtonElement | null>;
  prefer: 'top' | 'bottom';
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const { value: shown, closing } = usePresence(open ? viewers : null, 120);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const el = ref.current;
    if (!shown || !anchor || !el) return;
    const place = (): void => {
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = a.bottom + GAP;
      const above = a.top - GAP - h;
      const fitsBelow = below + h <= window.innerHeight - MARGIN;
      const fitsAbove = above >= MARGIN;
      const top = prefer === 'bottom' ? (fitsBelow || !fitsAbove ? below : above) : fitsAbove || !fitsBelow ? above : below;
      // Sağ kenara hizalı; ekrandan taşmasın
      const left = Math.min(Math.max(MARGIN, a.right - w), window.innerWidth - MARGIN - w);
      setPos({ left, top: Math.max(MARGIN, top) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [shown, anchorRef, prefer]);

  // Dışarı tıklayınca kapanır
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, anchorRef, onClose]);

  if (!shown) return null;
  // Tam ekrandaki yayında liste de tam ekran öğesinin içinde çizilmeli
  const host = document.fullscreenElement ?? document.body;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="İzleyiciler"
      className={cn(
        'fixed z-50 w-56 rounded-lg border border-edge bg-bg-float p-1.5 text-text-normal shadow-[0_8px_24px_rgb(0_0_0/0.45)]',
        closing ? 'anim-pop-out' : 'anim-pop-in',
      )}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="px-2 pt-1 pb-1.5 text-xs font-bold tracking-wide text-text-muted">
        İZLEYİCİLER — {shown.length}
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {shown.map((id) => (
          <ViewerRow key={id} userId={id} />
        ))}
      </ul>
    </div>,
    host,
  );
}

function ViewerRow({ userId }: { userId: string }) {
  const user = useGuild((s) => s.users[userId]);
  const color = useMemberColor(userId);
  return (
    <li className="flex items-center gap-2 rounded px-2 py-1.5">
      <Avatar user={user} size={24} />
      <span className="truncate text-sm font-medium text-text-head" style={color ? { color } : undefined}>
        {user?.displayName ?? 'Üye'}
      </span>
    </li>
  );
}
