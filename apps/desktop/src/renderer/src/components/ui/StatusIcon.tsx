import { useId } from 'react';
import { STATUS_COLORS, type DisplayStatus } from '@diskort/client-core';

/**
 * Discord biçimli durum simgesi: çevrim içi dolu yeşil daire, boşta sarı ay, rahatsız etmeyin ortası
 * çizgili kırmızı daire, çevrimdışı/görünmez gri halka. Oyuklar saydamdır (arkadaki zemin görünür).
 */
export function StatusIcon({ status, size = 10, className }: { status: DisplayStatus; size?: number; className?: string }) {
  // useId iki nokta / köşeli tırnak içerir; url(#…) içinde güvenli olsun
  const id = `durum-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const color = STATUS_COLORS[status];
  if (status === 'online') {
    return (
      <svg width={size} height={size} viewBox="0 0 10 10" className={className} aria-hidden>
        <circle cx="5" cy="5" r="5" fill={color} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className={className} aria-hidden>
      <mask id={id}>
        <circle cx="5" cy="5" r="5" fill="white" />
        {status === 'idle' && <circle cx="2.5" cy="2.5" r="3.75" fill="black" />}
        {status === 'dnd' && <rect x="1.25" y="3.75" width="7.5" height="2.5" rx="1.25" fill="black" />}
        {(status === 'offline' || status === 'invisible') && <circle cx="5" cy="5" r="2.5" fill="black" />}
      </mask>
      <circle cx="5" cy="5" r="5" fill={color} mask={`url(#${id})`} />
    </svg>
  );
}
