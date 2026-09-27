import { useEffect, useState } from 'react';

/** 28 sn → "0:28", 1 sa 2 dk 5 sn → "1:02:05" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Kanalın ne zamandan beri etkin olduğu (Discord'daki gibi, kanal adının yanında); saniyede bir güncellenir */
export function ElapsedTime({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span
      className="ml-auto shrink-0 pl-1 text-xs font-medium text-text-muted tabular-nums"
      data-tooltip="Kanalda geçen süre"
    >
      {formatElapsed(now - since)}
    </span>
  );
}
