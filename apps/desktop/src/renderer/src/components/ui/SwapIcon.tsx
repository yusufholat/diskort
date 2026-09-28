import type { ReactNode } from 'react';
import { useMountedRef } from '../../lib/motion';
import { cn } from '../../lib/utils';

/**
 * Durumla değişen simge (sustur ↔ aç, sağırlaştır, yayın aç/kapat): `swapKey` değişince yeni simge kısa
 * bir dönüşle belirir (styles/motion.css: .anim-icon-swap); ilk çizimde oynamaz. `motion` üstüne
 * gelince oynayan hareket (styles/hover.css: ico-*): simge değişince yeniden oynamasın diye
 * değişmeyen dış kaba verilir.
 */
export function SwapIcon({ swapKey, motion, children }: { swapKey: string; motion?: string; children: ReactNode }) {
  const mounted = useMountedRef();
  return (
    <span className={cn('inline-flex', motion)}>
      <span key={swapKey} className={mounted.current ? 'anim-icon-swap' : 'inline-flex'}>
        {children}
      </span>
    </span>
  );
}
