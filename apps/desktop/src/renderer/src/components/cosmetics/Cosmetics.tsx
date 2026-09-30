import { createContext, memo, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { create } from 'zustand';
import type { CosmeticPack, CosmeticPiece, CosmeticSetId } from '@diskort/shared';
import {
  cosmeticPacks,
  cosmeticSetInfo,
  isKnownCosmeticSet,
  selectableCosmeticSets,
  useCosmeticPacks,
} from '@diskort/client-core';
import { useReducedMotion } from '../../lib/motion';
import { cn } from '../../lib/utils';
import {
  ANIMATED_DECORATION_MIN_SIZE,
  decorationBox,
  pickSource,
  PLATE_BLEND_PX,
  resolvePiece,
  staticCardBackground,
  staticPlateBackground,
  staticRingStyle,
  staticThumbBackground,
  type PieceSource,
  type PieceView,
} from './pieces';

// Hareketli kozmetiklerin React bileşenleri. Her parça sunucudan inen paketin bir dosyasıdır ve düz bir
// <img> ile oynatılır (hareketli AVIF, yoksa WebP): tuval, WebGL, video ya da kare başına çalışan kod yok.
// Aynı adresi gösteren bütün <img>'ler tarayıcıda tek bir çözülmüş resmi paylaşır; ekranda olmayan resim
// ve gizli pencere oynatılmaz. Set bildirimde yoksa hiçbir şey çizilmez; paketi bu istemcide oynatılmıyorsa
// setin bilgi renklerinden sabit bir görünüm çizilir (bkz. pieces.ts).

export { nameplateNameColor } from './pieces';

// ---------- Depoya bağlı kancalar ----------

/** Kimlik bildirimde varsa kendisi, yoksa null (tanınmayan set gösterilmez; bildirim gelince yeniden çizilir) */
export function useKnownCosmeticSet(id: CosmeticSetId | null | undefined): CosmeticSetId | null {
  return useCosmeticPacks((s) => (isKnownCosmeticSet(s.manifest, id) ? id : null));
}

/** Setin bilgisi (ad, renkler, açıklamalar); set bildirimde yoksa null */
export function useCosmeticSetInfo(id: CosmeticSetId | null | undefined): CosmeticPack | null {
  return useCosmeticPacks((s) => cosmeticSetInfo(s.manifest, id));
}

/** Seçicide gösterilecek setler, bildirimdeki sırayla (bildirim yoksa boş) */
export function useSelectableCosmeticSets(): CosmeticPack[] {
  const manifest = useCosmeticPacks((s) => s.manifest);
  return useMemo(
    () =>
      selectableCosmeticSets(manifest).flatMap((id) => {
        const info = cosmeticSetInfo(manifest, id);
        return info ? [info] : [];
      }),
    [manifest],
  );
}

function usePiece(id: CosmeticSetId | null | undefined, piece: CosmeticPiece): PieceView | null {
  // Seçiciler depodaki güncel bildirimi okur: bildirim değişince yeniden hesaplanır
  const manifest = useCosmeticPacks((s) => s.manifest);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => resolvePiece(cosmeticPacks, id, piece), [manifest, id, piece]);
}

// ---------- Örtüler ----------

// Tam ekran pencereler (Ayarlar, Sunucu Ayarları) açıkken altlarında kalan parçalar (üye listesi plakaları,
// profil kartı) ekranda görünmese de tarayıcıya göre görünürdür ve oynamaya devam eder: pencere kendini örtü
// olarak bildirir, dışında kalan parçalar posterde durur; içindekiler (ayarlardaki seçici) oynar.

const useCovers = create<{ count: number }>(() => ({ count: 0 }));
const InsideCover = createContext(false);

/** Tam ekran pencerenin içeriğini sarar: açıkken dışarıdaki hareketli kozmetikler durur */
export function CosmeticsCover({ children }: { children: ReactNode }) {
  useEffect(() => {
    useCovers.setState((s) => ({ count: s.count + 1 }));
    return () => useCovers.setState((s) => ({ count: s.count - 1 }));
  }, []);
  return <InsideCover.Provider value={true}>{children}</InsideCover.Provider>;
}

