import { useMemo } from 'react';
import { AudioLines } from 'lucide-react';
import { voice } from '../../features/voice/voiceClient';
import { membersOf, useGuild } from '../../stores/guild';
import { useUi } from '../../stores/ui';

/** Ses kanalına bağlı değilken ana alan. */
export function Welcome() {
  const guild = useGuild((s) => s.guild);
  const allChannels = useGuild((s) => s.channels);
  const channels = useMemo(() => allChannels.filter((c) => c.type === 'voice'), [allChannels]);
  const voiceStates = useGuild((s) => s.voiceStates);
  const onlineCount = useGuild((s) => Object.keys(s.online).length);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center bg-bg-main p-8 text-center">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-brand text-white">
        <AudioLines size={42} />
      </div>
      <h1 className="text-2xl font-bold text-text-head">{guild?.name}</h1>
      <p className="mt-2 text-text-muted">{onlineCount} kişi çevrimiçi. Konuşmaya başlamak için bir ses kanalına katıl.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {channels.map((c) => {
          const count = membersOf(voiceStates, c.id).length;
          return (
            <button
              key={c.id}
              onMouseEnter={() => voice.prefetch(c.id)}
              onClick={() => {
                void voice.join(c.id);
                useUi.getState().setView({ kind: 'voice' });
              }}
              className="min-w-40 rounded-lg bg-bg-side px-5 py-4 text-left transition-colors hover:bg-bg-hover"
            >
              <div className="font-semibold text-text-head">{c.name}</div>
              <div className="text-sm text-text-muted">{count > 0 ? `${count} kişi içeride` : 'Boş'}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
