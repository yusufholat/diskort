import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Keybind } from '../../../../shared/bridge';
import { bridge } from '../../lib/bridge';
import { useEscapeLayer } from '../../lib/escape';
import { cn } from '../../lib/utils';

/** Global kısayol atama kutusu: tıklayıp bir tuşa/fare tuşuna bas. */
export function KeybindInput({
  value,
  onChange,
  disabled,
}: {
  value: Keybind | null;
  onChange: (bind: Keybind | null) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  // Kayıt sırasında Esc yalnızca kaydı iptal eder (ana süreç yakalar), ayarları kapatmaz
  useEscapeLayer(() => undefined, recording);

  useEffect(() => {
    return () => {
      if (recording) void bridge?.hotkeys.cancelRecord();
    };
  }, [recording]);

  const record = async (): Promise<void> => {
    if (!bridge) return;
    setRecording(true);
    const bind = await bridge.hotkeys.record();
    setRecording(false);
    if (bind) onChange(bind);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={disabled || !bridge}
        onClick={() => (recording ? void bridge?.hotkeys.cancelRecord() : void record())}
        className={cn(
          'flex h-10 min-w-56 flex-1 items-center rounded-[3px] border px-3 text-left text-sm transition-colors disabled:opacity-50',
          recording
            ? 'border-danger bg-danger/10 text-danger'
            : 'border-transparent bg-bg-input text-text-normal hover:border-edge-strong',
        )}
      >
        {recording ? 'Bir tuşa bas… (Esc: iptal)' : (value?.label ?? 'Kısayol atanmadı')}
      </button>
      {value && !recording && (
        <button
          className="rounded p-2 text-text-muted hover:bg-bg-hover hover:text-danger"
          data-tooltip="Kısayolu kaldır"
          aria-label="Kısayolu kaldır"
          onClick={() => onChange(null)}
        >
          <X size={16} className="ico-rotate" />
        </button>
      )}
    </div>
  );
}
