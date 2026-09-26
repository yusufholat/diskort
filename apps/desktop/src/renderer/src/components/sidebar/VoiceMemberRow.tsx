import { HeadphoneOff, MicOff } from 'lucide-react';
import type { VoiceState } from '@diskurt/shared';
import { voice } from '../../features/voice/voiceClient';
import { cn } from '../../lib/utils';
import { useGuild } from '../../stores/guild';
import { useSession } from '../../stores/session';
import { useSettings } from '../../stores/settings';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { Avatar } from '../ui/Avatar';

export function LiveBadge({ className }: { className?: string }) {
  return (
    <span className={cn('rounded-full bg-danger px-1.5 py-px text-[10px] leading-4 font-bold text-white', className)}>
      CANLI
    </span>
  );
}

export function VoiceMemberRow({ state, inMyChannel }: { state: VoiceState; inMyChannel: boolean }) {
  const user = useGuild((s) => s.users[state.userId]);
  const speaking = useVoice((s) => inMyChannel && s.speaking[state.userId] === true);
  const localMuted = useSettings((s) => s.localMutes[state.userId] === true);
  const selfId = useSession((s) => s.user?.id);
  const openContextMenu = useUi((s) => s.openContextMenu);
  const isSelf = state.userId === selfId;

  return (
    <div
      className="group flex h-8 items-center gap-2 rounded px-2 text-text-muted hover:bg-bg-hover hover:text-text-normal"
      onContextMenu={(e) => {
        e.preventDefault();
        if (!isSelf) openContextMenu({ x: e.clientX, y: e.clientY, userId: state.userId });
      }}
      onDoubleClick={() => {
        if (inMyChannel && state.streaming && !isSelf) voice.watchStream(state.userId);
      }}
    >
      <Avatar user={user} size={24} speaking={speaking} />
      <span className={cn('flex-1 truncate text-sm', speaking && 'text-text-head')}>{user?.displayName ?? '…'}</span>
      {state.streaming && <LiveBadge />}
      {(state.selfMute || localMuted) && !state.selfDeaf && (
        <MicOff size={15} className={localMuted ? 'text-danger' : 'text-text-muted'} />
      )}
      {state.selfDeaf && <HeadphoneOff size={15} />}
    </div>
  );
}
