import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FocusEvent,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { create } from 'zustand';
import type { CosmeticPack, CosmeticPiece, CosmeticSetId } from '@diskort/shared';
import {
  cosmeticAssetFailed,
  cosmeticPacks,
  cosmeticSetInfo,
  isKnownCosmeticSet,
  selectableCosmeticSets,
  useCosmeticManifest,
  useGuild,
} from '@diskort/client-core';
import { useReducedMotion } from '../../lib/motion';
import { cn } from '../../lib/utils';
import {
  decorationBox,
  failuresIn,
  INITIAL_LOAD_STATE,
  loadEpoch,
  pickSource,
  PLATE_BLEND_PX,
  resolvePiece,
  resolvePlaying,
  sourceFailed,
  sourceLoaded,
  staticCardBackground,
  staticPlateBackground,
  staticRingStyle,
  staticThumbBackground,
  type PieceFiles,
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
  return isKnownCosmeticSet(useCosmeticManifest(), id) ? id : null;
}

/** Setin bilgisi (ad, renkler, açıklamalar); set bildirimde yoksa null */
export function useCosmeticSetInfo(id: CosmeticSetId | null | undefined): CosmeticPack | null {
  return cosmeticSetInfo(useCosmeticManifest(), id);
}

/** Seçicide gösterilecek setler, bildirimdeki sırayla (bildirim yoksa boş) */
export function useSelectableCosmeticSets(): CosmeticPack[] {
  const manifest = useCosmeticManifest();
  return useMemo(
    () =>
      selectableCosmeticSets(manifest).flatMap((id) => {
        const info = cosmeticSetInfo(manifest, id);
        return info ? [info] : [];
      }),
    [manifest],
  );
}

/** Setin parçası (set bildirimde yoksa `view` null) ve bildirimin sürümü */
function usePiece(
  id: CosmeticSetId | null | undefined,
  piece: CosmeticPiece,
): { view: PieceView | null; version: string | null } {
  // Seçiciler depodaki güncel bildirimi okur: bildirim değişince yeniden hesaplanır
  const manifest = useCosmeticManifest();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => resolvePiece(cosmeticPacks, id, piece), [manifest, id, piece]);
  return { view, version: manifest?.version ?? null };
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

// ---------- Üstüne gelince oynatma ----------

// Kural (Discord gibi): bir kozmetik yalnızca kullanıcı ona işaret ederken (ya da klavyeyle odaklanmışken) oynar,
// değilse sabit posteri görünür. Üye listesi satırı gibi bir kap kendi üstüne gelinmesini izler (useHoverPlay) ve
// içindeki plaka ile avatar dekorasyonuna PlayScope ile bildirir; kap yoksa avatar kendi üstüne gelinmesini izler.
// Profil kartı gibi "açık olduğu sürece" oynayanlar `animate` ile açıkça oynatılır. Durum kapta yerel kalır: liste
// yeniden çizilmez; sayaç, zamanlayıcı ya da gözlemci yoktur.

/** Kapsayan kabın oynatma durumu; kap yoksa null (parça kendi kuralına bakar) */
const CosmeticPlay = createContext<boolean | null>(null);

/** İçindeki plaka ve avatar dekorasyonlarının oynayıp oynamadığını bildiren kap */
export function PlayScope({ playing, children }: { playing: boolean; children: ReactNode }) {
  return <CosmeticPlay.Provider value={playing}>{children}</CosmeticPlay.Provider>;
}

/** Bir kabın olay tutucuları: üstüne gelince ya da klavyeyle odaklanınca `playing` */
export interface HoverPlayBind {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: (e: FocusEvent<HTMLElement>) => void;
}

/** Bir kabın üstüne gelindi ya da klavyeyle odaklandı mı; `bind` kabın olay tutucularıdır */
export function useHoverPlay(): { playing: boolean; bind: HoverPlayBind } {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const bind = useMemo<HoverPlayBind>(
    () => ({
      onPointerEnter: () => setHover(true),
      onPointerLeave: () => setHover(false),
      // Fareyle tıklayıp odaklanmak sayılmaz (zaten üstünde); yalnızca klavye odağı (focus-visible)
      onFocus: (e) => {
        if (e.target.matches(':focus-visible')) setFocus(true);
      },
      // Odak kabın içinde başka yere geçtiyse sürer
      onBlur: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      },
    }),
    [],
  );
  return { playing: hover || focus, bind };
}

