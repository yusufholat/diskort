import { Component, memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Image, PixelRatio, Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useIsFocused } from 'expo-router';
import type { CosmeticPack, CosmeticPiece, CosmeticSetId } from '@diskort/shared';
import { cosmeticPacks, useCosmeticPacks, type ResolvedCosmeticAsset } from '@diskort/client-core';
import type { SkRuntimeEffect } from '@shopify/react-native-skia';
import type { Frame } from './packDriver';
import {
  ANIMATED_DECORATION_MIN_SIZE,
  cardEffectBox,
  decorationBox,
  isStackedLayout,
  plateBox,
  STACKED_ALPHA_SKSL,
  stackedUniforms,
  surfaceScale,
  withAlpha,
} from './packLayout';
import type { PlaybackHandle, PlayerSpec } from './packPlayer';
import { pieceSource, type PhoneOS, type PieceSource } from './packSource';
import { onScreen, playback } from './playback';
import { reportCosmeticError } from './report';
import { skia, useHasSkia } from './skia';

// Hareketli kozmetiklerin React bileşenleri. Setler telefonda kodla çizilmez: sunucudan inen paketin dosyaları
// oynatılır (bkz. docs/kozmetik-paketleri.md). Her parçanın altında sabit resmi (poster: düz bir <Image>) durur;
// parça ekrandayken, ekranı odaktayken ve hareket serbestken üstüne paylaşılan oynatıcının karesini çizen bir
// Skia yüzeyi gelir (packPlayer.ts / packDriver.ts). Paket bu platformda kapalıysa setin renklerinden sabit bir
// görünüm, set bildirimde yoksa hiçbir şey gösterilir. Skia'nın yerel modülü olmayan uygulamada kozmetikler
// gösterilmez (küçük avatarlardaki sabit halka dışında: o düz bir görünümdür).

export { hasSkia, useHasSkia } from './skia';
export { ANIMATED_DECORATION_MIN_SIZE, CARD_BANNER_RATIO, decorationCanvasSize } from './packLayout';

const OS: PhoneOS = Platform.OS === 'ios' ? 'ios' : 'android';

/** Saydam parçada canlı yüzey belirdikten bu kadar sonra (ms) altındaki sabit resim gizlenir (arada boşluk olmasın) */
const SETTLE_MS = 120;

/** Setin bir parçasının kaynağı; bildirim değişince yeniden hesaplanır */
function usePieceSource(set: CosmeticSetId | null | undefined, piece: CosmeticPiece): PieceSource {
  const manifest = useCosmeticPacks((s) => s.manifest);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => pieceSource(cosmeticPacks, set, piece, OS), [manifest, set, piece]);
}

/** Bu set bu parçada gösteriliyor mu (bildirimde var ve uygulama çizebiliyor): yerleşim ve yazı renkleri için */
function usePieceShown(set: CosmeticSetId | null | undefined, piece: CosmeticPiece): boolean {
  const source = usePieceSource(set, piece);
  return useHasSkia() && source.kind !== 'none';
}

/** Kartta set efekti gösteriliyor mu (afiş, efektin varsaydığı yükseklikte kurulur) */
export const useCardEffectShown = (set: CosmeticSetId | null | undefined): boolean => usePieceShown(set, 'card');

/** Satırda isim plakası gösteriliyorsa setin kimliği; değilse null (satır eskisi gibi kalır) */
export function useNameplateShown(set: CosmeticSetId | null | undefined): CosmeticSetId | null {
  return usePieceShown(set, 'plate') && set ? set : null;
}

// ---------- Oynatma ----------

const IDLE: { live: boolean; frame: Frame | null } = { live: false, frame: null };

const specOf = (asset: ResolvedCosmeticAsset, info: CosmeticPack): PlayerSpec => ({
  url: asset.url,
  kind: asset.kind === 'stacked-h264' ? 'video' : 'image',
  bytes: asset.bytes,
  fps: info.fps,
  frames: Math.max(1, Math.round(info.loopSeconds * info.fps)),
});

/**
 * Görünümü dosyanın paylaşılan oynatıcısına bağlar. Canlıyken (`live`) oynatıcının karesi çizilir; değilken
 * (ekran dışında, odak dışında, durdurulmuş, "hareketi azalt" açık, dosya henüz hazır değil) sabit resim.
 */