function useCovered(): boolean {
  const inside = useContext(InsideCover);
  const covering = useCovers((s) => s.count > 0);
  return covering && !inside;
}

// ---------- Parçanın resmi ----------

/** Bu oturumda tamamı yüklenmiş hareketli dosyalar: yeniden gösterilirken önce posteri beklemeye gerek yok */
const loadedUrls = new Set<string>();
const NO_FAILURES: readonly string[] = [];

interface PieceImage {
  /** Gösterilecek dosya; null ise sabit görünüm */
  source: PieceSource | null;
  /** Resmin kendi ölçüleri (yer tutar: yüklenene kadar yerleşim oynamaz) */
  width: number;
  height: number;
  onLoad: () => void;
  onError: () => void;
}

/**
 * Parçanın <img>'sinde gösterilecek dosya ve yükleme olayları. Önce poster gösterilir, yüklenince hareketli
 * dosyaya geçilir (o yüklenene kadar tarayıcı posteri göstermeyi sürdürür). "Hareketi azalt" açıkken,
 * `paused` iken ve tam ekran bir pencerenin altında kalınca poster. Yüklenemeyen dosyadan postere, o da
 * yüklenemezse sabit görünüme düşülür (kırık resim simgesi hiç görünmez).
 */
function usePieceImage(view: PieceView | null, paused = false): PieceImage {
  const reduced = useReducedMotion();
  const covered = useCovered();
  const anim = view?.anim?.url ?? null;
  const poster = view?.poster?.url ?? null;
  // Posteri gösterilmiş hareketli dosya (adres değişince, ör. önizlemede başka set, yeniden posterden başlanır)
  const [primedFor, setPrimedFor] = useState<string | null>(null);
  const [failed, setFailed] = useState(NO_FAILURES);
  const primed = anim !== null && (primedFor === anim || loadedUrls.has(anim));
  const source = pickSource({ anim, poster }, { still: reduced || covered || paused, primed, failed });
  const asset = view?.anim ?? view?.poster;
  return {
    source,
    width: asset?.width ?? 0,
    height: asset?.height ?? 0,
    onLoad: () => {
      if (!source) return;
      if (source.animated) loadedUrls.add(source.url);
      else if (anim) setPrimedFor(anim);
    },
    onError: () => {
      if (source) setFailed((f) => (f.includes(source.url) ? f : [...f, source.url]));
    },
  };
}

function PieceImg({ image, className, style }: { image: PieceImage; className?: string; style?: CSSProperties }) {
  if (!image.source) return null;
  return (
    <img
      src={image.source.url}
      width={image.width}
      height={image.height}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
      className={cn('pointer-events-none max-w-none select-none', className)}
      style={style}
      onLoad={(e) => {
        e.currentTarget.style.visibility = '';
        image.onLoad();
      }}
      // Ölçüsü belli <img> yüklenemeyince tarayıcı kırık resim simgesi çizer: sıradaki dosya yüklenene (ya da
      // sabit görünüme geçilene) kadar resim hemen gizlenir
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden';
        image.onError();
      }}
    />
  );
}

// ---------- Parçalar ----------

/**
 * Profil kartının efekti: kartın tamamını kaplayan, tıklamaları engellemeyen katman (kart `relative` olmalı).
 * Resim standart tuvaldir (2:3): kartın genişliğine ölçeklenir ve üstüne yaslanır; kısa kartta altı kırpılır,
 * uzun kartta resim alt kenarında zaten sönerek biter. Avatarın yerini bilmez: avatar bu katmanın üstünde
 * çizilmelidir (bkz. ProfileCardTop).
 */
