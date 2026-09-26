import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize, Minimize, Volume2, VolumeX, X } from 'lucide-react';
import { voice } from '../../features/voice/voiceClient';
import { cn } from '../../lib/utils';
import { useGuild } from '../../stores/guild';
import { useSession } from '../../stores/session';
import { useSettings } from '../../stores/settings';
import { useVoice } from '../../stores/voice';
import { LiveBadge } from '../sidebar/VoiceMemberRow';

interface Props {
  userId: string;
  /** Büyük (odaklanmış) görünüm mü, yoksa küçük önizleme mi */
  large?: boolean;
  onClick?: () => void;
}

/** Bir kullanıcının ekran yayınını video öğesine bağlar. */
export function StreamView({ userId, large, onClick }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tracksVersion = useVoice((s) => s.tracksVersion);
  const hasAudio = useVoice((s) => s.streams[userId]?.hasAudio ?? false);
  const user = useGuild((s) => s.users[userId]);
  const isSelf = useSession((s) => s.user?.id === userId);
  const volume = useSettings((s) => s.streamVolumes[userId] ?? 1);
  const [fullscreen, setFullscreen] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    const track = voice.getScreenTrack(userId);
    if (!el || !track) {
      setHasVideo(false);
      return;
    }
    track.attach(el);
    setHasVideo(true);
    return () => {
      track.detach(el);
    };
  }, [userId, tracksVersion]);

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  };

  const setVolume = (v: number): void => {
    const streamVolumes = { ...useSettings.getState().streamVolumes, [userId]: v };
    useSettings.getState().set({ streamVolumes });
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'group relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg bg-black',
        onClick && 'cursor-pointer',
      )}
      onClick={onClick}
      onDoubleClick={toggleFullscreen}
    >
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
      {!hasVideo && <div className="absolute text-sm text-text-muted">Yayın yükleniyor…</div>}

      <div className="pointer-events-none absolute top-0 right-0 left-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
        <LiveBadge />
        <span className="truncate text-sm font-semibold text-white">
          {isSelf ? 'Senin yayının' : user?.displayName}
        </span>
      </div>

      <div
        className={cn(
          'absolute right-0 bottom-0 left-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100',
          !large && 'hidden',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {!isSelf && hasAudio && (
          <div className="mr-auto flex items-center gap-2 rounded bg-black/50 px-2 py-1">
            <button className="text-white" onClick={() => setVolume(volume > 0 ? 0 : 1)} title="Yayın sesi">
              {volume > 0 ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <input
              type="range"
              className="slider w-28"
              min={0}
              max={200}
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
            />
          </div>
        )}
        <IconButton title={fullscreen ? 'Tam ekrandan çık' : 'Tam ekran'} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </IconButton>
        {!isSelf && (
          <IconButton title="İzlemeyi bırak" onClick={() => voice.stopWatching(userId)}>
            <X size={18} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded bg-black/50 text-white hover:bg-black/80"
    >
      {children}
    </button>
  );
}
