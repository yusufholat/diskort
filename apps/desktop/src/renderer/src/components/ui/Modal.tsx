import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useEscapeLayer } from '../../lib/escape';
import { usePresenceClosing } from '../../lib/motion';
import { cn } from '../../lib/utils';

interface Props {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Ortada açılan pencere: arka plan kararır, pencere hafifçe büyüyerek belirir. Kapanırken
 * (bir PresenceProvider içinde closing=true) ters animasyonu oynatır.
 */
export function Modal({ title, subtitle, onClose, children, footer, className }: Props) {
  const closing = usePresenceClosing();
  useEscapeLayer(onClose, !closing);

  return (
    <div
      className={cn(
        'fixed inset-0 z-40 flex items-center justify-center bg-black/70',
        closing ? 'anim-fade-out pointer-events-none' : 'anim-fade-in',
      )}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative w-[440px] max-w-[92vw] rounded-lg border border-frame bg-bg-main shadow-2xl',
          closing ? 'anim-modal-out' : 'anim-modal-in',
          className,
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          className="press-icon absolute top-3 right-3 rounded p-1 text-text-muted hover:text-text-head"
          onClick={onClose}
          aria-label="Kapat"
        >
          <X size={22} />
        </button>
        {title && (
          <div className="px-4 pt-5 pb-3 text-center">
            <h2 className="text-xl font-bold text-text-head">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
          </div>
        )}
        <div className="px-4 pb-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 rounded-b-lg bg-bg-side px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}