export const CardEffect = memo(function CardEffect({
  id,
  className,
}: {
  id: CosmeticSetId | null | undefined;
  /** Kart taşanı kırpmıyorsa katmanın köşeleri (ör. rounded-lg) */
  className?: string;
}) {
  const view = usePiece(id, 'card');
  const image = usePieceImage(view);
  if (!view) return null;
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 z-[1] overflow-hidden', className)}
      style={image.source ? undefined : { background: staticCardBackground(view.info) }}
    >
      <PieceImg image={image} className="block h-auto w-full" />
    </div>
  );
});

/**
 * Hareketli avatar dekorasyonu: avatarın ortasına oturan kare resim (avatar `relative` olmalı). Profil
 * boyundaki avatarda (≥ 64 piksel) ya da `animate` ile paket oynar; küçük avatarda (mesajlar, üye listesi)
 * sabit, yalnızca CSS'ten bir halka.
 */
export function AvatarDecoration({
  id,
  size,
  animate,
  paused,
}: {
  id: CosmeticSetId;
  /** Avatarın kenarı (css px) */
  size: number;
  /** Küçük avatarda da oynasın (ayarlardaki seçici) */
  animate?: boolean;
  /** Durdurulmuş: poster gösterilir (ör. sesli sahnede konuşmayan katılımcı) */
  paused?: boolean;
}) {
  const view = usePiece(id, 'deco');
  const live = animate || size >= ANIMATED_DECORATION_MIN_SIZE;
  const image = usePieceImage(live ? view : null, paused);
  if (!view) return null;
  if (!image.source) {
    return <span aria-hidden className="pointer-events-none absolute rounded-full" style={staticRingStyle(view.info, size)} />;
  }
  const { box, offset } = decorationBox(size);
  return <PieceImg image={image} className="absolute" style={{ left: offset, top: offset, width: box, height: box }} />;
}

/**
 * Üye listesi satırının arkasındaki isim plakası (satır `relative isolate` olmalı: plaka yazıların altında
 * kalır). Resim satırın yüksekliğinde ve sağa yaslıdır; satır resimden genişse solda kalan yer plakanın koyu
 * rengiyle dolar ve resmin sol kenarı bu renge karışır (ek yeri görünmez), darsa resmin solu kırpılır.
 */
export function Nameplate({ id, className }: { id: CosmeticSetId; className?: string }) {
  const view = usePiece(id, 'plate');
  const image = usePieceImage(view);
  if (!view) return null;
  const fill = view.info.fallback[0];
  // Üstte ve altta 1 piksel boşluk, yuvarlak köşe: art arda plakalı satırlar birbirine yapışmaz
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-px left-0 -z-10 block h-[calc(100%-2px)] w-full overflow-hidden rounded-md',
        className,
      )}
      style={{ background: image.source ? fill : staticPlateBackground(view.info) }}
    >
      {image.source && (
        <span
          className="absolute top-0 right-0 block h-full min-w-0"
          style={{ aspectRatio: `${image.width} / ${image.height}` }}
        >
          <PieceImg image={image} className="block h-full w-full" />
          <span
            className="absolute inset-y-0 left-0 block"
            style={{ width: PLATE_BLEND_PX, background: `linear-gradient(to right, ${fill}, transparent)` }}
          />
        </span>
      )}
    </span>
  );
}

/**
 * Seçici kutusundaki küçük resim (kutu `relative` olmalı): setin degradesinin üstünde profil efektinin üst
 * kısmı. `paused` iken poster (kutunun üstüne gelinmediyse).
 */
export function SetThumb({ id, paused, className }: { id: CosmeticSetId; paused?: boolean; className?: string }) {
  const view = usePiece(id, 'card');
  const image = usePieceImage(view, paused);
  if (!view) return null;
  return (
    <span
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 block overflow-hidden', className)}
      style={{
        background: image.source
          ? `linear-gradient(135deg, ${view.info.from}, ${view.info.to})`
          : staticThumbBackground(view.info),
      }}
    >
      <PieceImg image={image} className="block h-auto w-full" />
    </span>
  );
}