/** Parçanın oynayıp oynamadığı: açıkça verilen, yoksa kapsayan kabın durumu, o da yoksa durur */
function usePlaying(animate: boolean | undefined): boolean {
  return resolvePlaying(animate, useContext(CosmeticPlay));
}

/**
 * Üstüne gelindikçe içindeki plaka ve dekorasyonları oynatan `div`. Durum burada yerel kalır: içerik (`children`)
 * yeniden çizilmez, yalnızca oynatma durumunu okuyan parçalar poster ile hareketli dosya arasında geçer.
 */
export function PlayOnHover({
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, keyof HoverPlayBind>) {
  const { playing, bind } = useHoverPlay();
  return (
    <div {...rest} {...bind}>
      <PlayScope playing={playing}>{children}</PlayScope>
    </div>
  );
}

/**
 * Avatarın dekorasyonu oynasın mı: açıkça verilen, yoksa kapsayan kap (satır), o da yoksa avatarın kendisine
 * gelinmesi. `bind`: avatarın kendi üstüne gelinmesini izleyen olay tutucuları; kap ya da açık karar varsa yok.
 */
export function useAvatarPlaying(animate: boolean | undefined): { playing: boolean; bind: HoverPlayBind | undefined } {
  const scope = useContext(CosmeticPlay);
  const own = useHoverPlay();
  const owns = animate === undefined && scope === null;
  return { playing: owns ? own.playing : resolvePlaying(animate, scope), bind: owns ? own.bind : undefined };
}

// ---------- Parçanın resmi ----------

/** Bu oturumda tamamı yüklenmiş hareketli dosyalar: yeniden gösterilirken önce posteri beklemeye gerek yok */
const loadedUrls = new Set<string>();

/**
 * Gateway'in kaçıncı kez bağlandığı (READY). Bağlantı geri gelince yüklenemeyen dosyalar yeniden denenir:
 * geçici bir ağ hatası parçayı yeniden kurulana kadar posterde / sabit görünümde bırakmaz (bkz. loadEpoch).
 */
const useConnections = create<{ count: number }>(() => ({ count: 0 }));
useGuild.subscribe((s, prev) => {
  if (s.status === 'ready' && prev.status !== 'ready') useConnections.setState((c) => ({ count: c.count + 1 }));
});

interface PieceImage {
  /** Gösterilecek dosya; null ise sabit görünüm */
  source: PieceSource | null;
  /** Resmin kendi ölçüleri (yer tutar: yüklenene kadar yerleşim oynamaz) */
  width: number;
  height: number;
  /** `url`: olayın ait olduğu adres (<img>'nin o anki dosyası) */
  onLoad: (url: string) => void;
  onError: (url: string) => void;
}

/**
 * Parçanın <img>'sinde gösterilecek dosya ve yükleme olayları. Önce poster gösterilir, yüklenince hareketli
 * dosyaya geçilir (o yüklenene kadar tarayıcı posteri göstermeyi sürdürür). "Hareketi azalt" açıkken,
 * `paused` iken (üstüne gelinmeyen plaka ve dekorasyon) ve tam ekran bir pencerenin altında kalınca poster. Yüklenemeyen dosyadan postere, o da
 * yüklenemezse sabit görünüme düşülür (kırık resim simgesi hiç görünmez). Yüklenemeyen dosya paket deposuna
 * bildirilir (bildirim eskimiş olabilir); bildirim değişince ya da bağlantı geri gelince yeniden denenir.
 * `version`: bildirimin sürümü.
 */
function usePieceImage(view: PieceView | null, version: string | null, paused = false): PieceImage {
  const reduced = useReducedMotion();
  const covered = useCovered();
  const epoch = loadEpoch(version, useConnections((s) => s.count));
  const files: PieceFiles = { anim: view?.anim?.url ?? null, poster: view?.poster?.url ?? null };
  // Olaylar kendi adresleriyle kaydedilir: eski bir adresin olayı (paketin sürümü değişti) yenisini etkilemez
  const [load, setLoad] = useState(INITIAL_LOAD_STATE);
  // Posteri gösterildi (adres değişince, ör. önizlemede başka set, yeniden posterden başlanır) ya da hareketli
  // dosyası zaten yüklü
  const primed =
    files.anim !== null && ((files.poster !== null && load.loadedPoster === files.poster) || loadedUrls.has(files.anim));
  const source = pickSource(files, { still: reduced || covered || paused, primed, failed: failuresIn(load, epoch) });
  const asset = view?.anim ?? view?.poster;
  return {
    source,
    width: asset?.width ?? 0,
    height: asset?.height ?? 0,
    onLoad: (url) => {
      if (url === files.anim) loadedUrls.add(url);
      else setLoad((s) => sourceLoaded(s, files, url));
    },
    onError: (url) => {
      if (url !== files.anim && url !== files.poster) return;
      // Paket yeniden yayınlanmış ya da kaldırılmış olabilir: depo bildirimi (en çok dakikada bir) yeniden ister
      cosmeticAssetFailed(url);
      setLoad((s) => sourceFailed(s, files, epoch, url));
    },
  };
}

function PieceImg({ image, className, style }: { image: PieceImage; className?: string; style?: CSSProperties }) {
  const { source } = image;
  if (!source) return null;
  // Olay <img>'nin şu anki dosyasına ait değilse (yerini yenisine bırakmış adresin gecikmiş olayı) yok sayılır
  const current = (img: HTMLImageElement): boolean => img.getAttribute('src') === source.url;
  return (
    <img
      src={source.url}
      width={image.width}
      height={image.height}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
      className={cn('pointer-events-none max-w-none select-none', className)}
      style={style}
      onLoad={(e) => {
        if (!current(e.currentTarget)) return;
        e.currentTarget.style.visibility = '';
        image.onLoad(source.url);
      }}
      // Ölçüsü belli <img> yüklenemeyince tarayıcı kırık resim simgesi çizer: sıradaki dosya yüklenene (ya da
      // sabit görünüme geçilene) kadar resim hemen gizlenir
      onError={(e) => {
        if (!current(e.currentTarget)) return;
        e.currentTarget.style.visibility = 'hidden';
        image.onError(source.url);
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
  const { view, version } = usePiece(id, 'card');
  const image = usePieceImage(view, version);
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
 * Hareketli avatar dekorasyonu: avatarın ortasına oturan kare resim (avatar `relative` olmalı). Her boyda önce
 * sabit posteri gösterilir; `animate` (ya da kapsayan PlayScope) açıkken paket oynar. Poster yoksa ya da paket
 * bu istemcide oynatılmıyorsa yalnızca CSS'ten bir halka.
 */
export function AvatarDecoration({
  id,
  size,
  animate,
}: {
  id: CosmeticSetId;
  /** Avatarın kenarı (css px) */
  size: number;
  /** Oynasın mı (verilmezse kapsayan PlayScope'a bakılır; o da yoksa poster) */
  animate?: boolean;
}) {
  const { view, version } = usePiece(id, 'deco');
  const playing = usePlaying(animate);
  const image = usePieceImage(view, version, !playing);
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
 * rengiyle dolar ve resmin sol kenarı bu renge karışır (ek yeri görünmez), darsa resmin solu kırpılır. Satırın
 * üstüne gelinmedikçe sabit posteridir (bkz. PlayScope).
 */
export function Nameplate({
  id,
  className,
  animate,
}: {
  id: CosmeticSetId;
  className?: string;
  /** Oynasın mı (verilmezse kapsayan PlayScope'a bakılır; o da yoksa poster) */
  animate?: boolean;
}) {
  const { view, version } = usePiece(id, 'plate');
  const playing = usePlaying(animate);
  const image = usePieceImage(view, version, !playing);
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
  const { view, version } = usePiece(id, 'card');
  const image = usePieceImage(view, version, paused);
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
