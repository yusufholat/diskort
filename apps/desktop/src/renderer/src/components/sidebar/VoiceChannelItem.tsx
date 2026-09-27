import { useMemo } from 'react';
import { Lock, Volume2 } from 'lucide-react';
import { Permission, type Channel } from '@diskort/shared';
import { voice } from '../../features/voice/voiceClient';
import { membersOf, useCan, useGuild } from '@diskort/client-core';
import { channelMenuItems, isPrivateChannel } from '../../lib/channelMenu';
import { cn } from '../../lib/utils';
import { toast, useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { VoiceMemberRow } from './VoiceMemberRow';

export function VoiceChannelItem({ channel }: { channel: Channel }) {
  const voiceStates = useGuild((s) => s.voiceStates);
  const members = useMemo(() => membersOf(voiceStates, channel.id), [voiceStates, channel.id]);
  const activeChannel = useVoice((s) => s.channelId);
  const canConnect = useCan(Permission.CONNECT, channel.id);
  const locked = useGuild((s) => isPrivateChannel(channel, s.guild?.id));
  const openContextMenu = useUi((s) => s.openContextMenu);
  const setView = useUi((s) => s.setView);
  const isActive = activeChannel === channel.id;

  return (
    <div className="mb-0.5">
      <button
        className={cn(
          'group flex h-8 w-full items-center gap-1.5 rounded px-2 text-left transition-colors',
          isActive ? 'bg-bg-active text-text-head' : 'text-text-muted hover:bg-bg-hover hover:text-text-normal',
          !canConnect && !isActive && 'opacity-60',
        )}
        onMouseEnter={() => canConnect && voice.prefetch(channel.id)}
        onClick={() => {
          if (!isActive) {
            if (!canConnect) {
              toast('Bu ses kanalına bağlanma iznin yok.', 'error');
              return;
            }
            void voice.join(channel.id);
          }
          setView({ kind: 'voice' });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const items = channelMenuItems(channel);
          if (items.length) openContextMenu({ x: e.clientX, y: e.clientY, items });
        }}
      >
        <span className="relative shrink-0 opacity-80">
          <Volume2 size={20} />
          {(locked || !canConnect) && (
            <Lock
              size={10}
              strokeWidth={3}
              aria-label={canConnect ? 'Özel kanal' : 'Bağlanma iznin yok'}
              className="absolute -top-0.5 -right-1 rounded-sm bg-bg-side"
            />
          )}
        </span>
        <span className="truncate font-medium">{channel.name}</span>
      </button>
      {members.length > 0 && (
        <div className="mt-0.5 mb-1 ml-6 flex flex-col gap-px">
          {members.map((m) => (
            <VoiceMemberRow key={m.userId} state={m} inMyChannel={isActive} />
          ))}
        </div>
      )}
    </div>
  );
}
