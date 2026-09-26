import { useMemo, type ReactNode } from 'react';
import { Eye, HeadphoneOff, Headphones, Mic, MicOff, Monitor, MonitorOff, PhoneOff, Volume2 } from 'lucide-react';
import type { VoiceState } from '@diskort/shared';
import { voice } from '../../features/voice/voiceClient';
import { cn } from '../../lib/utils';
import { membersOf, useGuild } from '../../stores/guild';
import { useSession } from '../../stores/session';
import { useSettings } from '../../stores/settings';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { Avatar } from '../ui/Avatar';
import { LiveBadge } from '../sidebar/VoiceMemberRow';
import { StreamView } from './StreamView';

type Tile = { kind: 'user'; state: VoiceState } | { kind: 'stream'; userId: string };

/** Ses kanalına bağlıyken ana alan: katılımcı kutucukları, yayınlar ve arama kontrolleri. */
export function VoiceStage() {
  const channelId = useVoice((s) => s.channelId)!;
  const status = useVoice((s) => s.status);
  const channel = useGuild((s) => s.channels.find((c) => c.id === channelId));
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

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-bg-deep">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/40 px-4">
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
              {tiles
                .filter((t) => !(t.kind === 'stream' && t.userId === focusedVisible))
                .map((t) => (
                  <div key={tileKey(t)} className="aspect-video h-full shrink-0">
                    <TileView tile={t} compact />
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <TileGrid tiles={tiles} />
        )}
      </div>

      <CallControls />
    </div>
  );
}

function tileKey(t: Tile): string {
  return t.kind === 'user' ? `u:${t.state.userId}` : `s:${t.userId}`;
}

function TileGrid({ tiles }: { tiles: Tile[] }) {
  const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : tiles.length <= 9 ? 3 : 4;
  return (
    <div
      className="grid h-full content-center gap-3"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {tiles.map((t) => (
        <div key={tileKey(t)} className="mx-auto aspect-video w-full max-w-[720px]">
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

function ParticipantTile({ state, compact }: { state: VoiceState; compact?: boolean }) {
  const user = useGuild((s) => s.users[state.userId]);
  const speaking = useVoice((s) => s.speaking[state.userId] === true);
  const selfId = useSession((s) => s.user?.id);
  const localMuted = useSettings((s) => s.localMutes[state.userId] === true);
  const openContextMenu = useUi((s) => s.openContextMenu);

  return (
    <div
      className={cn(
        'relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg transition-shadow duration-75',
        speaking && 'tile-speaking',
      )}
      style={{ background: `color-mix(in srgb, ${user?.avatarColor ?? '#5865f2'} 35%, #1e1f22)` }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (state.userId !== selfId) openContextMenu({ x: e.clientX, y: e.clientY, userId: state.userId });
      }}
    >
      <Avatar user={user} size={compact ? 44 : 80} speaking={speaking} />
      <div className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1.5 rounded bg-black/50 px-2 py-0.5 text-sm text-white">
        {(state.selfMute || localMuted) && !state.selfDeaf && <MicOff size={14} className="text-danger" />}
        {state.selfDeaf && <HeadphoneOff size={14} className="text-danger" />}
        <span className="truncate">{user?.displayName}</span>
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
      {!compact && <div className="text-sm text-text-muted">{user?.displayName} ekranını paylaşıyor</div>}
      <button
        className="flex items-center gap-2 rounded bg-[#4e5058] px-4 py-2 text-sm font-medium text-white hover:bg-[#6d6f78]"
        onClick={() => voice.watchStream(userId)}
      >
        <Eye size={16} /> Yayını İzle
      </button>
    </div>
  );
}

function CallControls() {
  const selfMute = useSettings((s) => s.selfMute);
  const selfDeaf = useSettings((s) => s.selfDeaf);
  const sharing = useVoice((s) => s.sharing);
  const connected = useVoice((s) => s.status === 'connected');
  const openModal = useUi((s) => s.openModal);
  const muted = selfMute || selfDeaf;

  return (
    <div className="flex h-20 shrink-0 items-center justify-center gap-3">
      <RoundButton
        title={muted ? 'Sesi Aç' : 'Sustur'}
        danger={muted}
        onClick={() => voice.toggleMute()}
      >
        {muted ? <MicOff size={22} /> : <Mic size={22} />}
      </RoundButton>
      <RoundButton
        title={selfDeaf ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}
        danger={selfDeaf}
        onClick={() => voice.toggleDeafen()}
      >
        {selfDeaf ? <HeadphoneOff size={22} /> : <Headphones size={22} />}
      </RoundButton>
      <RoundButton
        title={sharing ? 'Yayını Durdur' : 'Ekranını Paylaş'}
        active={sharing}
        disabled={!connected}
        onClick={() => (sharing ? void voice.stopScreenShare() : openModal({ type: 'screenPicker' }))}
      >
        {sharing ? <MonitorOff size={22} /> : <Monitor size={22} />}
      </RoundButton>
      <RoundButton title="Bağlantıyı Kes" hangup onClick={() => void voice.leave()}>
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
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  active?: boolean;
  hangup?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-full text-white transition-colors disabled:opacity-40',
        hangup
          ? 'w-16 bg-danger hover:bg-danger-hover'
          : danger
            ? 'bg-white text-bg-rail hover:bg-[#e3e5e8]'
            : active
              ? 'bg-ok hover:bg-[#1a8b4c]'
              : 'bg-[#2b2d31] hover:bg-[#404249]',
      )}
    >
      {children}
    </button>
  );
}
