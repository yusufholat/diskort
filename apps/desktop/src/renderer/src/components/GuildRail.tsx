import type { ReactNode } from 'react';
import { MessageSquareHeart, MessagesSquare } from 'lucide-react';
import type { DmChannel } from '@diskort/shared';
import {
  dmTitle,
  isUnread,
  useDmUnreadCount,
  useDmUnreadTotal,
  useGuild,
  useSession,
  useUnreadDms,
} from '@diskort/client-core';
import { isDmSection, openDmSection, openGuildSection, useMainView } from '../lib/mainView';
import { cn, initials } from '../lib/utils';
import { useUi } from '../stores/ui';
import { DmAvatar } from './dms/DmAvatar';

/**
 * Sol dikey çubuk: en üstte direkt mesajlar (okunmamış sayısıyla, altında okunmamış konuşmalar), sonra
 * topluluk (şimdilik tek; ileride çoklu sunucu için yer hazır).
 */
export function GuildRail() {
  const guild = useGuild((s) => s.guild);
  const openModal = useUi((s) => s.openModal);
  const view = useMainView();
  const inDms = isDmSection(view);
  const dmUnread = useDmUnreadTotal();
  const unreadDms = useUnreadDms(3);
  // Direkt mesajlardayken toplulukta okunmamış mesaj olduğu görünsün
  const guildUnread = useGuild((s) => s.channels.some((c) => c.type === 'text' && isUnread(s, c.id)));

  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-bg-rail py-3">
      <RailItem
        selected={inDms}
        unread={false}
        label="Direkt Mesajlar"
        badge={dmUnread}
        onClick={openDmSection}
      >
        <div
          className={cn(
            'flex h-12 w-12 items-center justify-center text-white transition-[border-radius,background-color] duration-150',
            inDms ? 'rounded-2xl bg-brand' : 'rounded-3xl bg-bg-side group-hover/rail:rounded-2xl group-hover/rail:bg-brand',
          )}
        >
          <MessagesSquare size={24} />
        </div>
      </RailItem>

      {unreadDms.map((dm) => (
        <UnreadDm key={dm.id} dm={dm} />
      ))}

      <div className="h-0.5 w-8 rounded bg-bg-hover" />

      <RailItem selected={!inDms} unread={guildUnread} label={guild?.name ?? ''} onClick={openGuildSection}>
        <div
          className={cn(
            'flex h-12 w-12 items-center justify-center bg-brand text-base font-semibold text-white transition-[border-radius] duration-150',
            inDms ? 'rounded-3xl group-hover/rail:rounded-2xl' : 'rounded-2xl',
          )}
        >
          {initials(guild?.name ?? 'D')}
        </div>
      </RailItem>
      {/* Geri bildirim: Discord'un "Sunucu ekle" düğmesi gibi, en altta */}
      <button
        className="press mt-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-3xl bg-bg-main text-ok transition-[border-radius,background-color,color] duration-200 hover:rounded-2xl hover:bg-ok hover:text-white"
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
    <div className="group/rail relative flex items-center">
      <span
        className={cn(
          'absolute -left-3 w-1 origin-left rounded-r bg-white transition-[height,opacity] duration-150',
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