function usePlayback(asset: ResolvedCosmeticAsset | null, info: CosmeticPack, paused: boolean, box: RefObject<View | null>) {
  const focused = useIsFocused();
  const [state, setState] = useState(IDLE);
  const handle = useRef<PlaybackHandle | null>(null);
  const latest = useRef({ focused, paused, asset, info });
  latest.current = { focused, paused, asset, info };
  const url = asset?.url ?? null;

  useEffect(() => {
    const current = latest.current;
    if (!url || !current.asset) return;
    let attached: PlaybackHandle;
    try {
      attached = playback().attach(specOf(current.asset, current.info), {
        focused: current.focused,
        paused: current.paused,
        measure: (done) => box.current?.measureInWindow((x, y, w, h) => done(onScreen(x, y, w, h))),
        onChange: setState,
      });
    } catch (err) {
      reportCosmeticError('oynatıcı', err);
      return;
    }
    handle.current = attached;
    return () => {
      handle.current = null;
      attached.dispose();
      setState(IDLE);
    };
  }, [url, box]);

  useEffect(() => {
    handle.current?.update({ focused, paused });
  }, [focused, paused]);

  return { ...state, remeasure: () => handle.current?.remeasure() };
}

/** `on` olduktan SETTLE_MS sonra true; kapanınca hemen false */
function useSettled(on: boolean): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!on) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [on]);
  return on && settled;
}

// ---------- Canlı yüzey (Skia) ----------

let stacked: { effect: SkRuntimeEffect | null } | null = null;

/** Yan yana videonun birleştirme gölgelendiricisi (bir kez derlenir); derlenemezse null */
function stackedEffect(): SkRuntimeEffect | null {
  if (stacked) return stacked.effect;
  let effect: SkRuntimeEffect | null = null;
  try {
    effect = skia()?.Skia.RuntimeEffect.Make(STACKED_ALPHA_SKSL) ?? null;
    if (!effect) reportCosmeticError('gölgelendirici', new Error('yan yana video gölgelendiricisi derlenemedi'));
  } catch (err) {
    reportCosmeticError('gölgelendirici', err);
  }
  stacked = { effect };
  return effect;
}

interface LiveProps {
  asset: ResolvedCosmeticAsset;
  frame: Frame;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Görünen yükseklik (kısa kartta efektin altı kırpılır) */
  visibleHeight: number;
}

/**
 * Oynatıcının karesini çizen Skia yüzeyi. Kare paylaşılan değerdir: değişince yüzey arayüz iş parçacığında
 * kendiliğinden boyanır, React yeniden çizilmez. Yüzey dosyanın pikselinden fazlasını çizmez (küçük kurulup
 * sol üstten büyütülür).
 */
const LiveCanvas = memo(function LiveCanvas({ asset, frame, left, top, width, height, visibleHeight }: LiveProps) {
  const sk = skia();
  const k = surfaceScale(asset.width, width, PixelRatio.get());
  const w = width * k;
  const h = height * k;
  const layout = asset.kind === 'stacked-h264' && isStackedLayout(asset) ? asset : null;
  const uniforms = useMemo(() => (layout ? { ...stackedUniforms(layout, w, h) } : null), [layout, w, h]);
  const effect = asset.kind === 'stacked-h264' ? stackedEffect() : null;
  if (!sk) return null;
  if (asset.kind === 'stacked-h264' && (!effect || !uniforms)) throw new Error('yan yana video çizilemiyor');
  const { Canvas, Image: SkiaImage, ImageShader, Rect, Shader } = sk;
  return (
    <Canvas
      pointerEvents="none"
      style={{
        position: 'absolute',
        left,
        top,
        width: w,
        height: visibleHeight * k,
        transformOrigin: 'left top',
        transform: [{ scale: 1 / k }],
      }}
    >
      {effect && uniforms ? (
        <Rect x={0} y={0} width={w} height={h}>
          <Shader source={effect} uniforms={uniforms}>
            <ImageShader image={frame} />
          </Shader>
        </Rect>
      ) : (
        <SkiaImage image={frame} x={0} y={0} width={w} height={h} fit="fill" />
      )}
    </Canvas>
  );
});

