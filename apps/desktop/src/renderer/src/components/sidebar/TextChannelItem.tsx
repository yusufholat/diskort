import { Hash, Lock } from 'lucide-react';
import { Permission, type Channel } from '@diskort/shared';
import { useCan, useMessages, isUnread, useGuild } from '@diskort/client-core';
import { channelDropState, startSidebarDrag, useSidebarDrag } from '../../lib/sidebarDrag';
import { channelMenuItems, isPrivateChannel } from '../../lib/channelMenu';
import { cn } from '../../lib/utils';
import { useUi } from '../../stores/ui';

export function TextChannelItem({ channel, selected }: { channel: Channel; selected: boolean }) {
  const unread = useGuild((s) => isUnread(s, channel.id));
  const mentionCount = useMessages((s) => s.mentionCounts[channel.id] ?? 0);
  const locked = useGuild((s) => isPrivateChannel(channel, s.guild?.id));
  const setView = useUi((s) => s.setView);
  const openContextMenu = useUi((s) => s.openContextMenu);
  const highlight = unread && !selected;
  const order = useSidebarDrag((s) => channelDropState(s, channel.id));
  const canReorder = useCan(Permission.MANAGE_CHANNELS);

  return (
    <div
      className={cn('group/item relative mb-0.5 transition-opacity duration-150', order === 'source' && 'opacity-40')}
      data-drop-channel={channel.id}
      data-channel-type="text"
    >
      {(order === 'before' || order === 'after') && <DropLine after={order === 'after'} />}
      {/* Okunmamış işareti: belirirken büyür, üstüne gelince uzar */}
      {highlight && (
        <span className="anim-indicator-in absolute top-1/2 -left-2 h-2 w-1 origin-left -translate-y-1/2 rounded-r bg-white transition-[height] duration-150 group-hover/item:h-4" />
      )}
      <button
        className={cn(
          'group flex h-8 w-full items-center gap-1.5 rounded px-2 text-left transition-colors duration-150',
          selected
            ? 'bg-bg-active text-text-head'
            : highlight
              ? 'text-text-head hover:bg-bg-hover'
              : 'text-text-muted hover:bg-bg-hover hover:text-text-normal',
        )}
        onPointerDown={
          canReorder
            ? (e) => startSidebarDrag(e, () => ({ kind: 'channel', channelId: channel.id, channelType: 'text', name: channel.name }))
            : undefined
        }
        onClick={() => setView({ kind: 'text', channelId: channel.id })}
        onContextMenu={(e) => {
          e.preventDefault();
          const items = channelMenuItems(channel);
          if (items.length) openContextMenu({ x: e.clientX, y: e.clientY, items });
        }}
      >
        <span className="relative shrink-0 opacity-80">
          <Hash size={20} />
          {locked && (
            <Lock size={10} strokeWidth={3} aria-label="Özel kanal" className="absolute -top-0.5 -right-1 rounded-sm bg-bg-side" />
          )}
        </span>
        <span className={cn('min-w-0 flex-1 truncate', highlight ? 'font-semibold' : 'font-medium')}>
          {channel.name}
        </span>
        {mentionCount > 0 && !selected && (
          <span
            key={mentionCount}
            className="anim-pill-in flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white"
          >
            {mentionCount > 99 ? '99+' : mentionCount}
          </span>
        )}
      </button>
    </div>
  );
}

/** Sıralamada bırakılacak yeri gösteren çizgi (satırın üstünde ya da altında) */
export function DropLine({ after }: { after: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'anim-fade-in pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-brand',
        after ? '-bottom-px' : '-top-px',
      )}
    />
  );
}
