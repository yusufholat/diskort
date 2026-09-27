import type { ReactNode } from 'react';
import { MessageSquareHeart, MessagesSquare, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { DmChannel, Guild } from '@diskort/shared';
import {
  dmTitle,
  useDmUnreadCount,
  useDmUnreadTotal,
  useGuild,
  useGuildList,
  useGuildUnread,
  useMessages,
  useSession,
  useUnreadDms,
} from '@diskort/client-core';
import { isDmSection, openDmSection, openGuildSection, useMainView } from '../lib/mainView';
import { cn } from '../lib/utils';
import { useUi } from '../stores/ui';
import { DmAvatar } from './dms/DmAvatar';
import { GuildIcon } from './ui/GuildIcon';

/**
 * Sol dikey çubuk (Discord gibi): en üstte direkt mesajlar (okunmamış sayısıyla, altında okunmamış
 * konuşmalar), sonra üye olunan sunucular, en altta sunucu ekleme ve geri bildirim.
 */
export function GuildRail() {
  const guilds = useGuildList();
  const openModal = useUi((s) => s.openModal);
  const view = useMainView();
  const inDms = isDmSection(view);
  const dmUnread = useDmUnreadTotal();
  const unreadDms = useUnreadDms(3);

  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-bg-rail py-3 [scrollbar-width:none]">
      <RailItem
        selected={inDms}
        unread={false}
        label="Direkt Mesajlar"
        badge={dmUnread}
        onClick={openDmSection}
      >
        <div
          className={cn(
            'flex h-12 w-12 items-center justify-center transition-[border-radius,background-color,color] duration-150',
            inDms
              ? 'rounded-2xl bg-brand text-white'
              : 'rounded-3xl bg-bg-raised text-text-normal group-hover/rail:rounded-2xl group-hover/rail:bg-brand group-hover/rail:text-white',
          )}
        >
          <MessagesSquare size={24} />
        </div>
      </RailItem>

      {unreadDms.map((dm) => (
        <UnreadDm key={dm.id} dm={dm} />
      ))}

      <div className="h-0.5 w-8 shrink-0 rounded bg-bg-hover" />

      {guilds.map((guild) => (
        <GuildItem key={guild.id} guild={guild} inDms={inDms} />
      ))}

      <button
        className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-3xl bg-bg-raised text-ok transition-[border-radius,background-color,color] duration-200 hover:rounded-2xl hover:bg-ok hover:text-white"
        data-tooltip="Sunucu ekle"
        data-tooltip-side="right"
        aria-label="Sunucu ekle"
        onClick={() => openModal({ type: 'addGuild' })}
      >
        <Plus size={24} />
      </button>

      {/* Geri bildirim: en altta */}
      <button
        className="press mt-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-3xl bg-bg-raised text-ok transition-[border-radius,background-color,color] duration-200 hover:rounded-2xl hover:bg-ok hover:text-white"
        data-tooltip="Geri bildirim gönder"
        data-tooltip-side="right"
        aria-label="Geri bildirim gönder"
        onClick={() => openModal({ type: 'feedback' })}
      >
        <MessageSquareHeart size={22} />
      </button>
    </nav>
  );
}

/** Sunucu: simgesi, seçiliyse uzun işaret, okunmamış mesajı varsa kısa işaret, bahsetme sayısı */
function GuildItem({ guild, inDms }: { guild: Guild; inDms: boolean }) {
  const selected = useGuild((s) => !inDms && s.activeGuildId === guild.id);
  const unread = useGuildUnread(guild.id);
  // Sunucunun kanallarındaki okunmamış bahsetmeler
  const channelIds = useGuild(useShallow((s) => s.guilds[guild.id]?.channels.map((c) => c.id) ?? []));
  const mentions = useMessages((s) => channelIds.reduce((n, id) => n + (s.mentionCounts[id] ?? 0), 0));
  return (
    <RailItem selected={selected} unread={unread} label={guild.name} badge={mentions} onClick={() => openGuildSection(guild.id)}>
      <GuildIcon
        guild={guild}
        size={48}
        className={cn(
          'transition-[border-radius] duration-150',
          selected ? 'rounded-2xl' : 'rounded-3xl group-hover/rail:rounded-2xl',
        )}
      />
    </RailItem>
  );
}

/** Okunmamış mesajı olan konuşma: profil fotoğrafı ve okunmamış sayısı */
function UnreadDm({ dm }: { dm: DmChannel }) {
  const selfId = useSession((s) => s.user?.id);
  const title = useGuild((s) => dmTitle(dm, s.users, selfId));
  const count = useDmUnreadCount(dm.id);
  return (
    <div className="anim-pop-in">
      <RailItem
        selected={false}
        unread
        label={title}
        badge={count}
        onClick={() => useUi.getState().setView({ kind: 'dm', channelId: dm.id })}
      >
        <DmAvatar dm={dm} size={48} />
      </RailItem>
    </div>
  );
}

/** Çubuktaki öğe: seçiliyse soldaki uzun işaret, okunmamışsa kısa işaret, sağ altta kırmızı sayı */
function RailItem({
  selected,
  unread,
  label,
  badge = 0,
  onClick,
  children,
}: {
  selected: boolean;
  unread: boolean;
  label: string;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group/rail relative flex shrink-0 items-center">
      <span
        className={cn(
          'absolute -left-3 w-1 origin-left rounded-r bg-text-head transition-[height,opacity] duration-150',
          selected ? 'h-10 opacity-100' : unread ? 'h-2 opacity-100 group-hover/rail:h-5' : 'h-5 opacity-0 group-hover/rail:opacity-100',
        )}
      />
      <button
        className="press relative rounded-2xl"
        data-tooltip={label}
        data-tooltip-side="right"
        aria-label={badge > 0 ? `${label}, ${badge} okunmamış mesaj` : label}
        aria-current={selected ? 'page' : undefined}
        onClick={onClick}
      >
        {children}
        {badge > 0 && (
          <span
            key={badge}
            className="anim-pill-in absolute -right-1 -bottom-1 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border-[3px] border-bg-rail bg-danger px-1 text-[11px] font-bold text-white"
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    </div>
  );
}
