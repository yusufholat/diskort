import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { isKnownActivity, type VoiceState } from '@diskort/shared';
import { useGuild } from '@diskort/client-core';
import { usePresence } from '../../lib/motion';
import { useSidebarDrag } from '../../lib/sidebarDrag';
import { cn } from '../../lib/utils';
import { ActivityCard, useKnownActivities } from '../status/ActivityCard';

/**
 * Ses kanalındaki üyenin üstünde biraz bekleyince sağında açılan küçük "Oynuyor" kartı ("Şimdi Yayın
 * Yapıyor" kartıyla aynı yer ve zamanlama; üye yayındaysa o kart açılır, bu açılmaz). Yalnızca bilgi
 * verir: tıklanacak bir şeyi yoktur, imleç satırdan çıkınca kapanır. Kaydırma, sürükleme ya da tıklama
 * da kapatır. Yalnızca asıl (en son başlanan) oyunu gösterir; başkaları da varsa başlığın yanında "+N".
 */

const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 150;
const GAP = 8;
const MARGIN = 8;

interface Anchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CardTarget {
  userId: string;
  channelId: string;
  anchor: Anchor;
}

/** Üye hâlâ o kanalda ve yayında değil (yayına geçince satır yayın kartını açar) */
function inChannel(state: VoiceState | undefined, channelId: string): boolean {
  return Boolean(state && state.channelId === channelId && !state.streaming);
}

const useActivityHover = create<{ target: CardTarget | null }>(() => ({ target: null }));

let openTimer = 0;
let closeTimer = 0;

function clearTimers(): void {
  window.clearTimeout(openTimer);
  window.clearTimeout(closeTimer);
}

export function closeActivityCard(): void {
  clearTimers();
  if (useActivityHover.getState().target) useActivityHover.setState({ target: null });
}

function scheduleClose(): void {
  clearTimers();
  closeTimer = window.setTimeout(closeActivityCard, CLOSE_DELAY_MS);
}

/**
 * Etkinliği olan üyenin satırına verilecek olaylar. Yalnızca fareyle; sürükleme sürerken açılmaz, satıra
 * basınca (tıklama → profil, sürükleme başlangıcı) hemen kapanır.
 */
export function activityCardHandlers({ userId, channelId }: Pick<VoiceState, 'userId' | 'channelId'>) {
  return {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse' || useSidebarDrag.getState().item) return;
      const el = e.currentTarget;
      clearTimers();
      const open = (): void => {
        if (!el.isConnected || useSidebarDrag.getState().item) return;
        // Beklerken değişmiş olabilir: üye hâlâ bu kanalda, yayında değil ve bir şey oynuyor olmalı
        const s = useGuild.getState();
        if (!inChannel(s.voiceStates[userId], channelId)) return;
        if (!s.presences[userId]?.activities?.some(isKnownActivity)) return;
        const r = el.getBoundingClientRect();
        useActivityHover.setState({
          target: { userId, channelId, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } },
        });
      };
      // Başka bir üyenin kartı zaten açıksa beklemeden geçer
      if (useActivityHover.getState().target) open();
      else openTimer = window.setTimeout(open, OPEN_DELAY_MS);
    },
    onPointerLeave: scheduleClose,
    onPointerDownCapture: closeActivityCard,
  };
}

/** App'te bir kez çizilir */
export function ActivityHoverCard() {
  const target = useActivityHover((s) => s.target);
  const { value: shown, closing } = usePresence(target, 100);
  const activities = useKnownActivities(shown?.userId);
  const activity = activities[0];
  const eligible = useGuild((s) => (shown ? inChannel(s.voiceStates[shown.userId], shown.channelId) : false));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!target || !ref.current) return;
    const { offsetWidth: width, offsetHeight: height } = ref.current;
    const { anchor } = target;
    const right = anchor.right + GAP;
    const maxX = window.innerWidth - width - MARGIN;
    const x = right <= maxX ? right : Math.max(MARGIN, Math.min(maxX, anchor.left - width - GAP));
    const y = Math.max(MARGIN, Math.min(anchor.top - 8, window.innerHeight - height - MARGIN));
    setPos({ x, y });
  }, [target]);

  // Kaydırma, sürükleme ya da pencereden çıkma kartı kapatır
  useEffect(() => {
    if (!target) return;
    document.addEventListener('wheel', closeActivityCard, { capture: true, passive: true });
    document.addEventListener('scroll', closeActivityCard, true);
    window.addEventListener('blur', closeActivityCard);
    const unsubscribe = useSidebarDrag.subscribe((s) => {
      if (s.item) closeActivityCard();
    });
    return () => {
      document.removeEventListener('wheel', closeActivityCard, { capture: true });
      document.removeEventListener('scroll', closeActivityCard, true);
      window.removeEventListener('blur', closeActivityCard);
      unsubscribe();
    };
  }, [target]);

  // Oyun bu arada kapandıysa, üye kanaldan çıktıysa (ya da taşındıysa) ya da yayına geçtiyse kart da kapanır
  useEffect(() => {
    if (target && (!activity || !eligible)) closeActivityCard();
  }, [target, activity, eligible]);

  if (!shown || !activity) return null;

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      data-tooltip-off=""
      className={cn(
        'pointer-events-none fixed z-50 w-[240px] rounded-lg border border-edge bg-bg-float p-3 shadow-[0_8px_24px_rgb(0_0_0/0.45)]',
        closing ? 'anim-pop-out' : 'anim-pop-in',
      )}
      style={pos ? { left: pos.x, top: pos.y, transformOrigin: '0 16px' } : { visibility: 'hidden', left: 0, top: 0 }}
    >
      <ActivityCard activity={activity} compact more={activities.length - 1} />
    </div>,
    document.body,
  );
}
