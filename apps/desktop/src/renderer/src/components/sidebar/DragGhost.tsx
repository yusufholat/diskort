import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Hash, Volume2 } from 'lucide-react';
import { useGuild, useMemberColor } from '@diskort/client-core';
import { dragPointer, useSidebarDrag, type DragItem } from '../../lib/sidebarDrag';
import { Avatar } from '../ui/Avatar';

/** İmlecin hayalete göre konumu (hayalet imlecin sağ altında durur) */
const OFFSET_X = 14;
const OFFSET_Y = -16;

/**
 * Sürüklenen üyenin (avatar + ad) ya da kanalın hayaleti. Konum her işaretçi hareketinde doğrudan
 * stile yazılır; iptalde başladığı yere süzülerek, bırakınca küçülerek kaybolur.
 */
export function DragGhost() {
  const item = useSidebarDrag((s) => s.item);
  const ending = useSidebarDrag((s) => s.ending);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !item) return;
    const place = (): void => {
      el.style.transform = `translate3d(${dragPointer.x + OFFSET_X}px, ${dragPointer.y + OFFSET_Y}px, 0)`;
    };
    if (ending === 'cancel') {
      el.style.transition = 'transform 160ms var(--ease-out), opacity 160ms var(--ease-in)';
      el.style.transform = `translate3d(${dragPointer.startX + OFFSET_X}px, ${dragPointer.startY + OFFSET_Y}px, 0) scale(0.9)`;
      el.style.opacity = '0';
      return;
    }
    if (ending === 'drop') {
      el.style.transition = 'transform 140ms var(--ease-in), opacity 140ms var(--ease-in)';
      el.style.transform = `translate3d(${dragPointer.x + OFFSET_X}px, ${dragPointer.y + OFFSET_Y}px, 0) scale(0.6)`;
      el.style.opacity = '0';
      return;
    }
    el.style.transition = 'opacity 120ms var(--ease-out)';
    el.style.opacity = '1';
    place();
    dragPointer.listeners.add(place);
    return () => void dragPointer.listeners.delete(place);
  }, [item, ending]);

  if (!item) return null;
  return createPortal(
    <div ref={ref} className="pointer-events-none fixed top-0 left-0 z-[1000]" style={{ opacity: 0 }} aria-hidden>
      <div className="anim-pop-in flex max-w-56 items-center gap-2 rounded-md border border-edge bg-bg-float px-2 py-1.5 text-sm font-medium text-text-head shadow-xl">
        {item.kind === 'member' ? <MemberGhost item={item} /> : <ChannelGhost item={item} />}
      </div>
    </div>,
    document.body,
  );
}

function MemberGhost({ item }: { item: Extract<DragItem, { kind: 'member' }> }) {
  const user = useGuild((s) => s.users[item.userId]);
  const color = useMemberColor(item.userId);
  return (
    <>
      <Avatar user={user} size={24} />
      <span className="truncate" style={color ? { color } : undefined}>
        {user?.displayName ?? '…'}
      </span>
    </>
  );
}

function ChannelGhost({ item }: { item: Extract<DragItem, { kind: 'channel' }> }) {
  const Icon = item.channelType === 'voice' ? Volume2 : Hash;
  return (
    <>
      <Icon size={18} className="shrink-0 text-text-muted" />
      <span className="truncate">{item.name}</span>
    </>
  );
}
