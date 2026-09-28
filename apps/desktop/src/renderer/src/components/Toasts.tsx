import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { collapseClass, usePresenceList } from '../lib/motion';
import { useUi, type Toast } from '../stores/ui';
import { cn } from '../lib/utils';

const ICONS = { error: CircleAlert, success: CircleCheck, info: Info } as const;

/** Sağ altta beliren kısa bildirimler: sağdan kayarak girer, kapanırken yer açarak çıkar. */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const entries = usePresenceList(toasts, (t: Toast) => String(t.id), 200);
  return (
    <div className="pointer-events-none fixed right-4 bottom-3 z-[60] flex flex-col items-end" role="status" aria-live="polite">
      {entries.map(({ key, item: t, phase }) => {
        const Icon = ICONS[t.kind];
        return (
          // Dış kutunun yüksekliği açılıp kapanır (diğerleri yumuşakça kayar), iç kutu sağdan kayar
          <div key={key} className={collapseClass(phase)}>
            <div className={cn(phase !== 'static' && 'collapse-inner', 'py-1')}>
              <div
                className={cn(
                  'pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-md px-3.5 py-3 text-sm text-white shadow-lg',
                  t.kind === 'error' ? 'bg-danger' : t.kind === 'success' ? 'bg-ok' : 'bg-bg-float',
                  phase === 'exit' ? 'anim-toast-out' : 'anim-toast-in',
                )}
              >
                <Icon size={18} className="mt-px shrink-0 opacity-90" />
                <span className="flex-1">{t.text}</span>
                <button
                  className="press-icon -mr-1 rounded opacity-70 hover:opacity-100"
                  onClick={() => dismiss(t.id)}
                  aria-label="Kapat"
                >
                  <X size={16} className="ico-rotate" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
