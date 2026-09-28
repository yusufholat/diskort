import { useMemo, type ReactNode } from 'react';
import { Eye, HeadphoneOff, Headphones, Mic, MicOff, Monitor, MonitorOff, PhoneOff, Volume2 } from 'lucide-react';
import { Permission, type VoiceState } from '@diskort/shared';
import { voice } from '../../features/voice/voiceClient';
import { memberMenuItems } from '../../lib/memberMenu';
import { usePresenceList, type PresenceEntry, type PresencePhase } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { channelById, membersOf, useCan, useGuild, useMemberColor, useSession } from '@diskort/client-core';
import { useSettings } from '../../stores/settings';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { Avatar } from '../ui/Avatar';
import { SwapIcon } from '../ui/SwapIcon';
import { LiveBadge, openVoiceProfile, VoiceStateIcons, WatchLiveBadge } from '../sidebar/VoiceMemberRow';
import { StreamView } from './StreamView';
import { StreamViewers } from './StreamViewers';

type Tile = { kind: 'user'; state: VoiceState } | { kind: 'stream'; userId: string };

/** Ses kanalına bağlıyken ana alan: katılımcı kutucukları, yayınlar ve arama kontrolleri. */
export function VoiceStage() {
  const channelId = useVoice((s) => s.channelId)!;
  const status = useVoice((s) => s.status);
  const channel = useGuild((s) => channelById(s, channelId));
  const voiceStates = useGuild((s) => s.voiceStates);
  const streams = useVoice((s) => s.streams);
  const watching = useVoice((s) => s.watching);
  const focused = useVoice((s) => s.focusedStream);
  const sharing = useVoice((s) => s.sharing);
  const selfId = useSession((s) => s.user?.id);

  const members = useMemo(() => membersOf(voiceStates, channelId), [voiceStates, channelId]);

  const tiles: Tile[] = useMemo(() => {
    const list: Tile[] = [];
    for (const m of members) {
      const streaming = m.userId === selfId ? sharing : Boolean(streams[m.userId]);
      if (streaming) list.push({ kind: 'stream', userId: m.userId });
      list.push({ kind: 'user', state: m });
    }
    return list;
  }, [members, streams, sharing, selfId]);

  const focusedVisible = focused && (watching[focused] || (focused === selfId && sharing)) ? focused : null;
  // Katılan kutucuk büyüyerek belirir, ayrılan küçülerek kaybolur
  const entries = usePresenceList(tiles, tileKey, 180);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-bg-deep">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4">
        <Volume2 size={22} className="text-text-muted" />
        <span className="font-semibold text-text-head">{channel?.name}</span>
        <span className="text-sm text-text-muted">· {members.length} kişi</span>
        {status !== 'connected' && (
          <span className="ml-2 text-sm text-warn">
            {status === 'reconnecting' ? 'Yeniden bağlanıyor…' : 'Bağlanıyor…'}
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 p-4">
        {focusedVisible ? (
          <div className="flex h-full flex-col gap-3">
            <div className="min-h-0 flex-1">
              <StreamView userId={focusedVisible} large />
            </div>
            <div className="flex h-28 shrink-0 gap-3 overflow-x-auto">
              {entries
                .filter(({ item: t }) => !(t.kind === 'stream' && t.userId === focusedVisible))
                .map(({ key, item: t, phase }) => (
                  <div key={key} className={cn('aspect-video h-full shrink-0', tileAnimation(phase))}>
                    <TileView tile={t} compact />
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <TileGrid entries={entries} />
        )}
      </div>

      <CallControls />
    </div>
  );
}

function tileKey(t: Tile): string {
  return t.kind === 'user' ? `u:${t.state.userId}` : `s:${t.userId}`;
}

function tileAnimation(phase: PresencePhase): string | undefined {
  return phase === 'enter' ? 'anim-tile-in' : phase === 'exit' ? 'anim-tile-out' : undefined;
}

function TileGrid({ entries }: { entries: PresenceEntry<Tile>[] }) {
  // Kapanmakta olanlar sütun sayısını etkilemesin
  const count = entries.filter((e) => e.phase !== 'exit').length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  return (
    <div
      className="grid h-full content-center gap-3"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {entries.map(({ key, item: t, phase }) => (
        <div key={key} className={cn('mx-auto aspect-video w-full max-w-[720px]', tileAnimation(phase))}>
          <TileView tile={t} />
        </div>
      ))}
    </div>
  );
}

function TileView({ tile, compact }: { tile: Tile; compact?: boolean }) {
  return tile.kind === 'user' ? (
    <ParticipantTile state={tile.state} compact={compact} />
  ) : (
    <StreamTile userId={tile.userId} compact={compact} />
  );
}

function tileCenter(el: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  return { left: x, right: x, top: y, bottom: y };
}

function ParticipantTile({ state, compact }: { state: VoiceState; compact?: boolean }) {
  const user = useGuild((s) => s.users[state.userId]);
  const color = useMemberColor(state.userId);
  const speaking = useVoice((s) => s.speaking[state.userId] === true);
  const selfId = useSession((s) => s.user?.id);
  const localMuted = useSettings((s) => s.localMutes[state.userId] === true);
  const openContextMenu = useUi((s) => s.openContextMenu);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${user?.displayName ?? 'Üye'} profili`}
      className={cn(
        'tile-ring relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg',
        speaking && 'tile-speaking',
      )}
      style={{ background: `color-mix(in srgb, ${user?.avatarColor ?? '#5865f2'} 35%, var(--color-bg-rail))` }}
      // Kutucuğa tıklamak profil kartını kutucuğun ortasının yanında açar (yeniden tıklamak kapatır)
      onClick={(e) => openVoiceProfile(state.userId, tileCenter(e.currentTarget))}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        openVoiceProfile(state.userId, tileCenter(e.currentTarget));
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const isSelf = state.userId === selfId;
        const items = memberMenuItems(state.userId);
        if (!isSelf || items.length > 0) {
          openContextMenu({ x: e.clientX, y: e.clientY, userId: isSelf ? undefined : state.userId, items });
        }
      }}
    >
      {/* Hareketli dekorasyon sahnede hafif çizilir: yalnızca konuşurken oynar */}
      <Avatar
        user={user}
        size={compact ? 44 : 80}
        speaking={speaking}
        decoration={user?.avatarDecoration}
        liteDecoration
      />
      <div className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1.5 rounded bg-black/50 px-2 py-0.5 text-sm text-white">
        <VoiceStateIcons state={state} localMuted={localMuted} size={14} />
        <span className="truncate" style={color ? { color } : undefined}>
          {user?.displayName}
        </span>
        {state.streaming && <WatchLiveBadge userId={state.userId} channelId={state.channelId} />}
      </div>
    </div>
  );
}

function StreamTile({ userId, compact }: { userId: string; compact?: boolean }) {
  const user = useGuild((s) => s.users[userId]);
  const selfId = useSession((s) => s.user?.id);
  const isWatching = useVoice((s) => s.watching[userId] === true);
  const isSelf = userId === selfId;

  if (isSelf || isWatching) {
    return <StreamView userId={userId} onClick={() => voice.focusStream(userId)} />;
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-lg bg-bg-rail">
      <div className="absolute top-2 left-2 flex items-center gap-2">
        <LiveBadge />
      </div>
      <StreamViewers userId={userId} className="absolute top-2 right-2" />
      {!compact && <div className="text-sm text-text-muted">{user?.displayName} ekranını paylaşıyor</div>}
      <button
        className="press flex items-center gap-2 rounded bg-control px-4 py-2 text-sm font-medium text-on-control hover:bg-control-hover"
        onClick={() => voice.watchStream(userId)}
      >
        <Eye size={16} className="ico-blink" /> Yayını İzle
      </button>
    </div>
  );
}

function CallControls() {
  const selfMute = useSettings((s) => s.selfMute);
  const selfDeaf = useSettings((s) => s.selfDeaf);
  const sharing = useVoice((s) => s.sharing);
  const connected = useVoice((s) => s.status === 'connected');
  const micAllowed = useVoice((s) => s.micAllowed);
  const channelId = useVoice((s) => s.channelId);
  const canStream = useCan(Permission.STREAM, channelId ?? undefined);
  const openModal = useUi((s) => s.openModal);
  const muted = selfMute || selfDeaf || !micAllowed;

  return (
    <div className="flex h-20 shrink-0 items-center justify-center gap-3">
      <RoundButton
        title={!micAllowed ? 'Konuşma iznin yok' : muted ? 'Sesi Aç' : 'Sustur'}
        danger={muted}
        motion="ico-nod"
        onClick={() => voice.toggleMute()}
      >
        {muted ? <MicOff size={22} /> : <Mic size={22} />}
      </RoundButton>
      <RoundButton
        title={selfDeaf ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}
        danger={selfDeaf}
        motion="ico-wiggle"
        onClick={() => voice.toggleDeafen()}
      >
        {selfDeaf ? <HeadphoneOff size={22} /> : <Headphones size={22} />}
      </RoundButton>
      <RoundButton
        title={sharing ? 'Yayını Durdur' : canStream ? 'Ekranını Paylaş' : 'Bu kanalda ekran paylaşma iznin yok'}
        active={sharing}
        disabled={!connected || (!sharing && !canStream)}
        motion="ico-lift"
        onClick={() => (sharing ? void voice.stopScreenShare() : openModal({ type: 'screenPicker' }))}
      >
        {sharing ? <MonitorOff size={22} /> : <Monitor size={22} />}
      </RoundButton>
      <RoundButton title="Bağlantıyı Kes" hangup motion="ico-hangup" onClick={() => void voice.leave()}>
        <PhoneOff size={22} />
      </RoundButton>
    </div>
  );
}

function RoundButton({
  title,
  onClick,
  children,
  danger,
  active,
  hangup,
  disabled,
  motion,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  active?: boolean;
  hangup?: boolean;
  disabled?: boolean;
  /** Üstüne gelince simgenin hareketi (styles/hover.css) */
  motion: string;
}) {
  return (
    <button
      data-tooltip={title}
      aria-label={title}
      aria-pressed={hangup ? undefined : Boolean(danger || active)}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'press-icon flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-40',
        hangup
          ? 'w-16 bg-danger text-white hover:bg-danger-hover'
          : danger
            ? 'bg-text-head text-bg-rail hover:opacity-85'
            : active
              ? 'bg-ok text-white hover:bg-ok-hover'
              : 'bg-bg-raised text-text-head hover:bg-bg-raised-hover',
      )}
    >
      {/* Simge değişince kısa bir dönüşle yenisine geçer */}
      <SwapIcon swapKey={title} motion={motion}>
        {children}
      </SwapIcon>
    </button>
  );
}
