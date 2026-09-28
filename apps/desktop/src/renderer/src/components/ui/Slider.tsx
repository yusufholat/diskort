import type { CSSProperties, InputHTMLAttributes } from 'react';

/**
 * Temalı kaydırıcı: ince iz (dolu kısmı vurgu renginde) ve küçük yuvarlak tutamak (styles/controls.css). Görünüm
 * ham <input type="range">'e de uygulanır; bu bileşen yalnızca dolu kısmı (--fill) hesaplar. Klavye: oklar,
 * PageUp/PageDown, Home/End (tarayıcının kendi davranışı).
 */
export function Slider({
  value,
  min = 0,
  max = 100,
  onValueChange,
  style,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max'> & {
  value: number;
  min?: number;
  max?: number;
  onValueChange?: (value: number) => void;
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onValueChange?.(Number(e.target.value))}
      style={{ ['--fill' as string]: `${Math.max(0, Math.min(100, fill))}%`, ...style } as CSSProperties}
      {...rest}
    />
  );
}
