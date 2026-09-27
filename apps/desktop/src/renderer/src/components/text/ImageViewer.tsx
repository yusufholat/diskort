import { useEffect } from 'react';
import { Download, ExternalLink, X } from 'lucide-react';
import type { Attachment } from '@diskort/shared';
import { attachmentUrl, formatBytes } from '@diskort/client-core';
import { downloadAttachment } from '../../features/messages/files';
import { bridge } from '../../lib/bridge';
import { useUi } from '../../stores/ui';

/** Resmin tam boyutu: pencereye sığdırılmış, altında ad, boyut ve indirme. */
export function ImageViewer({ attachment }: { attachment: Attachment }) {
  const close = useUi((s) => s.closeModal);
  const url = attachmentUrl(attachment);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <div className="animate-pop fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/85 p-6" onMouseDown={close}>
      <button className="absolute top-10 right-6 rounded p-1 text-white/70 hover:text-white" onClick={close} aria-label="Kapat">
        <X size={28} />
      </button>
      <img
        src={url}
        alt={attachment.name}
        draggable={false}
        className="max-h-[calc(100vh-150px)] max-w-full rounded object-contain shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      />
      <div className="mt-3 flex items-center gap-4 text-sm text-white/80" onMouseDown={(e) => e.stopPropagation()}>
        <span className="max-w-[40vw] truncate" title={attachment.name}>
          {attachment.name}
        </span>
        <span className="text-white/50">
          {attachment.width && attachment.height ? `${attachment.width}×${attachment.height} · ` : ''}
          {formatBytes(attachment.size)}
        </span>
        <button className="flex items-center gap-1 hover:text-white hover:underline" onClick={() => downloadAttachment(attachment)}>
          <Download size={16} /> İndir
        </button>
        <button
          className="flex items-center gap-1 hover:text-white hover:underline"
          onClick={() => (bridge ? void bridge.openExternal(url) : window.open(url, '_blank'))}
        >
          <ExternalLink size={16} /> Tarayıcıda aç
        </button>
      </div>
    </div>
  );
}
