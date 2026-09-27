import { useEffect, useState } from 'react';
import { ChevronRight, MessageSquarePlus } from 'lucide-react';
import type { Feedback } from '@diskort/shared';
import { errorMessage, loadMyFeedback, useFeedback } from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { useUi } from '../../stores/ui';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/controls';
import { ScreenshotThumb, StatusBadge, TypeBadge, feedbackSummary, formatDate } from './common';

/** Kullanıcı Ayarları > Geri Bildirimlerim: gönderdiklerim ve durumları (yöneticinin notuyla). */
export function MyFeedback() {
  const mine = useFeedback((s) => s.mine);
  const openModal = useUi((s) => s.openModal);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    loadMyFeedback().catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  return (
    <div>
      <h2 className="mb-2 text-xl font-bold text-text-head">Geri Bildirimlerim</h2>
      <p className="mb-5 text-sm text-text-muted">
        Gönderdiğin hata ve önerilerin durumu burada. Bir şey düzeltilince ya da planlanınca burada görürsün.
      </p>
      <Button className="mb-6 flex items-center gap-2" onClick={() => openModal({ type: 'feedback' })}>
        <MessageSquarePlus size={18} />
        Geri bildirim gönder
      </Button>

      {error ? (
        <div className="text-sm text-danger-text">{error}</div>
      ) : mine === null ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Yükleniyor">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      ) : mine.length === 0 ? (
        <div className="rounded-md bg-bg-side px-4 py-6 text-center text-sm text-text-muted">
          Henüz geri bildirim göndermedin.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {mine.map((f) => (
            <MyFeedbackItem key={f.id} item={f} open={openId === f.id} onToggle={() => setOpenId(openId === f.id ? null : f.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MyFeedbackItem({ item, open, onToggle }: { item: Feedback; open: boolean; onToggle: () => void }) {
  return (
    <li className="overflow-hidden rounded-md bg-bg-side">
      <button
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-bg-hover"
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronRight size={16} className={cn('shrink-0 text-text-muted transition-transform duration-150', open && 'rotate-90')} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-text-head">{feedbackSummary(item)}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
            <TypeBadge type={item.type} />
            <span>#{item.id}</span>
            <span>{formatDate(item.createdAt)}</span>
            {item.adminNote && <span className="text-text-normal">· Yanıt var</span>}
          </div>
        </div>
        <StatusBadge status={item.status} />
      </button>
      {open && (
        <div className="anim-slide-down border-t border-line px-4 py-3 text-sm">
          <p className="break-words whitespace-pre-wrap text-text-normal select-text">{item.body}</p>
          {item.screenshots.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.screenshots.map((s) => (
                <ScreenshotThumb key={s.id} shot={s} className="h-20 w-32" />
              ))}
            </div>
          )}
          {item.adminNote && (
            <div className="mt-3 rounded-md border-l-4 border-brand bg-bg-rail px-3 py-2">
              <div className="mb-0.5 text-xs font-bold text-text-muted uppercase">Yanıt</div>
              <p className="break-words whitespace-pre-wrap text-text-normal select-text">{item.adminNote}</p>
            </div>
          )}
          {item.updatedAt !== item.createdAt && (
            <div className="mt-2 text-xs text-text-faint">Son güncelleme: {formatDate(item.updatedAt)}</div>
          )}
        </div>
      )}
    </li>
  );
}
