import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EyeOff, Maximize, Minimize, MonitorPause, Volume2, VolumeX, X } from 'lucide-react';
import { voice } from '../../features/voice/voiceClient';
import { cn } from '../../lib/utils';
import { useGuild, useSession } from '@diskort/client-core';
import { useSettings } from '../../stores/settings';
import { setVoice, useVoice } from '../../stores/voice';
import { LiveBadge } from '../sidebar/VoiceMemberRow';
import { Slider } from '../ui/Slider';
import { StreamViewers } from './StreamViewers';
import { SwapIcon } from '../ui/SwapIcon';

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
  // Kendi yayının varsayılan olarak duraklatılır: track video öğesine hiç bağlanmaz (çözme/çizim yok)
  const paused = useVoice((s) => isSelf && !s.selfPreview);

  useEffect(() => {
    const el = videoRef.current;
    const track = paused ? undefined : voice.getScreenTrack(userId);
    if (!el || !track) {
      setHasVideo(false);
      return;
    }
    track.attach(el);
    setHasVideo(true);
    return () => {
      track.detach(el);
    };
  }, [userId, tracksVersion, paused]);

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
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn('h-full w-full object-contain transition-opacity duration-300', hasVideo ? 'opacity-100' : 'opacity-0')}
      />
      {paused ? (
        <SelfPreviewPaused compact={!large} />
      ) : (
        !hasVideo && <div className="absolute animate-pulse text-sm text-text-muted">Yayın yükleniyor…</div>
      )}

      <div className="pointer-events-none absolute top-0 right-0 left-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-3 pr-32 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 group-data-[idle]/stage:opacity-0!">
        <LiveBadge />
        <span className="truncate text-sm font-semibold text-white">
          {isSelf ? 'Senin yayının' : user?.displayName}
        </span>
      </div>

      {/* İzleyenler her zaman görünür (yayıncı için asıl bilgi) */}
      <StreamViewers userId={userId} className="absolute top-2.5 right-2.5" />

      {/* Ses sahnesinde fare durunca gizlenir (VoiceStage: useStageChrome) */}
      <div
        data-stage-chrome
        className={cn(
          'absolute right-0 bottom-0 left-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 group-data-[idle]/stage:opacity-0!',
          !large && 'hidden',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {!isSelf && hasAudio && (
          // Görüntünün üstünde okunaklı küçük hap: simge (sessize alır), kaydırıcı, yüzde
          <div className="mr-auto flex h-8 items-center gap-2 rounded-full bg-black/60 pr-3 pl-1 text-white backdrop-blur-sm">
            <button
              className="press-icon flex h-6 w-6 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
              onClick={() => setVolume(volume > 0 ? 0 : 1)}
              data-tooltip={volume > 0 ? 'Yayın sesini kapat' : 'Yayın sesini aç'}
              aria-label="Yayın sesi"
            >
              <SwapIcon swapKey={volume > 0 ? 'on' : 'off'} motion="ico-pop">
                {volume > 0 ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </SwapIcon>
            </button>
            <Slider
              className="w-24"
              aria-label="Yayın ses seviyesi"
              aria-valuetext={`%${Math.round(volume * 100)}`}
              min={0}
              max={200}
              value={Math.round(volume * 100)}
              onValueChange={(v) => setVolume(v / 100)}
            />
            <span className="w-9 text-right text-xs font-medium text-white/80 tabular-nums">
              %{Math.round(volume * 100)}
            </span>
          </div>
        )}
        {isSelf && !paused && (
          <IconButton title="Önizlemeyi duraklat" onClick={() => setVoice({ selfPreview: false })}>
            <EyeOff size={18} className="ico-blink" />
          </IconButton>
        )}
        <IconButton title={fullscreen ? 'Tam ekrandan çık' : 'Tam ekran'} onClick={toggleFullscreen}>
          <SwapIcon swapKey={fullscreen ? 'on' : 'off'} motion={fullscreen ? 'ico-shrink' : 'ico-grow'}>
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </SwapIcon>
        </IconButton>
        {!isSelf && (
          <IconButton title="İzlemeyi bırak" onClick={() => voice.stopWatching(userId)}>
            <X size={18} className="ico-rotate" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

/**
 * Kendi yayınına bakarken gösterilen duraklatılmış önizleme (Discord gibi): yayın sürer, yalnızca yerel
 * önizleme çizilmez. Tüm ekran paylaşılırken sonsuz ayna görüntüsünü de önler.
 */
function SelfPreviewPaused({ compact }: { compact: boolean }) {
  const show = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setVoice({ selfPreview: true });
  };
  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center text-center',
        'bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--color-brand)_18%,transparent),transparent_70%)]',
        compact ? 'gap-1.5 p-2' : 'gap-3 p-6',
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-full bg-white/10 text-white',
          compact ? 'h-9 w-9' : 'h-14 w-14',
        )}
      >
        <MonitorPause size={compact ? 18 : 28} aria-hidden />
      </span>
      {compact ? (
        <span className="text-xs font-medium text-white/80">Önizleme duraklatıldı</span>
      ) : (
        <>
          <p className="max-w-sm text-sm leading-relaxed text-white/85">
            <span className="font-semibold text-white">Yayının halen devam ediyor!</span> Kaynaklarından tasarruf
            etmek için bu önizlemeyi duraklattık.
          </p>
          <button
            type="button"
            onClick={show}
            onDoubleClick={(e) => e.stopPropagation()}
            className="press rounded bg-control px-4 py-2 text-sm font-medium text-on-control transition-colors hover:bg-control-hover"
          >
            Önizlemeyi göster
          </button>
        </>
      )}
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      data-tooltip={title}
      aria-label={title}
      onClick={onClick}
      className="press-icon flex h-8 w-8 items-center justify-center rounded bg-black/50 text-white hover:bg-black/80"
    >
      {children}
    </button>
  );
}
