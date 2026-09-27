import { memo } from 'react';
import { Crown } from 'lucide-react';
import type { DmChannel } from '@diskort/shared';
import { useGuild, useMemberColor, useSession } from '@diskort/client-core';
import { memberMenuItems } from '../../lib/memberMenu';
import { cn } from '../../lib/utils';
import { useUi } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';

/** Konuşmanın sağındaki katılımcı listesi (metin kanalındaki üye listesinin karşılığı) */
export function DmMembers({ dm }: { dm: DmChannel }) {
  return (
    <aside className="w-60 shrink-0 overflow-y-auto bg-bg-side px-2 pb-4" aria-label="Konuşmadakiler">
      <h3 className="px-2 pt-6 pb-1 text-xs font-bold tracking-wide text-text-muted uppercase">
        Konuşmadakiler — {dm.participantIds.length}
      </h3>
      {dm.participantIds.map((id) => (
        <Participant key={id} userId={id} owner={dm.group && dm.ownerId === id} />
      ))}
    </aside>
  );
}

const Participant = memo(function Participant({ userId, owner }: { userId: string; owner: boolean }) {
  const user = useGuild((s) => s.users[userId]);
  const online = useGuild((s) => Boolean(s.online[userId]));
  // Ortak sunucusu kalmayan (ya da seçili olmayan sunucudan tanınan) kişi
  const reachable = useGuild((s) => Boolean(s.reachable[userId]));
  const color = useMemberColor(userId);
  const selfId = useSession((s) => s.user?.id);
  const openContextMenu = useUi((s) => s.openContextMenu);
  if (!user) return null;
  const isSelf = userId === selfId;

  return (
    <div
      className={cn(
        'flex h-[42px] items-center gap-3 rounded px-2 hover:bg-bg-hover',
        (!online || !reachable) && 'opacity-40 hover:opacity-100',
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        const items = memberMenuItems(userId);
        if (!isSelf || items.length > 0) {
          openContextMenu({ x: e.clientX, y: e.clientY, userId: isSelf ? undefined : userId, items });
        }
      }}
    >
      <Avatar user={user} size={32} online={reachable || isSelf ? online : undefined} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1">
          <span className="truncate font-medium text-text-normal" style={color ? { color } : undefined}>
            {user.displayName}
          </span>
          {owner && <Crown size={13} aria-label="Grubun sahibi" className="shrink-0 text-warn" />}
        </div>
        {!reachable && !isSelf && <div className="truncate text-xs text-text-muted">Ortak sunucunuz yok</div>}
      </div>
    </div>
  );
});