/** Yüzey çizilemezse (beklenmeyen bir hata) yalnızca canlı yüzey kalkar: sabit resim, kart, satır ve ekran kalır */
class LiveBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(err: unknown): void {
    reportCosmeticError('yüzey', err);
    this.props.onFail();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

// ---------- Parça ----------

interface PieceProps {
  info: CosmeticPack;
  asset: ResolvedCosmeticAsset | null;
  poster: ResolvedCosmeticAsset | null;
  /** Resmin kutusu, kapsayıcının sol üstüne göre */
  left: number;
  top: number;
  width: number;
  height: number;
  visibleHeight?: number;
  paused?: boolean;
  /** Saydam olmayan parça (isim plakası): sabit resim canlı yüzeyin altında kalır */
  opaque?: boolean;
  /** Kapsayıcının yeri ve boyu */
  style?: StyleProp<ViewStyle>;
  onSize?: (width: number, height: number) => void;
  children?: ReactNode;
}

/** Paketin bir parçası: altta sabit resim, canlıyken üstünde oynatıcının karesi. Dokunmaları engellemez. */
function PackPiece({ info, asset, poster, left, top, width, height, visibleHeight, paused, opaque, style, onSize, children }: PieceProps) {
  const box = useRef<View>(null);
  const [broken, setBroken] = useState(false);
  const canPlay = useHasSkia() && !broken;
  const { live, frame, remeasure } = usePlayback(canPlay ? asset : null, info, Boolean(paused), box);
  const drawable = width >= 1 && height >= 1;
  const showLive = live && frame !== null && asset !== null && canPlay && drawable;
  const settled = useSettled(showLive);
  const onLayout = (e: LayoutChangeEvent): void => {
    const { width: w, height: h } = e.nativeEvent.layout;
    onSize?.(w, h);
    remeasure();
  };
  return (
    <View
      ref={box}
      collapsable={false}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, style]}
      onLayout={onLayout}
    >
      {poster && drawable && (
        <Image
          source={{ uri: poster.url }}
          style={[{ position: 'absolute', left, top, width, height }, !opaque && settled && styles.hidden]}
          resizeMode="stretch"
          fadeDuration={0}
          accessibilityIgnoresInvertColors
        />
      )}
      {showLive && (
        <LiveBoundary onFail={() => setBroken(true)}>
          <LiveCanvas asset={asset} frame={frame} left={left} top={top} width={width} height={height} visibleHeight={visibleHeight ?? height} />
        </LiveBoundary>
      )}
      {children}
    </View>
  );
}

function useSize(): [{ w: number; h: number }, (w: number, h: number) => void] {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return [size, (w, h) => setSize((s) => (s.w === w && s.h === h ? s : { w, h }))];
}

// ---------- Profil kartı efekti ----------

/**
 * Profil kartının tamamını saran set efekti: kartın genişliğine ölçeklenir, üste yaslanır (600×900'lük dosya);
 * kısa kart altını kırpar, uzun kartta efekt aşağıda söner. Kartın içeriğinin üstünde, avatarın altında durur
 * (bkz. ProfileHeader) ve dokunmaları engellemez.
 */
export function CardEffect({ set }: { set: CosmeticSetId }) {
  const source = usePieceSource(set, 'card');
  const [size, onSize] = useSize();
  if (!useHasSkia() || source.kind === 'none') return null;
  if (source.kind === 'static') return <CardStaticGlow info={source.info} />;
  const file = source.asset ?? source.poster;
  if (!file) return null;
  const box = cardEffectBox(size.w, size.h, file.width, file.height);
  return (
    <PackPiece
      info={source.info}
      asset={source.asset}
      poster={source.poster}
      left={0}
      top={0}
      width={box.width}
      height={box.height}
      visibleHeight={box.visibleHeight}
      style={StyleSheet.absoluteFill}
      onSize={onSize}
    />
  );
}

/** Paket bu platformda kapalıyken kartta: afişin üstünde setin parıltı renginde hafif bir ışık */
function CardStaticGlow({ info }: { info: CosmeticPack }) {
  const glow = info.fallback[2];
  const gradient = `linear-gradient(200deg, ${glow} 0%, ${withAlpha(glow, 0) ?? 'rgba(0,0,0,0)'} 70%)`;
  // Degradeli görünüme kenarlık verilmez ve degrade yerinde güncellenmez (Android; #28, #29)
  return <View key={gradient} pointerEvents="none" style={[styles.cardGlow, { experimental_backgroundImage: gradient }]} />;
}

// ---------- Avatar dekorasyonu ----------

/**
 * Hareketli avatar dekorasyonu: avatarla aynı merkezde, ondan büyük bir kare. Profil boyundaki avatarda (≥ 64
 * piksel) ya da `animate` ile oynar; küçük avatarda (mesajlar, üye listesi) sabit bir halka: onlarca satır yüzey
 * açmasın.
 */
export function AnimatedDecoration({
  set,
  size,
  animate,
  lite,
  still,
}: {
  set: CosmeticSetId;
  size: number;
  animate?: boolean;
  /** Sesli sahne: 'paused' ise sabit resim (konuşmuyor), 'on' ise oynar */
  lite?: 'on' | 'paused';
  /** Sabit resim (seçicide seçili olmayan seçenek) */
  still?: boolean;
}) {
  const source = usePieceSource(set, 'deco');
  const animated = useHasSkia() && (animate || size >= ANIMATED_DECORATION_MIN_SIZE);
  if (source.kind === 'none') return null;
  if (source.kind === 'static' || !animated) return <StaticDecorationRing accent={source.info.accent} size={size} />;
  const box = decorationBox(size);
  const off = (size - box) / 2;
  return (
    <PackPiece
      info={source.info}
      asset={source.asset}
      poster={source.poster}
      left={0}
      top={0}
      width={box}
      height={box}
      paused={still || lite === 'paused'}
      style={{ left: off, top: off, width: box, height: box }}
    />
  );
}

