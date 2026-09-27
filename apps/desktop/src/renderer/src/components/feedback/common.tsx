import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bug, Check, ImageOff, Lightbulb, MessageCircle, X } from 'lucide-react';
import {
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPE_LABELS,
  type FeedbackContext,
  type FeedbackScreenshot,
  type FeedbackStatus,
  type FeedbackType,
} from '@diskort/shared';
import { fetchFeedbackScreenshot } from '@diskort/client-core';
import { contextRows } from '../../features/feedback/context';
import { useEscapeLayer } from '../../lib/escape';
import { cn } from '../../lib/utils';
import { Skeleton } from '../ui/Skeleton';

export const TYPE_ICONS: Record<FeedbackType, typeof Bug> = { hata: Bug, oneri: Lightbulb, diger: MessageCircle };

const TYPE_COLORS: Record<FeedbackType, string> = {
  hata: 'text-[#fa777c]',
  oneri: 'text-warn',
  diger: 'text-[#00a8fc]',
};

const STATUS_COLORS: Record<FeedbackStatus, string> = {
  yeni: 'bg-brand/20 text-[#949cf7]',
  incelendi: 'bg-[#00a8fc]/15 text-[#00a8fc]',
  planlandi: 'bg-warn/15 text-warn',
  tamamlandi: 'bg-ok/15 text-[#2dc770]',
  reddedildi: 'bg-white/10 text-text-muted',
};

export function TypeBadge({ type, className }: { type: FeedbackType; className?: string }) {
  const Icon = TYPE_ICONS[type];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', TYPE_COLORS[type], className)}>
      <Icon size={14} className="shrink-0" />
      {FEEDBACK_TYPE_LABELS[type]}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: FeedbackStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        STATUS_COLORS[status],
        className,
      )}
    >
      {FEEDBACK_STATUS_LABELS[status]}
    </span>
  );
}

const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDate = (ms: number): string => dateFormat.format(new Date(ms));

/** Geri bildirimin listede gösterilen kısa adı */
export const feedbackSummary = (f: { title: string | null; body: string }): string =>
  f.title ?? f.body.replace(/\s+/g, ' ').trim().slice(0, 120);

/** Temalı onay kutusu */
export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-2 text-left text-sm text-text-normal"
    >
      <span
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-2 transition-colors',
          checked ? 'border-brand bg-brand text-white' : 'border-text-muted group-hover:border-text-normal',
        )}
      >
        {checked && <Check size={12} strokeWidth={3.5} className="anim-pill-in" />}
      </span>
      {children}
    </button>
  );
}

/**
 * Ekran görüntüsü: herkese açık adresi yoktur, jetonla indirilip blob adresiyle gösterilir.
 * Tıklanınca tam boyut açılır.
 */
export function ScreenshotThumb({ shot, className }: { shot: FeedbackScreenshot; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  // Liste güncellenince nesne yenilenir; resim yalnızca adres değişince yeniden indirilir
  const shotUrl = shot.url;

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetchFeedbackScreenshot({ url: shotUrl }, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [shotUrl]);

  return (
    <>
      <button
        type="button"
        onClick={() => url && setOpen(true)}
        disabled={!url}
        data-tooltip={url ? 'Tam boyut' : undefined}
        className={cn(
          'press relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-rail',
          className ?? 'h-24 w-40',
        )}
      >
        {url ? (
          <img src={url} alt="Ekran görüntüsü" draggable={false} className="h-full w-full object-cover" />
        ) : failed ? (
          <ImageOff size={22} className="text-text-muted" aria-label="Ekran görüntüsü yüklenemedi" />
        ) : (
          <Skeleton className="h-full w-full rounded-md" />
        )}
      </button>
      {open && url && <Lightbox url={url} caption={`${shot.width}×${shot.height}`} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Resmin tam boyutu, pencereye sığdırılmış (açık pencerenin üstünde) */
export function Lightbox({ url, caption, onClose }: { url: string; caption?: string; onClose: () => void }) {
  useEscapeLayer(onClose);
  return createPortal(
    <div
      className="anim-fade-in fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-6"
      onMouseDown={onClose}
    >
      <button
        className="press-icon absolute top-10 right-6 rounded p-1 text-white/70 hover:text-white"
        onClick={onClose}
        aria-label="Kapat"
      >
        <X size={28} />
      </button>
      <img
        src={url}
        alt="Ekran görüntüsü"
        draggable={false}
        className="anim-modal-in max-h-[calc(100vh-120px)] max-w-full rounded object-contain shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      />
      {caption && <div className="mt-3 text-sm text-white/60">{caption}</div>}
    </div>,
    document.body,
  );
}

/** Teknik bilgiler: anahtar/değer satırları ve son hatalar */
export function ContextTable({ context }: { context: FeedbackContext }) {
  const rows = contextRows(context);
  const errors = context.recentErrors ?? [];
  return (
    <div className="rounded-md bg-bg-rail px-3 py-2 text-sm">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-text-muted">{r.label}</dt>
            <dd className="min-w-0 break-words text-text-normal select-text">{r.value}</dd>
          </div>
        ))}
        <dt className="text-text-muted">Son hatalar</dt>
        <dd className="min-w-0 text-text-normal">
          {errors.length === 0 ? (
            <span className="text-text-faint">Yok</span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {errors.map((e, i) => (
                <li key={i} className="font-mono text-xs break-words text-[#fa777c] select-text">
                  {e}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </div>
  );
}
