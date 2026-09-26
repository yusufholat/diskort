import type { ReactNode } from 'react';
import { Headphones, HeadphoneOff, Mic, MicOff, Settings } from 'lucide-react';
import { voice } from '../../features/voice/voiceClient';
import { cn } from '../../lib/utils';
import { useSession } from '../../stores/session';
import { useSettings } from '../../stores/settings';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { Avatar } from '../ui/Avatar';

export function UserPanel() {
  const user = useSession((s) => s.user);
  const selfMute = useSettings((s) => s.selfMute);
  const selfDeaf = useSettings((s) => s.selfDeaf);
  const inputMode = useSettings((s) => s.inputMode);
  const speaking = useVoice((s) => (user ? s.speaking[user.id] === true : false));
  const pttActive = useVoice((s) => s.pttActive);
  const openModal = useUi((s) => s.openModal);

  const muted = selfMute || selfDeaf;

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 bg-bg-panel px-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded py-1 pl-0.5">
        <Avatar user={user ?? undefined} size={32} speaking={speaking} online />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold text-text-head">{user?.displayName}</div>
          <div className="truncate text-xs text-text-muted">
            {inputMode === 'ptt' ? (pttActive ? 'Konuşuyor (bas-konuş)' : 'Bas-konuş') : `@${user?.username}`}
          </div>
        </div>
      </div>
      <PanelButton
        active={muted}
        title={muted ? 'Sesi Aç' : 'Sustur'}
        onClick={() => voice.toggleMute()}
        icon={muted ? <MicOff size={20} /> : <Mic size={20} />}
      />
      <PanelButton
        active={selfDeaf}
        title={selfDeaf ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}
        onClick={() => voice.toggleDeafen()}
        icon={selfDeaf ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
      />
      <PanelButton
        title="Kullanıcı Ayarları"
        onClick={() => openModal({ type: 'settings' })}
        icon={<Settings size={20} />}
      />
    </div>
  );
}

function PanelButton({
  icon,
  title,
  onClick,
  active,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-bg-hover',
        active ? 'text-danger' : 'text-text-normal hover:text-text-head',
      )}
    >
      {icon}
    </button>
  );
}
