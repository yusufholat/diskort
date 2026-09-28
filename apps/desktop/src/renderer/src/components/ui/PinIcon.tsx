import type { SVGProps } from 'react';

/**
 * Raptiye (Discord'daki gibi dolu ve eğik). Lucide'ın ince raptiyesi yerine; lucide simgeleri gibi `size`
 * alır ve rengini yazı renginden (currentColor) alır.
 */
export function PinIcon({ size = 24, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="1.5 1.5 21 21"
      fill="currentColor"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden={rest['aria-label'] ? undefined : true}
      {...rest}
    >
      <g transform="translate(-1.6 1.6) rotate(45 12 12)">
        <path
          strokeWidth={1.5}
          d="M8 2.75h8a.25.25 0 0 1 0 2.5h-1.25v4.5l3.25 3.5v1.5H6v-1.5l3.25-3.5v-4.5H8a.25.25 0 0 1 0-2.5z"
        />
        <path fill="none" strokeWidth={2.2} d="M12 15v6.25" />
      </g>
    </svg>
  );
}
