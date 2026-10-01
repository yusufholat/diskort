import { useMemo } from 'react';
import { AudioLines, Lock } from 'lucide-react';
import { Permission, type Channel } from '@diskort/shared';
import { voice } from '../../features/voice/voiceClient';
import { membersOf, useCan, useGuild } from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { toast, useUi } from '../../stores/ui';

/** Ses kanalına bağlı değilken ana alan. */
export function Welcome() {
  const guild = useGuild((s) => s.guild);
  const allChannels = useGuild((s) => s.channels);
  const channels = useMemo(() => allChannels.filter((c) => c.type === 'voice'), [allChannels]);
  // Bu sunucunun çevrimiçi üyeleri
  const onlineCount = useGuild((s) => Object.keys(s.online).filter((id) => s.users[id]?.removed === false).length);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center bg-bg-main p-8 text-center">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-brand text-white">
        <AudioLines size={42} />
      </div>
      <h1 className="text-2xl font-bold text-text-head">{guild?.name}</h1>
      <p className="mt-2 text-text-muted">{onlineCount} kişi çevrimiçi. Konuşmaya başlamak için bir ses kanalına katıl.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {channels.map((c) => (
          <VoiceChannelCard key={c.id} channel={c} />
        ))}
      </div>
    </div>
  );
}

function VoiceChannelCard({ channel }: { channel: Channel }) {
  const voiceStates = useGuild((s) => s.voiceStates);
  const count = useMemo(() => membersOf(voiceStates, channel.id).length, [voiceStates, channel.id]);
  const canConnect = useCan(Permission.CONNECT, channel.id);
  return (
    <button
      onMouseEnter={() => canConnect && voice.prefetch(channel.id)}
      onClick={() => {
        if (!canConnect) {
          toast('Bu ses kanalına bağlanma iznin yok.', 'error');
          return;
        }
        void voice.join(channel.id);
        useUi.getState().setView({ kind: 'voice', channelId: channel.id });
      }}
      className={cn(
        'min-w-40 rounded-lg bg-bg-side px-5 py-4 text-left transition-colors hover:bg-bg-hover',
        !canConnect && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-1.5 font-semibold text-text-head">
        {!canConnect && <Lock size={14} aria-label="Bağlanma iznin yok" />}
        {channel.name}
      </div>
      <div className="text-sm text-text-muted">{count > 0 ? `${count} kişi içeride` : 'Boş'}</div>
    </button>
  );
}
