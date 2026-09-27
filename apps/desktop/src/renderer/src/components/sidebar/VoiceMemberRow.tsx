import { HeadphoneOff, MicOff } from 'lucide-react';
import { Permission, type VoiceState } from '@diskort/shared';
import { voice } from '../../features/voice/voiceClient';
import { memberMenuItems } from '../../lib/memberMenu';
import { cn } from '../../lib/utils';
import { can, useGuild, useMemberColor, useSession } from '@diskort/client-core';
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

/** Üyenin bulunduğu kanalda konuşma yetkisi yok (yalnızca dinliyor) */
export function useSuppressed(state: VoiceState): boolean {
  return useGuild((s) => !can(s, state.userId, Permission.SPEAK, state.channelId));
}

/**
 * Ses durumu simgeleri: kendi susturması gri; yerel susturma, sunucuda susturma/sağırlaştırma ve kanalda
 * konuşma yetkisi olmaması kırmızı (Discord gibi).
 */
export function VoiceStateIcons({ state, localMuted, size = 15 }: { state: VoiceState; localMuted?: boolean; size?: number }) {
  const suppressed = useSuppressed(state);
  const deaf = state.selfDeaf || state.serverDeaf;
  const mutedByOthers = state.serverMute || localMuted || suppressed;
  return (
    <>
      {(state.selfMute || mutedByOthers) && !deaf && (
        <MicOff
          size={size}
          aria-label={
            state.serverMute ? 'Sunucuda susturuldu' : suppressed ? 'Bu kanalda konuşma izni yok' : 'Susturuldu'
          }
          className={mutedByOthers ? 'text-danger' : 'text-text-muted'}
        />
      )}
      {deaf && (
        <HeadphoneOff
          size={size}
          aria-label={state.serverDeaf ? 'Sunucuda sağırlaştırıldı' : 'Sağırlaştırıldı'}
          className={state.serverDeaf ? 'text-danger' : undefined}
        />
      )}
    </>
  );
}

export function VoiceMemberRow({ state, inMyChannel }: { state: VoiceState; inMyChannel: boolean }) {
  const user = useGuild((s) => s.users[state.userId]);
  const color = useMemberColor(state.userId);
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
        const items = memberMenuItems(state.userId);
        if (!isSelf || items.length > 0) {
          openContextMenu({
            x: e.clientX,
            y: e.clientY,
            userId: isSelf ? undefined : state.userId,
            items,
          });
        }
      }}
      onDoubleClick={() => {
        if (inMyChannel && state.streaming && !isSelf) voice.watchStream(state.userId);
      }}
    >
      <Avatar user={user} size={24} speaking={speaking} />
      <span
        className={cn('flex-1 truncate text-sm', speaking && 'text-text-head')}
        style={color ? { color } : undefined}
      >
        {user?.displayName ?? '…'}
      </span>
      {state.streaming && <LiveBadge />}
      <VoiceStateIcons state={state} localMuted={localMuted} />
    </div>
  );
}
