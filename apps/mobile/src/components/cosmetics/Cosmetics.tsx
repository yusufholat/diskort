import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PixelRatio, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useIsFocused } from 'expo-router';
import type { CosmeticSet } from '@diskort/shared';
import { COSMETIC_SET_INFO, type ShaderViewKind } from '@diskort/client-core';
import { attachView, onScreen, type ViewHandle } from './engine';
import type { CardGeo } from './layers';
import { hasSkia, skia } from './skia';

// Hareketli kozmetiklerin React bileşenleri (masaüstündeki Cosmetics.tsx'in karşılığı): hepsi tek motora
// (engine.ts) bağlanan yerel Skia yüzeyleridir. Skia'nın yerel modülü olmayan uygulamada hiçbiri çizilmez
// (küçük avatarlardaki sabit halka dışında: o düz bir görünümdür).

export type { CardGeo } from './layers';
export { hasSkia } from './skia';

/** Avatarın bu boydan küçüğünde (mesajlar, listeler) hareketli dekorasyon yerine sabit, ucuz bir halka */
export const ANIMATED_DECORATION_MIN_SIZE = 64;
/** Dekorasyon yüzeyi avatarın dış yarıçapının bu katı (vitrin: 46 piksellik yarıçapa 132 piksel) */
const DECORATION_CANVAS_SCALE = 132 / 46;

/**
 * Bu boydaki avatarın hareketli dekorasyon yüzeyinin kenarı (avatarla aynı merkezde, ondan büyük). Küçük
 * avatarda sabit halka avatarın içinde kaldığından avatarın kendisi. Yerleşimde dekorasyona yer ayırmak için.
 */
export const decorationCanvasSize = (size: number): number =>
  size >= ANIMATED_DECORATION_MIN_SIZE ? Math.round((size / 2) * 1.15 * DECORATION_CANVAS_SCALE) : size;
/**
 * Yüzeyin en fazla piksel yoğunluğu (css pikseli başına): telefonların 3× ekranında tam çözünürlük
 * gereksiz yük (masaüstünde de 2× ile sınırlı). Profil kartı büyük: gölgelendiricisi daha düşük yoğunlukta
 * çizilir (masaüstünde 0,75 kat), ayrıntılar yumuşak ışık olduğundan fark edilmez.
 */
const DENSITY_CAP = 2;
const CARD_DENSITY_CAP = 1.6;

const resolution = (cap: number): number => Math.min(1, cap / PixelRatio.get());

interface SurfaceProps {
  kind: ShaderViewKind;
  set: CosmeticSet;
  R?: number;
  fps?: number;
  paused?: boolean;
  /** Sabit tek kare (seçicide seçili olmayan seçenek) */
  still?: boolean;
  lite?: boolean;
  /** En fazla piksel yoğunluğu (verilmezse DENSITY_CAP) */
  density?: number;
  geo?: CardGeo;
  style?: StyleProp<ViewStyle>;
}

/** Skia yoksa hiçbir şey; varsa motora bağlı yüzey */
function CosmeticSurface(props: SurfaceProps) {
  return hasSkia() ? (
    <SurfaceBoundary>
      <SkiaSurface {...props} />
    </SurfaceBoundary>
  ) : null;
}

/** Süs çizilemezse (beklenmeyen bir hata) yalnızca süs kaybolur: kart, satır ve ekran çalışmaya devam eder */
class SurfaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(err: unknown): void {
    console.warn('[kozmetik] yüzey çizilemedi:', err);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function SkiaSurface({ kind, set, R, fps, paused, still, lite, density, geo, style }: SurfaceProps) {
  const { SkiaPictureView } = skia()!;
  const box = useRef<View>(null);
  const picture = useRef<InstanceType<typeof SkiaPictureView>>(null);
  const handle = useRef<ViewHandle | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const focused = useIsFocused();
  const k = resolution(density ?? DENSITY_CAP);

  // Görünümün türü değişmez (değişirse bileşen yeniden kurulur); set ve ölçüler sonradan güncellenir
  useLayoutEffect(() => {
    const nativeId = picture.current?.nativeId;
    if (nativeId === undefined) return;
    const h = attachView(nativeId, {
      kind,
      set,
      R,
      fps,
      paused,
      still,
      lite,
      scale: k,
      focused,
      geo,
      measure: (done) => box.current?.measureInWindow((x, y, w, hh) => done(onScreen(x, y, w, hh))),
    });
    handle.current = h;
    return () => {
      h.dispose();
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  useEffect(() => {
    handle.current?.update({ set, R, fps, paused, still, lite, scale: k, focused, geo, w: size.w, h: size.h });
  }, [set, R, fps, paused, still, lite, k, focused, geo, size]);

  return (
    <View
      ref={box}
      collapsable={false}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
      }}
    >
      {/* Yüzey k katı küçük çizilir, sol üstten büyütülerek kutuyu kaplar */}
      <SkiaPictureView
        ref={picture}
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: size.w * k,
          height: size.h * k,
          transformOrigin: 'left top',
          transform: [{ scale: 1 / k }],
        }}
      />
    </View>
  );
}

