import { useMemo } from 'react';
import { Volume2 } from 'lucide-react';
import type { Channel } from '@diskurt/shared';
import { voice } from '../../features/voice/voiceClient';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/utils';
import { membersOf, useGuild } from '../../stores/guild';
import { useSession } from '../../stores/session';
import { toast, useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { VoiceMemberRow } from './VoiceMemberRow';

export function VoiceChannelItem({ channel }: { channel: Channel }) {
  const voiceStates = useGuild((s) => s.voiceStates);
  const members = useMemo(() => membersOf(voiceStates, channel.id), [voiceStates, channel.id]);
  const activeChannel = useVoice((s) => s.channelId);
  const isAdmin = useSession((s) => s.user?.isAdmin ?? false);
  const openModal = useUi((s) => s.openModal);
  const openContextMenu = useUi((s) => s.openContextMenu);
  const isActive = activeChannel === channel.id;

  return (
    <div className="mb-0.5">
      <button
        className={cn(
          'group flex h-8 w-full items-center gap-1.5 rounded px-2 text-left transition-colors',
          isActive ? 'bg-bg-active text-text-head' : 'text-text-muted hover:bg-bg-hover hover:text-text-normal',
        )}
        onMouseEnter={() => voice.prefetch(channel.id)}
        onClick={() => void voice.join(channel.id)}
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
                  if (!window.confirm(`"${channel.name}" kanalı silinsin mi?`)) return;
                  api.deleteChannel(channel.id).catch((err) => toast(errorMessage(err), 'error'));
                },
              },
            ],
          });
        }}
      >
        <Volume2 size={20} className="shrink-0 opacity-80" />
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
