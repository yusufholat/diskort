import { HeadphoneOff, MicOff } from 'lucide-react';
import { Permission, type VoiceState } from '@diskort/shared';
import { voice } from '../../features/voice/voiceClient';
import { memberMenuItems } from '../../lib/memberMenu';
import { cn } from '../../lib/utils';
import { can, outranksUser, useGuild, useMemberColor, useSession, voiceDropTargets } from '@diskort/client-core';
import { currentView } from '../../lib/mainView';
import { startSidebarDrag, useSidebarDrag } from '../../lib/sidebarDrag';
import { watchUserStream } from '../../lib/watchStream';
import { useSettings } from '../../stores/settings';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { Avatar } from '../ui/Avatar';
import { openProfile, type ProfileAnchor } from '../members/ProfilePopover';

export function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn('anim-pill-in rounded-full bg-danger px-1.5 py-px text-[10px] leading-4 font-bold text-white', className)}
    >
      CANLI
    </span>
  );
}

/** Tıklanabilir "CANLI" rozeti: yayını doğrudan izlemeye başlar (gerekirse kanala katılır) */
export function WatchLiveBadge({ userId, channelId }: { userId: string; channelId: string }) {
  return (
    <button
      type="button"
      data-tooltip="Yayını izle"
      aria-label="Yayını izle"
      className="press shrink-0 rounded-full transition-[filter] hover:brightness-110"
      onClick={(e) => {
        e.stopPropagation();
        void watchUserStream(userId, channelId);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <LiveBadge className="block" />
    </button>
  );
}

/** Ses kanalındaki üyenin profil kartını açar */
export function openVoiceProfile(userId: string, anchor: ProfileAnchor, side: 'right' | 'left' = 'right'): void {
  const view = currentView();
  openProfile({ userId, channelId: view.kind === 'text' || view.kind === 'dm' ? view.channelId : null, anchor, side });
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
          className={cn('anim-pill-in', mutedByOthers ? 'text-danger' : 'text-text-muted')}
        />
      )}
      {deaf && (
        <HeadphoneOff
          size={size}
          aria-label={state.serverDeaf ? 'Sunucuda sağırlaştırıldı' : 'Sağırlaştırıldı'}
          className={cn('anim-pill-in', state.serverDeaf && 'text-danger')}
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
  // Sürüklenebilir: kendin (kanal değiştirme) ya da taşıma yetkin olan, senden aşağıdaki üye
  const draggable = useGuild(
    (s) => isSelf || (outranksUser(s, selfId, state.userId) && can(s, selfId, Permission.MOVE_MEMBERS, state.channelId)),
  );
  const dragging = useSidebarDrag((s) => s.item?.kind === 'member' && s.item.userId === state.userId && !s.ending);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${user?.displayName ?? 'Üye'} profili`}
      className={cn(
        'group flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-text-muted transition-[color,background-color,opacity] duration-150 select-none hover:bg-bg-hover hover:text-text-normal',
        dragging && 'opacity-40',
      )}
      onPointerDown={
        draggable
          ? (e) =>
              startSidebarDrag(e, () => {
                const targets = voiceDropTargets(state.userId);
                if (targets.size === 0) return null;
                return { kind: 'member', userId: state.userId, fromChannelId: state.channelId, targets };
              })
          : undefined
      }
      // Sürüklemeden sonra gelen tıklama sidebarDrag'de yutulur; kart yalnızca gerçek tıklamada açılır
      onClick={(e) => openVoiceProfile(state.userId, e.currentTarget.getBoundingClientRect())}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        openVoiceProfile(state.userId, e.currentTarget.getBoundingClientRect());
      }}
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
        className={cn('flex-1 truncate text-sm transition-colors duration-200', speaking && 'text-text-head')}
        style={color ? { color } : undefined}
      >
        {user?.displayName ?? '…'}
      </span>
      {state.streaming && <WatchLiveBadge userId={state.userId} channelId={state.channelId} />}
      <VoiceStateIcons state={state} localMuted={localMuted} />
    </div>
  );
}
