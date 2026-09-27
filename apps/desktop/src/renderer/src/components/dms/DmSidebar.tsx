import { memo } from 'react';
import { MessagesSquare, Plus, X } from 'lucide-react';
import type { DmChannel } from '@diskort/shared';
import {
  dmTitle,
  isUnread,
  useDmList,
  useDmUnreadCount,
  useGuild,
  useSession,
} from '@diskort/client-core';
import { closeOrLeaveDm, dmMenuItems } from '../../lib/dm';
import { useMainView } from '../../lib/mainView';
import { cn } from '../../lib/utils';
import { useUi } from '../../stores/ui';
import { UserPanel } from '../sidebar/UserPanel';
import { VoiceConnectionPanel } from '../sidebar/VoiceConnectionPanel';
import { formatAgo, formatFull } from '../text/format';
import { DmAvatar } from './DmAvatar';

/** Direkt mesajlar bölümünün sol çubuğu: konuşmalar, son etkinliğe göre. */
export function DmSidebar() {
  const dms = useDmList();
  const view = useMainView();
  const openModal = useUi((s) => s.openModal);
  const setView = useUi((s) => s.setView);

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-bg-side">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-2 shadow-sm">
        <button
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left font-semibold transition-colors',
            view.kind === 'dms' ? 'bg-bg-active text-text-head' : 'text-text-muted hover:bg-bg-hover hover:text-text-normal',
          )}
          onClick={() => setView({ kind: 'dms' })}
        >
          <MessagesSquare size={18} className="shrink-0" />
          <span className="truncate">Direkt Mesajlar</span>
        </button>
        <button
          className="press-icon rounded p-1 text-text-muted hover:text-text-head"
          data-tooltip="Yeni Mesaj"
          aria-label="Yeni Mesaj"
          onClick={() => openModal({ type: 'newDm' })}
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pt-3 pb-2">
        <div className="mb-1 px-2 text-xs font-bold tracking-wide text-text-muted uppercase">Konuşmalar</div>
        {dms.length === 0 ? (
          <p className="anim-fade-in px-2 pt-2 text-sm leading-snug text-text-muted">
            Henüz bir konuşman yok. Üye listesinde birine sağ tıklayıp <strong className="text-text-normal">Mesaj Gönder</strong>
            'i seç ya da yukarıdaki + ile başlat.
          </p>
        ) : (
          dms.map((dm) => <DmRow key={dm.id} dm={dm} selected={view.kind === 'dm' && view.channelId === dm.id} />)
        )}
      </div>

      <VoiceConnectionPanel />
      <UserPanel />
    </aside>
  );
}

const DmRow = memo(function DmRow({ dm, selected }: { dm: DmChannel; selected: boolean }) {
  const selfId = useSession((s) => s.user?.id);
  const title = useGuild((s) => dmTitle(dm, s.users, selfId));
  const unread = useGuild((s) => isUnread(s, dm.id));
  const count = useDmUnreadCount(dm.id);
  const setView = useUi((s) => s.setView);
  const openContextMenu = useUi((s) => s.openContextMenu);
  const highlight = unread && !selected;

  return (
    <div className="group/item relative mb-0.5">
      {highlight && (
        <span className="anim-indicator-in absolute top-1/2 -left-2 h-2 w-1 origin-left -translate-y-1/2 rounded-r bg-white" />
      )}
      <button
        className={cn(
          'flex h-[42px] w-full items-center gap-3 rounded px-2 text-left transition-colors duration-150',
          selected
            ? 'bg-bg-active text-text-head'
            : highlight
              ? 'text-text-head hover:bg-bg-hover'
              : 'text-text-muted hover:bg-bg-hover hover:text-text-normal',
        )}
        onClick={() => setView({ kind: 'dm', channelId: dm.id })}
        onContextMenu={(e) => {
          e.preventDefault();
          openContextMenu({ x: e.clientX, y: e.clientY, items: dmMenuItems(dm) });
        }}
      >
        <DmAvatar dm={dm} size={32} status />
        <span className="min-w-0 flex-1 leading-tight">
          <span className={cn('block truncate', highlight ? 'font-semibold' : 'font-medium')}>{title}</span>
          {dm.group && (
            <span className="block truncate text-xs text-text-muted">{dm.participantIds.length} üye</span>
          )}
        </span>
        {count > 0 && !selected ? (
          <span
            key={count}
            className="anim-pill-in flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white group-hover/item:invisible"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : (
          <span
            className="shrink-0 text-[11px] text-text-faint group-hover/item:invisible"
            data-tooltip={formatFull(dm.lastActivityAt)}
          >
            {formatAgo(dm.lastActivityAt)}
          </span>
        )}
      </button>
      {/* Üstüne gelince: bire bir konuşmayı kapat, gruptan ayrıl */}
      <button
        className="press-icon invisible absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-text-muted group-hover/item:visible hover:text-text-head"
        data-tooltip={dm.group ? 'Gruptan ayrıl' : 'Konuşmayı kapat'}
        aria-label={dm.group ? 'Gruptan ayrıl' : 'Konuşmayı kapat'}
        onClick={() => void closeOrLeaveDm(dm)}
      >
        <X size={16} />
      </button>
    </div>
  );
});
