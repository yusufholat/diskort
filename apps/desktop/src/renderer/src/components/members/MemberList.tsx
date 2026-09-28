import { memo, useMemo } from 'react';
import { Crown, MessageCircle } from 'lucide-react';
import type { User } from '@diskort/shared';
import { memberGroups, useCustomStatus, useGuild, useMemberColor, useSession, useStatus } from '@diskort/client-core';
import { CustomStatusLine } from '../status/CustomStatusLine';
import { startDm } from '../../lib/dm';
import { currentView } from '../../lib/mainView';
import { memberMenuItems } from '../../lib/memberMenu';
import { cn } from '../../lib/utils';
import { useUi } from '../../stores/ui';
import { NameplateCanvas } from '../cosmetics/Cosmetics';
import { Avatar } from '../ui/Avatar';
import { openProfile } from './ProfilePopover';

/** Metin kanalının sağındaki üye listesi: ayrı gösterilen rollere göre gruplar, çevrimiçi, çevrimdışı. */
export function MemberList() {
  const users = useGuild((s) => s.users);
  const roles = useGuild((s) => s.roles);
  const online = useGuild((s) => s.online);
  const guild = useGuild((s) => s.guild);
  const groups = useMemo(() => memberGroups({ users, roles, online, guild }), [users, roles, online, guild]);

  return (
    <aside className="w-60 shrink-0 overflow-y-auto border-l border-divider bg-bg-side px-2 pb-4" aria-label="Üye listesi">
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
  const status = useStatus(user.id);
  const custom = useCustomStatus(user.id);
  const openContextMenu = useUi((s) => s.openContextMenu);
  const isSelf = user.id === selfId;
  // İsim plakası satırın arkasında oynar (yalnızca ekrandaki satırlar çizilir, bkz. cosmetics/engine.ts)
  const plate = user.nameplate ?? null;

  // Tıklayınca profil kartı listenin soluna açılır
  const showProfile = (el: HTMLElement): void => {
    const view = currentView();
    openProfile({
      userId: user.id,
      channelId: view.kind === 'text' || view.kind === 'dm' ? view.channelId : null,
      anchor: el.getBoundingClientRect(),
      side: 'left',
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${user.displayName} profili`}
      className={cn(
        'group flex h-[42px] cursor-pointer items-center gap-3 rounded px-2 hover:bg-bg-hover',
        plate && 'relative isolate overflow-hidden',
        offline && 'opacity-40 hover:opacity-100',
      )}
      onClick={(e) => showProfile(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        showProfile(e.currentTarget);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const items = memberMenuItems(user.id);
        // Başkasına sağ tıklayınca ses seviyesi de ayarlanabilir (seste olmasa da kaydedilir)
        if (!isSelf || items.length > 0) {
          openContextMenu({ x: e.clientX, y: e.clientY, userId: isSelf ? undefined : user.id, items });
        }
      }}
    >
      {plate && <NameplateCanvas set={plate} />}
      <Avatar
        user={user}
        size={32}
        status={status}
        ringClassName="bg-bg-side"
        ringColor={plate ? '#0a0a0a' : undefined}
        decoration={user.avatarDecoration}
      />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1">
          <span
            className={cn('truncate font-medium', plate ? 'nameplate-text' : 'text-text-normal')}
            style={color ? { color } : undefined}
          >
            {user.displayName}
          </span>
          {owner && <Crown size={13} aria-label="Sunucunun sahibi" className="shrink-0 text-warn" />}
        </div>
        {custom ? (
          <CustomStatusLine status={custom} className={cn('text-xs', plate ? 'nameplate-sub' : 'text-text-muted')} />
        ) : (
          inVoice && (
            <div className={cn('truncate text-xs', plate ? 'nameplate-sub' : 'text-text-muted')}>Sesli sohbette</div>
          )
        )}
      </div>
      {!isSelf && (
        <button
          className="press-icon invisible shrink-0 rounded p-1 text-text-muted group-hover:visible hover:text-text-head focus-visible:visible"
          data-tooltip="Mesaj gönder"
          aria-label={`${user.displayName} kişisine mesaj gönder`}
          onClick={(e) => {
            e.stopPropagation(); // satırın profil kartı açılmasın
            void startDm(user.id);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MessageCircle size={18} className="ico-pop" />
        </button>
      )}
    </div>
  );
});
