import type { CustomStatus } from '@diskort/shared';
import { cn } from '../../lib/utils';

/** Özel durumun tek satırlık gösterimi: emoji ve metin (sığmazsa kırpılır; tamamı ipucunda) */
export function CustomStatusLine({ status, className }: { status: CustomStatus; className?: string }) {
  const full = [status.emoji, status.text].filter(Boolean).join(' ');
  return (
    <div className={cn('truncate', className)} title={full}>
      {status.emoji && <span className="mr-1">{status.emoji}</span>}
      {status.text}
    </div>
  );
}
