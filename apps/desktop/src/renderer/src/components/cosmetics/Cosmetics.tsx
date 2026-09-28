import { useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { CosmeticSet } from '@diskort/shared';
import { COSMETIC_SET_INFO, type ShaderViewKind } from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { attachView, setCosmeticsCover, type ViewHandle } from './engine';
import type { CardGeo } from './layers';

// Hareketli kozmetiklerin React bileşenleri: hepsi tek motora (engine.ts) bağlanan 2B tuvallerdir.

/** Avatarın bu boydan küçüğünde (mesajlar, listeler) hareketli dekorasyon yerine sabit, ucuz bir halka */
export const ANIMATED_DECORATION_MIN_SIZE = 64;
/** Dekorasyon tuvali avatarın dış yarıçapının bu katı (vitrin: 46 piksellik yarıçapa 132 piksel) */
const DECORATION_CANVAS_SCALE = 132 / 46;

function CosmeticCanvas({
  kind,
  set,
  R,
  fps,
  glScale,
  measure,
  className,
  style,
}: {
  kind: ShaderViewKind;
  set: CosmeticSet;
  R?: number;
  fps?: number;
  glScale?: number;
  measure?: (canvas: HTMLCanvasElement) => CardGeo | null;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<ViewHandle | null>(null);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  // Görünümün türü değişmez (değişirse bileşen yeniden kurulur); set ve ölçüler sonradan güncellenir
  useLayoutEffect(() => {
    const canvas = ref.current!;
    const h = attachView(canvas, {
      kind,
      set,
      R,
      fps,
      glScale,
      measure: measureRef.current ? () => measureRef.current?.(canvas) ?? null : undefined,
    });
    handle.current = h;
    return () => {
      h.dispose();
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  useEffect(() => {
    handle.current?.update({ set, R, fps, glScale });
  }, [set, R, fps, glScale]);
  return (
    <canvas
      ref={ref}
      width={0}
      height={0}
      aria-hidden
      className={cn('pointer-events-none block', className)}
      style={style}
    />
  );
}

/**
 * Kartın ölçüleri: afiş (data-fx-banner) ve avatar (data-fx-avatar) kartın içinde aranır. Kart açılırken
 * ölçekle canlandırıldığından ekrandaki boy tuvalin css boyuna bölünerek düzeltilir.
 */
function measureCard(canvas: HTMLCanvasElement): CardGeo | null {
  const card = canvas.parentElement;
  const banner = card?.querySelector('[data-fx-banner]');
  const avatar = card?.querySelector('[data-fx-avatar]');
  if (!banner || !avatar || !canvas.clientWidth) return null;
  const c = canvas.getBoundingClientRect();
  const scale = c.width / canvas.clientWidth || 1;
  const b = banner.getBoundingClientRect();
  const a = avatar.getBoundingClientRect();
  return {
    bh: (b.bottom - c.top) / scale,
    ax: (a.left + a.width / 2 - c.left) / scale,
    ay: (a.top + a.height / 2 - c.top) / scale,
    ar: a.width / 2 / scale,
  };
}

/** Profil kartının tamamını saran set efekti (kartın en üstünde, tıklamaları engellemez) */
export function CardEffectCanvas({ set, className }: { set: CosmeticSet; className?: string }) {
  return (
    <CosmeticCanvas
      kind="card"
      set={set}
      glScale={0.75}
      measure={measureCard}
      className={cn('absolute inset-0 z-[1] h-full w-full', className)}
    />
  );
}

/**
 * Hareketli avatar dekorasyonu. Profil boyundaki avatarda (≥ 64 piksel) ya da `animate` ile canlı tuval;
 * küçük avatarda (mesajlar, üye listesi) sabit, yalnızca CSS'ten bir halka: onlarca satır tuval açmasın.
 */
export function AnimatedDecoration({ set, size, animate }: { set: CosmeticSet; size: number; animate?: boolean }) {
  if (!animate && size < ANIMATED_DECORATION_MIN_SIZE) return <StaticDecorationRing set={set} size={size} />;
  // Avatarın dış yarıçapı (profil kartında 80 piksellik avatar + 6 piksellik halka = 46)
  const R = (size / 2) * 1.15;
  const box = Math.round(R * DECORATION_CANVAS_SCALE);
  const off = (size - box) / 2;
  return (
    <CosmeticCanvas
      kind="deco"
      set={set}
      R={R}
      fps={animate && size < ANIMATED_DECORATION_MIN_SIZE ? 30 : undefined}
      className="absolute max-w-none"
      style={{ left: off, top: off, width: box, height: box }}
    />
  );
}

/** Küçük avatarlarda setin renklerinde ince halka */
function StaticDecorationRing({ set, size }: { set: CosmeticSet; size: number }) {
  const info = COSMETIC_SET_INFO[set];
  const w = size >= 40 ? 2.5 : 2;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute rounded-full"
      style={{
        inset: -w,
        background: `conic-gradient(from 210deg, ${info.accent}, ${info.to}, ${info.accent}, ${info.from}, ${info.accent})`,
        mask: `radial-gradient(circle closest-side, transparent calc(100% - ${w + 0.6}px), #000 calc(100% - ${w}px))`,
        boxShadow: `0 0 ${w * 2}px ${info.accent}55`,
      }}
    />
  );
}

/**
 * Üye listesi satırının arkasındaki isim plakası (satır `isolate` olmalı: tuval yazıların altında kalır).
 * Satır başına bir tuval olduğundan 30 kare/sn: yavaş hareketli zeminde fark edilmez, yük yarıya iner.
 */
export function NameplateCanvas({ set, className }: { set: CosmeticSet; className?: string }) {
  return <CosmeticCanvas kind="plate" set={set} fps={30} className={cn('absolute inset-0 -z-10 h-full w-full', className)} />;
}

/** Seçici kutusundaki küçük resim (30 kare/sn yeter) */
export function SetThumbCanvas({ set, className }: { set: CosmeticSet; className?: string }) {
  const info = COSMETIC_SET_INFO[set];
  return (
    <CosmeticCanvas
      kind="thumb"
      set={set}
      fps={30}
      className={cn('h-full w-full', className)}
      style={{ background: `linear-gradient(135deg, ${info.from}, ${info.to})` }}
    />
  );
}

/**
 * Tam ekran pencerenin kökü için ref: pencere açıkken altında kalan hareketli kozmetikler (üye listesi,
 * profil kartı) çizilmez; pencerenin içindekiler (ayarlardaki seçici) çizilir.
 */
export function useCosmeticsCover(): (el: HTMLElement | null) => void {
  const current = useRef<HTMLElement | null>(null);
  return useCallback((el: HTMLElement | null) => {
    if (current.current) setCosmeticsCover(current.current, false);
    current.current = el;
    if (el) setCosmeticsCover(el, true);
  }, []);
}