/** Profil kartının tamamını saran set efekti (kartın en üstünde, dokunmaları engellemez) */
export function CardEffect({ set, geo, fps }: { set: CosmeticSet; geo: CardGeo | null; /** ör. ayarlardaki önizlemede 30 */ fps?: number }) {
  if (!geo) return null;
  // Karadelik kartı en ağır gölgelendirici: telefonda gürültünün bir katmanı atlanır
  return <CosmeticSurface kind="card" set={set} geo={geo} fps={fps} density={CARD_DENSITY_CAP} lite={set === 'karadelik'} style={StyleSheet.absoluteFill} />;
}

/**
 * Hareketli avatar dekorasyonu. Profil boyundaki avatarda (≥ 64 piksel) ya da `animate` ile canlı yüzey;
 * küçük avatarda (mesajlar, üye listesi) sabit bir halka: onlarca satır yüzey açmasın.
 */
export function AnimatedDecoration({
  set,
  size,
  animate,
  lite,
  still,
}: {
  set: CosmeticSet;
  size: number;
  animate?: boolean;
  /**
   * Hafif mod (sesli sahne: katılımcı sayısı kadar yüzey, ses ile yarışır): 24 kare/sn, düşük çözünürlük;
   * 'paused' ise son kare sabit kalır (konuşmuyor)
   */
  lite?: 'on' | 'paused';
  /** Sabit tek kare (seçicide seçili olmayan seçenek) */
  still?: boolean;
}) {
  if (!hasSkia() || (!animate && size < ANIMATED_DECORATION_MIN_SIZE)) return <StaticDecorationRing set={set} size={size} />;
  // Avatarın dış yarıçapı (profil kartında 80 piksellik avatar + 6 piksellik halka = 46)
  const R = (size / 2) * 1.15;
  const box = Math.round(R * DECORATION_CANVAS_SCALE);
  const off = (size - box) / 2;
  return (
    <CosmeticSurface
      kind="deco"
      set={set}
      R={R}
      fps={lite ? 24 : animate && size < ANIMATED_DECORATION_MIN_SIZE ? 30 : undefined}
      paused={lite === 'paused'}
      still={still}
      density={lite ? DENSITY_CAP * 0.75 : undefined}
      style={{ left: off, top: off, width: box, height: box }}
    />
  );
}

/** Küçük avatarlarda setin renklerinde ince halka */
export function StaticDecorationRing({ set, size }: { set: CosmeticSet; size: number }) {
  const info = COSMETIC_SET_INFO[set];
  const w = size >= 40 ? 2.5 : 2;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: -w,
        top: -w,
        width: size + 2 * w,
        height: size + 2 * w,
        borderRadius: size,
        borderWidth: w,
        borderColor: info.accent,
        boxShadow: `0 0 ${w * 2}px ${info.accent}55`,
      }}
    />
  );
}

/**
 * Üye listesi satırının arkasındaki isim plakası (satırın ilk çocuğu olmalı: yazılar üstünde kalır).
 * Satır başına bir yüzey olduğundan 30 kare/sn: yavaş hareketli zeminde fark edilmez, yük yarıya iner.
 */
export function NameplateBackground({ set, still }: { set: CosmeticSet; still?: boolean }) {
  return <CosmeticSurface kind="plate" set={set} fps={30} still={still} style={StyleSheet.absoluteFill} />;
}

/** Seçici kutusundaki küçük resim (30 kare/sn yeter) */
export function SetThumb({ set, still, style }: { set: CosmeticSet; still?: boolean; style?: StyleProp<ViewStyle> }) {
  const info = COSMETIC_SET_INFO[set];
  const gradient = `linear-gradient(135deg, ${info.from}, ${info.to})`;
  return (
    <View style={style}>
      {/* Degrade ayrı görünümde: set değişince o yeniden kurulur (Android'de deneysel özellik yerinde güncellenmesin; #28),
          Skia yüzeyi kurulu kalır */}
      <View key={gradient} style={[StyleSheet.absoluteFill, { experimental_backgroundImage: gradient }]} />
      <CosmeticSurface kind="thumb" set={set} fps={30} still={still} style={StyleSheet.absoluteFill} />
    </View>
  );
}

/** "#rrggbb" rengi beyaza doğru açar (t: rengin payı) */
function towardWhite(color: string, t: number): string | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  const ch = (shift: number): string =>
    Math.round(((n >> shift) & 255) * t + 255 * (1 - t))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/**
 * İsim plakalı satırda rol renginin yazısı: plaka koyu olduğundan renk beyaza doğru açılır (koyu rol renkleri
 * okunur kalsın, ton korunur). Renk yoksa beyaz.
 */
export const nameplateNameColor = (color: string | null | undefined): string =>
  (color && towardWhite(color, 0.6)) || '#ffffff';

/** Plakanın üstündeki yazıların gölgesi (masaüstündeki .nameplate-text gibi) */
export const NAMEPLATE_TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.85)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

const styles = StyleSheet.create({
  box: { position: 'absolute', overflow: 'hidden' },
});
