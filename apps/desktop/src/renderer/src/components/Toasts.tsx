import { X } from 'lucide-react';
import { useUi } from '../stores/ui';
import { cn } from '../lib/utils';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'animate-pop pointer-events-auto flex max-w-sm items-start gap-3 rounded-md px-4 py-3 text-sm text-white shadow-xl',
            t.kind === 'error' ? 'bg-danger' : t.kind === 'success' ? 'bg-ok' : 'bg-bg-float',
          )}
        >
          <span className="flex-1">{t.text}</span>
          <button className="opacity-70 hover:opacity-100" onClick={() => dismiss(t.id)} aria-label="Kapat">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