/** Küçük avatarlarda (ve paket oynatılmıyorken) setin vurgu renginde ince halka */
export function StaticDecorationRing({ accent, size }: { accent: string; size: number }) {
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
        borderColor: accent,
        boxShadow: `0 0 ${w * 2}px ${accent}55`,
      }}
    />
  );
}

// ---------- İsim plakası ----------

/**
 * Üye listesi satırının arkasındaki isim plakası (satırın ilk çocuğu olmalı: yazılar üstünde kalır). Resim satırın
 * yüksekliğinde, sağa yaslıdır; solda kalan kısım plakanın koyu rengiyle dolar ve resmin sol kenarı o renge
 * karışır (resmin solu zaten koyudur: avatar, ad ve durumun altı sakin kalır).
 */
export function NameplateBackground({ set, still }: { set: CosmeticSetId; still?: boolean }) {
  const source = usePieceSource(set, 'plate');
  const [size, onSize] = useSize();
  if (!useHasSkia() || source.kind === 'none') return null;
  const dark = source.info.fallback[0];
  if (source.kind === 'static') return <PlateStatic info={source.info} />;
  const file = source.asset ?? source.poster;
  if (!file) return null;
  const box = plateBox(size.w, size.h, file.width, file.height);
  const blend = `linear-gradient(90deg, ${dark} 0%, ${withAlpha(dark, 0) ?? 'rgba(0,0,0,0)'} 100%)`;
  return (
    <PackPiece
      info={source.info}
      asset={source.asset}
      poster={source.poster}
      left={box.left}
      top={0}
      width={box.width}
      height={box.height}
      paused={still}
      opaque
      style={[StyleSheet.absoluteFill, { backgroundColor: dark }]}
      onSize={onSize}
    >
      {box.blend > 0 && (
        <View
          key={blend}
          style={{ position: 'absolute', left: box.left - 1, top: 0, bottom: 0, width: box.blend + 1, experimental_backgroundImage: blend }}
        />
      )}
    </PackPiece>
  );
}

/** Paket bu platformda kapalıyken plaka: koyu zemin, setin rengi yalnızca sağda */
function PlateStatic({ info }: { info: CosmeticPack }) {
  const [dark, color] = info.fallback;
  const gradient = `linear-gradient(90deg, ${withAlpha(color, 0) ?? 'rgba(0,0,0,0)'} 30%, ${color} 100%)`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: dark }]}>
      <View key={gradient} style={[StyleSheet.absoluteFill, styles.plateTint, { experimental_backgroundImage: gradient }]} />
    </View>
  );
}

// ---------- Seçici ----------

/** Seçici kutusundaki küçük resim: setin degradesi, üstünde kart efektinin sabit resminin üst kısmı */
export function SetThumb({ set, style }: { set: CosmeticSetId; style?: StyleProp<ViewStyle> }) {
  const source = usePieceSource(set, 'card');
  const [size, onSize] = useSize();
  if (source.kind === 'none') return <View style={style} />;
  const { info } = source;
  const gradient = `linear-gradient(135deg, ${info.from}, ${info.to})`;
  const poster = source.kind === 'pack' ? source.poster : null;
  return (
    <View style={[style, styles.thumb]} onLayout={(e) => onSize(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}>
      {/* Degrade ayrı görünümde: set değişince o yeniden kurulur (Android'de deneysel özellik yerinde güncellenmesin; #28) */}
      <View key={gradient} style={[StyleSheet.absoluteFill, { experimental_backgroundImage: gradient }]} />
      {poster && size.w > 0 && (
        <Image
          source={{ uri: poster.url }}
          style={{ position: 'absolute', left: 0, top: 0, width: size.w, height: (size.w * poster.height) / poster.width }}
          resizeMode="stretch"
          fadeDuration={0}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

// ---------- İsim plakasının üstündeki yazılar ----------

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
  hidden: { opacity: 0 },
  // Efektin varsaydığı afişin (genişliğin 6/17'si) biraz altına kadar
  cardGlow: { position: 'absolute', left: 0, right: 0, top: 0, aspectRatio: 17 / (6 * 1.6), opacity: 0.9 },
  plateTint: { opacity: 0.75 },
  thumb: { overflow: 'hidden' },
});
