import { useEffect, useState } from 'react';
import { formatElapsed } from '@diskort/client-core';

// 28 sn → "0:28", 1 sa 2 dk 5 sn → "1:02:05" (telefonla ortak: client-core)
export { formatElapsed };

/** Şimdiki an; saniyede bir güncellenir (canlı süre sayaçları için) */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Kanalın ne zamandan beri etkin olduğu (Discord'daki gibi, kanal adının yanında); saniyede bir güncellenir */
export function ElapsedTime({ since }: { since: number }) {
  const now = useNow();
  return (
    <span
      className="ml-auto shrink-0 pl-1 text-xs font-medium text-text-muted tabular-nums"
      data-tooltip="Kanalda geçen süre"
    >
      {formatElapsed(now - since)}
    </span>
  );
}
