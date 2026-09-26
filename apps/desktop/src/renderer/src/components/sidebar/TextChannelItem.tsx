import { Hash } from 'lucide-react';
import type { Channel } from '@diskort/shared';
import { useMessages, api, errorMessage, isUnread, useGuild, useSession } from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { toast, useUi } from '../../stores/ui';

export function TextChannelItem({ channel, selected }: { channel: Channel; selected: boolean }) {
  const unread = useGuild((s) => isUnread(s, channel.id));
  const mentionCount = useMessages((s) => s.mentionCounts[channel.id] ?? 0);
  const isAdmin = useSession((s) => s.user?.isAdmin ?? false);
  const setView = useUi((s) => s.setView);
  const openModal = useUi((s) => s.openModal);
  const openContextMenu = useUi((s) => s.openContextMenu);
  const highlight = unread && !selected;

  return (
    <div className="relative mb-0.5">
      {highlight && <span className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r bg-white" />}
      <button
        className={cn(
          'group flex h-8 w-full items-center gap-1.5 rounded px-2 text-left transition-colors',
          selected
            ? 'bg-bg-active text-text-head'
            : highlight
              ? 'text-text-head hover:bg-bg-hover'
              : 'text-text-muted hover:bg-bg-hover hover:text-text-normal',
        )}
        onClick={() => setView({ kind: 'text', channelId: channel.id })}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!isAdmin) return;
          openContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
              { label: 'Kanalı Düzenle', onClick: () => openModal({ type: 'channel', channel }) },
              {
                label: 'Kanalı Sil',
                danger: true,
                onClick: () => {
                  if (!window.confirm(`"#${channel.name}" kanalı ve tüm mesajları silinsin mi?`)) return;
                  api.deleteChannel(channel.id).catch((err) => toast(errorMessage(err), 'error'));
                },
              },
            ],
          });
        }}
      >
        <Hash size={20} className="shrink-0 opacity-80" />
        <span className={cn('min-w-0 flex-1 truncate', highlight ? 'font-semibold' : 'font-medium')}>
          {channel.name}
        </span>
        {mentionCount > 0 && !selected && (
          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white">
            {mentionCount > 99 ? '99+' : mentionCount}
          </span>
        )}
      </button>
    </div>
  );
}
