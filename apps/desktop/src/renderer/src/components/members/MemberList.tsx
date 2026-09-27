import { memo, useMemo } from 'react';
import { Crown, MessageCircle } from 'lucide-react';
import type { User } from '@diskort/shared';
import { memberGroups, useGuild, useMemberColor, useSession } from '@diskort/client-core';
import { startDm } from '../../lib/dm';
import { memberMenuItems } from '../../lib/memberMenu';
import { cn } from '../../lib/utils';
import { useUi } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';

/** Metin kanalının sağındaki üye listesi: ayrı gösterilen rollere göre gruplar, çevrimiçi, çevrimdışı. */
export function MemberList() {
  const users = useGuild((s) => s.users);
  const roles = useGuild((s) => s.roles);
  const online = useGuild((s) => s.online);
  const guild = useGuild((s) => s.guild);
  const groups = useMemo(() => memberGroups({ users, roles, online, guild }), [users, roles, online, guild]);

  return (
    <aside className="w-60 shrink-0 overflow-y-auto bg-bg-side px-2 pb-4" aria-label="Üye listesi">
      {groups.map((group) => (
        <section key={group.id}>
          <h3 className="px-2 pt-6 pb-1 text-xs font-bold tracking-wide text-text-muted uppercase">
            {group.title} — {group.members.length}
          </h3>
          {group.members.map((user) => (
            <MemberRow key={user.id} user={user} offline={group.id === 'offline'} owner={user.id === guild?.ownerId} />
          ))}
        </section>
      ))}
    </aside>
  );
}

const MemberRow = memo(function MemberRow({ user, offline, owner }: { user: User; offline: boolean; owner: boolean }) {
  const color = useMemberColor(user.id);
  const selfId = useSession((s) => s.user?.id);
  const inVoice = useGuild((s) => Boolean(s.voiceStates[user.id]));
  const openContextMenu = useUi((s) => s.openContextMenu);
  const isSelf = user.id === selfId;

  return (
    <div
      className={cn(
        'group flex h-[42px] items-center gap-3 rounded px-2 hover:bg-bg-hover',
        offline && 'opacity-40 hover:opacity-100',
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        const items = memberMenuItems(user.id);
        // Başkasına sağ tıklayınca ses seviyesi de ayarlanabilir (seste olmasa da kaydedilir)
        if (!isSelf || items.length > 0) {
          openContextMenu({ x: e.clientX, y: e.clientY, userId: isSelf ? undefined : user.id, items });
        }
      }}
    >
      <Avatar user={user} size={32} online={!offline} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1">
          <span className="truncate font-medium text-text-normal" style={color ? { color } : undefined}>
            {user.displayName}
          </span>
          {owner && <Crown size={13} aria-label="Sunucunun sahibi" className="shrink-0 text-warn" />}
        </div>
        {inVoice && <div className="truncate text-xs text-text-muted">Sesli sohbette</div>}
      </div>
      {!isSelf && (
        <button
          className="press-icon invisible shrink-0 rounded p-1 text-text-muted group-hover:visible hover:text-text-head focus-visible:visible"
          data-tooltip="Mesaj gönder"
          aria-label={`${user.displayName} kişisine mesaj gönder`}
          onClick={() => void startDm(user.id)}
        >
          <MessageCircle size={18} />
        </button>
      )}
    </div>
  );
});
