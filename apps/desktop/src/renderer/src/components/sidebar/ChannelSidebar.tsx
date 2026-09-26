import { ChevronDown, Plus } from 'lucide-react';
import type { ChannelType } from '@diskort/shared';
import { useMainView } from '../../lib/mainView';
import { useGuild, useSession } from '@diskort/client-core';
import { useUi } from '../../stores/ui';
import { TextChannelItem } from './TextChannelItem';
import { UserPanel } from './UserPanel';
import { VoiceChannelItem } from './VoiceChannelItem';
import { VoiceConnectionPanel } from './VoiceConnectionPanel';

export function ChannelSidebar() {
  const guild = useGuild((s) => s.guild);
  const channels = useGuild((s) => s.channels);
  const isAdmin = useSession((s) => s.user?.isAdmin ?? false);
  const openModal = useUi((s) => s.openModal);
  const openContextMenu = useUi((s) => s.openContextMenu);
  const view = useMainView();

  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-bg-side">
      <button
        className="flex h-12 shrink-0 items-center justify-between border-b border-black/30 px-4 font-semibold text-text-head shadow-sm transition-colors hover:bg-bg-hover"
        onClick={(e) => {
          if (!isAdmin) return;
          const rect = e.currentTarget.getBoundingClientRect();
          openContextMenu({
            x: rect.left + 8,
            y: rect.bottom + 4,
            items: [
              { label: 'Davet Oluştur', onClick: () => openModal({ type: 'settings', section: 'invites' }) },
              { label: 'Kanal Oluştur', onClick: () => openModal({ type: 'channel' }) },
            ],
          });
        }}
      >
        <span className="truncate">{guild?.name}</span>
        {isAdmin && <ChevronDown size={18} />}
      </button>

      <div className="flex-1 overflow-y-auto px-2 pt-4 pb-2">
        <SectionHeader title="Metin Kanalları" type="text" canCreate={isAdmin} />
        {textChannels.map((channel) => (
          <TextChannelItem
            key={channel.id}
            channel={channel}
            selected={view.kind === 'text' && view.channelId === channel.id}
          />
        ))}

        <div className="h-4" />
        <SectionHeader title="Ses Kanalları" type="voice" canCreate={isAdmin} />
        {voiceChannels.map((channel) => (
          <VoiceChannelItem key={channel.id} channel={channel} />
        ))}
      </div>

      <VoiceConnectionPanel />
      <UserPanel />
    </aside>
  );
}

function SectionHeader({ title, type, canCreate }: { title: string; type: ChannelType; canCreate: boolean }) {
  const openModal = useUi((s) => s.openModal);
  return (
    <div className="group mb-1 flex items-center justify-between pr-1 pl-1">
      <span className="text-xs font-bold tracking-wide text-text-muted uppercase group-hover:text-text-normal">
        {title}
      </span>
      {canCreate && (
        <button
          className="text-text-muted hover:text-text-head"
          title="Kanal Oluştur"
          onClick={() => openModal({ type: 'channel', channelType: type })}
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}
