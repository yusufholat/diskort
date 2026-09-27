import { Download, File, FileArchive, FileAudio, FileImage, FileText, FileVideo, X } from 'lucide-react';
import { isImageAttachment, isVideoAttachment, type Attachment } from '@diskort/shared';
import { attachmentUrl, discardMessage, formatBytes, type LocalMessage } from '@diskort/client-core';
import { downloadAttachment } from '../../features/messages/files';
import { cn } from '../../lib/utils';
import { useUi } from '../../stores/ui';
import { VideoAttachment } from './VideoAttachment';

/** Mesajın içindeki resimlerin (ve video/GIF'lerin) sığdırıldığı en büyük kutu */
export const IMAGE_MAX = { width: 480, height: 360 };

export function FileIcon({ type, size = 30, className }: { type: string; size?: number; className?: string }) {
  const Icon = type.startsWith('image/')
    ? FileImage
    : type.startsWith('video/')
      ? FileVideo
      : type.startsWith('audio/')
        ? FileAudio
        : /zip|rar|7z|tar|gzip/.test(type)
          ? FileArchive
          : type.startsWith('text/') || type === 'application/pdf'
            ? FileText
            : File;
  return <Icon size={size} strokeWidth={1.5} className={className} />;
}

function fit(width: number | null, height: number | null): { width: number; height: number } | null {
  if (!width || !height) return null;
  const scale = Math.min(1, IMAGE_MAX.width / width, IMAGE_MAX.height / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Onaylanmış mesajın dosyaları: resimler ve videolar satır içinde, diğerleri indirme kartı olarak. */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  const openModal = useUi((s) => s.openModal);
  const images = attachments.filter(isImageAttachment);
  const videos = attachments.filter(isVideoAttachment);
  const files = attachments.filter((a) => !isImageAttachment(a) && !isVideoAttachment(a));
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((a) => {
            const size = fit(a.width, a.height);
            return (
              <button
                key={a.id}
                data-attachment-id={a.id}
                data-tooltip={a.name}
                className="block overflow-hidden rounded-lg bg-bg-side transition-[filter] duration-150 hover:brightness-110"
                style={size ?? { maxWidth: IMAGE_MAX.width, maxHeight: IMAGE_MAX.height }}
                onClick={() => openModal({ type: 'image', attachment: a })}
              >
                <img
                  src={attachmentUrl(a)}
                  alt={a.name}
                  loading="lazy"
                  draggable={false}
                  className={cn('block', size ? 'h-full w-full object-cover' : 'max-h-[360px] max-w-[480px]')}
                />
              </button>
            );
          })}
        </div>
      )}
      {videos.map((a) => (
        <VideoAttachment key={a.id} attachment={a} />
      ))}
      {files.map((a) => (
        <FileCard key={a.id} attachment={a} />
      ))}
    </div>
  );
}

/** İndirilebilir dosya kartı (tarayıcının açamadığı videolar da böyle gösterilir) */
export function FileCard({ attachment }: { attachment: Attachment }) {
  return (
    <div
      data-attachment-id={attachment.id}
      className="flex w-[min(440px,100%)] items-center gap-3 rounded-lg border border-black/20 bg-bg-side px-3 py-2.5"
    >
      <FileIcon type={attachment.contentType} className="shrink-0 text-[#00a8fc]" />
      <div className="min-w-0 flex-1">
        <button
          className="block max-w-full truncate text-left text-[#00a8fc] hover:underline"
          data-tooltip={attachment.name}
          onClick={() => downloadAttachment(attachment)}
        >
          {attachment.name}
        </button>
        <div className="text-xs text-text-muted">{formatBytes(attachment.size)}</div>
      </div>
      <button
        className="shrink-0 rounded p-1 text-text-muted hover:text-text-head"
        data-tooltip="İndir"
        aria-label="İndir"
        onClick={() => downloadAttachment(attachment)}
      >
        <Download size={22} />
      </button>
    </div>
  );
}

/** Gönderilmekte olan mesajın dosyaları ve yükleme ilerlemesi */
export function UploadList({ message }: { message: LocalMessage }) {
  const failed = message.status === 'failed';
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {message.uploads?.map((u, i) => {
        const done = u.attachment ? u.file.size : Math.min(u.sent, u.file.size);
        const percent = u.file.size ? Math.round((done / u.file.size) * 100) : 100;
        return (
          <div
            key={i}
            className="flex w-[min(440px,100%)] items-center gap-3 rounded-lg border border-black/20 bg-bg-side px-3 py-2.5"
          >
            <FileIcon type={u.file.type} className="shrink-0 text-text-muted" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-text-normal">{u.file.name}</span>
                <span className="shrink-0 text-xs text-text-muted">
                  {failed && !u.attachment ? 'Yüklenemedi' : `${formatBytes(done)} / ${formatBytes(u.file.size)}`}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-active">
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-150',
                    failed && !u.attachment ? 'bg-danger' : u.attachment ? 'bg-ok' : 'bg-brand',
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
            {!failed && message.nonce && (
              <button
                className="shrink-0 rounded p-1 text-text-muted hover:text-danger"
                data-tooltip="Yüklemeyi iptal et"
                aria-label="Yüklemeyi iptal et"
                onClick={() => discardMessage(message.channelId, message.nonce!)}
              >
                <X size={18} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
