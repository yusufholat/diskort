import { useRef, useState } from 'react';
import { Download, Play } from 'lucide-react';
import type { Attachment } from '@diskort/shared';
import { attachmentUrl, fitBox, formatBytes } from '@diskort/client-core';
import { downloadAttachment } from '../../features/messages/files';
import { cn } from '../../lib/utils';
import { FileCard, IMAGE_MAX } from './Attachments';

/** Boyutu bilinmeyen video için kutu (16:9) */
const DEFAULT_BOX = { width: 400, height: 225 };

/** 75 → "1:15", 3725 → "1:02:05" */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Mesajdaki video: ilk karesi (yalnızca başı indirilir) ve ortada oynat düğmesi. Tıklayınca mesajın
 * içinde sesli oynar (kendiliğinden hiç oynamaz); oynatıcının kendi düğmeleriyle ileri sarılır, tam
 * ekran yapılır. Sağ üstte indirme. Tarayıcının açamadığı biçimler (ör. bazı HEVC .mov) dosya kartı olur.
 */
export function VideoAttachment({ attachment }: { attachment: Attachment }) {
  const box = fitBox(attachment.width, attachment.height, IMAGE_MAX) ?? DEFAULT_BOX;
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState<number | null>(attachment.duration ?? null);
  const video = useRef<HTMLVideoElement>(null);

  if (failed) return <FileCard attachment={attachment} />;

  const play = (): void => {
    setStarted(true);
    void video.current?.play().catch(() => undefined);
  };

  return (
    <div
      data-attachment-id={attachment.id}
      className="group/video relative overflow-hidden rounded-lg bg-black"
      style={box}
    >
      <video
        ref={video}
        src={attachmentUrl(attachment)}
        preload="metadata"
        playsInline
        controls={started}
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture
        aria-label={attachment.name}
        className="block h-full w-full object-contain"
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
        }}
        onError={() => setFailed(true)}
      />
      {!started && (
        <button
          className="group/play absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/20"
          aria-label={`${attachment.name} videosunu oynat`}
          onClick={play}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white shadow-lg transition-transform duration-200 ease-(--ease-hov) group-hover/play:scale-110 group-active/play:scale-95">
            <Play size={26} fill="currentColor" className="ml-1" />
          </span>
        </button>
      )}
      {!started && (
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-1.5 text-xs text-white/90">
          <span className="truncate">{attachment.name}</span>
          <span className="shrink-0 tabular-nums">
            {duration !== null ? `${formatDuration(duration)} · ` : ''}
            {formatBytes(attachment.size)}
          </span>
        </div>
      )}
      <button
        className={cn(
          'press-icon absolute top-1.5 right-1.5 rounded-md bg-black/60 p-1.5 text-white/85 opacity-0 transition-opacity hover:text-white focus-visible:opacity-100 group-hover/video:opacity-100',
        )}
        data-tooltip="İndir"
        aria-label="İndir"
        onClick={() => downloadAttachment(attachment)}
      >
        <Download size={18} className="ico-drop" />
      </button>
    </div>
  );
}
