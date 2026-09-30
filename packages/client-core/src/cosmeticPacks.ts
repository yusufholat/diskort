// Kozmetik paketleri deposu: sunucuda yayınlanmış setlerin bildirimi (GET /api/cosmetics/packs) bellekte
// tutulur, cihazda saklanır (çevrimdışı açılışta kaynak odur) ve oturum başlarken tazelenir. Platformdan
// bağımsızdır: oynatıcılar (masaüstü, telefon) buradaki seçicilerle "bu seti bu parçada nasıl göstereyim"
// sorusunu sorar. Bir set yalnızca paketi oynatılarak gösterilir: seçilebilir setler, adları ve renkleri
// bildirimden gelir (istemcide yerleşik bir set tablosuna bakılmaz). Sözleşme: @diskort/shared cosmetics.ts.

import { create } from 'zustand';
import {
  animatedDecorationId,
  isCosmeticSetId,
  parseCosmeticPackManifest,
  type ClientPlatform,
  type CosmeticAssetKind,
  type CosmeticPack,
  type CosmeticPackAsset,
  type CosmeticPackManifest,
  type CosmeticPiece,
  type CosmeticSetId,
  type User,
} from '@diskort/shared';
import { normalizeServerUrl } from './api';
import { env, type KeyValueStorage } from './env';

// ---------- Saf seçiciler ----------

/**
 * Bir set bir parçada nasıl gösterilir:
 * - `pack`: sunucudan inen paket oynatılır (cosmeticPackAsset / cosmeticPackPoster)
 * - `static`: paket var ama bu platformda oynatılmıyor (platforms listesinde yok) ya da bu istemcinin
 *   oynatabildiği bir dosyası yok: paketin bilgi renklerinden (cosmeticSetInfo) sabit bir görünüm
 * - `none`: kimlik bildirimde yok (tanınmıyor): hiçbir şey gösterilmez
 */
export type CosmeticRenderMode = 'pack' | 'static' | 'none';

/** Adresi tam (sunucu adresiyle birleştirilmiş) paket dosyası */
export type ResolvedCosmeticAsset = CosmeticPackAsset;

type Manifest = CosmeticPackManifest | null | undefined;

/** Bildirimdeki paket (bilgisi: ad, renkler, açıklamalar, dosyalar); kimlik tanınmıyorsa null */
export function cosmeticPackOf(manifest: Manifest, id: string | null | undefined): CosmeticPack | null {
  if (!manifest || !id) return null;
  return manifest.packs.find((p) => p.id === id) ?? null;
}

const NO_SETS: CosmeticSetId[] = [];
let selectableCache: { manifest: CosmeticPackManifest; ids: CosmeticSetId[] } | null = null;

/**
 * Seçicide gösterilecek setler: bildirimdeki paketler, bildirimdeki sırayla (bildirim yoksa boş). Aynı
 * bildirim için aynı dizi döner (durum seçicisinde doğrudan kullanılabilir).
 */
export function selectableCosmeticSets(manifest: Manifest): CosmeticSetId[] {
  if (!manifest) return NO_SETS;
  if (selectableCache?.manifest !== manifest) selectableCache = { manifest, ids: manifest.packs.map((p) => p.id) };
  return selectableCache.ids;
}

/** Kimlik bildirimde var mı (seçilebilir ve gösterilebilir mi) */
export const isKnownCosmeticSet = (manifest: Manifest, id: string | null | undefined): id is CosmeticSetId =>
  cosmeticPackOf(manifest, id) !== null;

/** Setin görünüş bilgisi (renkler, açıklamalar; sabit görünüm bunlardan kurulur); set tanınmıyorsa null */
export const cosmeticSetInfo = (manifest: Manifest, id: string | null | undefined): CosmeticPack | null =>
  cosmeticPackOf(manifest, id);

/** Setin adı; set tanınmıyorsa null */
export const cosmeticSetLabel = (manifest: Manifest, id: string | null | undefined): string | null =>
  cosmeticPackOf(manifest, id)?.label ?? null;

/** Paket bu platformda oynatılıyor mu */
const packEnabled = (pack: CosmeticPack | null, platform: ClientPlatform): pack is CosmeticPack =>
  pack !== null && pack.platforms.includes(platform);

const resolve = (baseUrl: string, asset: CosmeticPackAsset): ResolvedCosmeticAsset => ({ ...asset, url: baseUrl + asset.url });

/**
 * Oynatılacak dosya: `preferredKinds` sırasıyla denenir, paketin o parçasında bulunan ilk tür döner (adresi
 * tam). Paket yoksa, bu platformda oynatılmıyorsa ya da istenen türlerden hiçbiri yoksa null.
 * `baseUrl`: sunucunun adresi (sonunda / olmadan).
 */
export function cosmeticPackAsset(
  manifest: Manifest,
  baseUrl: string,
  id: string | null | undefined,
  piece: CosmeticPiece,
  platform: ClientPlatform,
  preferredKinds: readonly CosmeticAssetKind[],
): ResolvedCosmeticAsset | null {
  const pack = cosmeticPackOf(manifest, id);
  if (!packEnabled(pack, platform)) return null;
  for (const kind of preferredKinds) {
    const asset = pack.assets[piece].find((a) => a.kind === kind);
    if (asset) return resolve(baseUrl, asset);
  }
  return null;
}

/**
 * Parçanın sabit resmi (poster): "hareketi azalt" açıkken, durdurulmuş görünümlerde ve dosya yüklenirken.
 * Paket yoksa, bu platformda oynatılmıyorsa ya da posteri yoksa null.
 */
export function cosmeticPackPoster(
  manifest: Manifest,
  baseUrl: string,
  id: string | null | undefined,
  piece: CosmeticPiece,
  platform: ClientPlatform,
): ResolvedCosmeticAsset | null {
  return cosmeticPackAsset(manifest, baseUrl, id, piece, platform, ['poster']);
}

/**
 * Bu istemci `id` setinin `piece` parçasını `platform`da nasıl göstermeli. `playableKinds`: istemcinin
 * oynatabildiği türler (cosmeticPackAsset'e verilen tercih listesiyle aynı).
 * - Paket bildirimde yok → `none`
 * - Paket bu platformda açık ve oynatılabilir bir dosyası var → `pack`
 * - Aksi halde (platformda kapalı ya da oynatılabilir dosya yok) → `static`
 */
export function cosmeticRenderMode(
  manifest: Manifest,
  id: string | null | undefined,
  piece: CosmeticPiece,
  platform: ClientPlatform,
  playableKinds: readonly CosmeticAssetKind[],
): CosmeticRenderMode {
  const pack = cosmeticPackOf(manifest, id);
  if (!pack) return 'none';
  return packEnabled(pack, platform) && pack.assets[piece].some((a) => playableKinds.includes(a.kind)) ? 'pack' : 'static';
}

type CosmeticFields = Pick<User, 'animatedEffect' | 'avatarDecoration' | 'nameplate'>;

/** Kullanıcıların taşıdığı, bildirimde olmayan set kimlikleri (tekrarsız) */
export function unknownCosmeticSets(manifest: Manifest, users: Iterable<CosmeticFields | null | undefined>): CosmeticSetId[] {
  const unknown = new Set<CosmeticSetId>();
  for (const user of users) {
    if (!user) continue;
    for (const id of [user.animatedEffect, animatedDecorationId(user.avatarDecoration), user.nameplate]) {
      if (isCosmeticSetId(id) && !isKnownCosmeticSet(manifest, id)) unknown.add(id);
    }
  }
  return [...unknown];
}

// ---------- Depo ----------

interface CosmeticPackStore {
  /** Son alınan bildirim; hiç alınamadıysa null (hiçbir set gösterilmez) */
  manifest: CosmeticPackManifest | null;
  /** Bildirimin alındığı sunucu (adres değişirse bildirim geçersizdir) */
  serverUrl: string | null;
  /** Son tazelemenin durumu */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Sunucuya en son başarıyla sorulan an (ms); hiç sorulmadıysa null */
  checkedAt: number | null;
  /** Tanınmayan kimlik yüzünden en son tazeleme istenen an (ms) */
  unknownRefreshAt: number;
  /** Bu bildirim için zaten sorulmuş tanınmayan kimlikler (aynı kimlik için yeniden sorulmaz) */
  unknownAsked: readonly string[];
}

export const useCosmeticPacks = create<CosmeticPackStore>()(() => ({
  manifest: null,
  serverUrl: null,
  status: 'idle',
  checkedAt: null,
  unknownRefreshAt: 0,
  unknownAsked: [],
}));

const STORAGE_KEY = 'diskort-cosmetic-packs';
/** Tanınmayan kimlik görülünce bildirim en çok bu sıklıkta yeniden istenir */
export const UNKNOWN_COSMETIC_REFRESH_INTERVAL_MS = 60_000;

/** Bildirim gizli değildir ve büyüyebilir: varsa önbellek deposuna, yoksa genel depoya yazılır */
const storage = (): KeyValueStorage => env().cacheStorage ?? env().storage;

const currentServerUrl = (): string => normalizeServerUrl(env().serverUrl());

function applyStored(raw: string | null): void {
  if (!raw || useCosmeticPacks.getState().manifest) return;
  try {
    const stored = JSON.parse(raw) as { serverUrl?: unknown; manifest?: unknown };
    const manifest = parseCosmeticPackManifest(stored.manifest);
    if (manifest && typeof stored.serverUrl === 'string' && stored.serverUrl === currentServerUrl()) {
      useCosmeticPacks.setState({ manifest, serverUrl: stored.serverUrl });
    }
  } catch {
    // bozuk kayıt: yok sayılır, sunucudan yeniden alınır
  }
}

/**
 * Cihazda saklanan bildirimi yükler (configureClient çağırır). Eşzamanlı depolamada (masaüstü) çağrı
 * dönünce hazırdır. Hiçbir zaman hata vermez.
 */
export function hydrateCosmeticPacks(): Promise<void> {
  try {
    const raw = storage().getItem(STORAGE_KEY);
    if (typeof raw === 'string' || raw === null) applyStored(raw);
    else return raw.then(applyStored).catch(() => undefined);
  } catch {
    // depolama okunamadı
  }
  return Promise.resolve();
}

function persist(): void {
  const { manifest, serverUrl } = useCosmeticPacks.getState();
  try {
    const done = manifest
      ? storage().setItem(STORAGE_KEY, JSON.stringify({ serverUrl, manifest }))
      : storage().removeItem(STORAGE_KEY);
    if (done && typeof done === 'object') done.catch(() => undefined);
  } catch {
    // depolama dolu ya da kapalı: bildirim yalnızca bellekte kalır
  }
}

let inflight: Promise<void> | null = null;

/**
 * Bildirimi sunucudan tazeler (değişmediyse 304: gövde inmez). Oturum başlarken kendiliğinden çağrılır
 * (gateway READY); ayarlardaki seçici açılırken de çağrılmalıdır. Aynı anda tek istek gider. Hata vermez:
 * sunucuya ulaşılamazsa eldeki (cihazda saklanan) bildirim kullanılmaya devam eder.
 * `maxAgeMs`: son başarılı sorgu bundan yeniyse sunucuya hiç sorulmaz.
 */
export function refreshCosmeticPacks(opts: { maxAgeMs?: number } = {}): Promise<void> {
  if (inflight) return inflight;
  let base: string;
  try {
    base = currentServerUrl();
  } catch {
    // istemci henüz yapılandırılmadı
    return Promise.resolve();
  }
  const { checkedAt, serverUrl } = useCosmeticPacks.getState();
  if (opts.maxAgeMs && serverUrl === base && checkedAt !== null && Date.now() - checkedAt < opts.maxAgeMs) {
    return Promise.resolve();
  }
  inflight = load(base).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function load(base: string): Promise<void> {
  // Başka sunucunun bildirimi bu sunucuda geçersiz
  if (useCosmeticPacks.getState().serverUrl !== base) {
    useCosmeticPacks.setState({ manifest: null, serverUrl: base, checkedAt: null, unknownAsked: [] });
  }
  const current = useCosmeticPacks.getState().manifest;
  useCosmeticPacks.setState({ status: 'loading' });
  try {
    const res = await fetch(`${base}/api/cosmetics/packs`, {
      // Sunucunun ETag'i bildirimin sürümüdür (başlık tarayıcıda başka kökenden okunamadığından gövdeden alınır)
      headers: current ? { 'If-None-Match': `"${current.version}"` } : {},
    });
    // Bu arada sunucu değiştiyse yanıt artık geçersiz
    if (useCosmeticPacks.getState().serverUrl !== base) return;
    if (res.status === 304) {
      useCosmeticPacks.setState({ status: 'ready', checkedAt: Date.now() });
      return;
    }
    if (!res.ok) throw new Error(`bildirim alınamadı (${res.status})`);
    const manifest = parseCosmeticPackManifest(await res.json());
    if (!manifest) throw new Error('bildirim bozuk');
    if (useCosmeticPacks.getState().serverUrl !== base) return;
    // Aynı sürüm: nesne değişmez (gereksiz yeniden çizim olmasın)
    if (current?.version === manifest.version) {
      useCosmeticPacks.setState({ status: 'ready', checkedAt: Date.now() });
      return;
    }
    useCosmeticPacks.setState({ manifest, status: 'ready', checkedAt: Date.now(), unknownAsked: [] });
    persist();
  } catch {
    // Eski sunucu (uç yok), ağ hatası ya da bozuk yanıt: eldeki bildirim kalır
    if (useCosmeticPacks.getState().serverUrl === base) useCosmeticPacks.setState({ status: 'error' });
  }
}

/**
 * Gateway'den gelen kullanıcılar bildirimde olmayan bir set kimliği taşıyorsa (yeni paket yayınlanmış
 * olabilir) bildirim yeniden istenir: en çok UNKNOWN_COSMETIC_REFRESH_INTERVAL_MS'de bir ve aynı bildirim
 * için kimlik başına bir kez (tazelemeden sonra da tanınmayan kimlik yeniden sorulmaz).
 */
export function noteCosmeticUsers(users: Iterable<CosmeticFields | null | undefined>, now = Date.now()): void {
  const { manifest, unknownRefreshAt, unknownAsked } = useCosmeticPacks.getState();
  const fresh = unknownCosmeticSets(manifest, users).filter((id) => !unknownAsked.includes(id));
  if (fresh.length === 0 || now - unknownRefreshAt < UNKNOWN_COSMETIC_REFRESH_INTERVAL_MS) return;
  useCosmeticPacks.setState({ unknownRefreshAt: now, unknownAsked: [...unknownAsked, ...fresh].slice(-256) });
  void refreshCosmeticPacks();
}

// ---------- Depoya ve platforma bağlı seçiciler ----------

/**
 * Eldeki bildirim ve bu istemcinin platformu/sunucusuyla seçiciler (bileşen dışında ya da
 * `useCosmeticPacks((s) => s.manifest)` ile yeniden çizilen bileşenlerin içinde).
 */
export const cosmeticPacks = {
  /** Seçicideki setler, sırayla */
  selectable: (): CosmeticSetId[] => selectableCosmeticSets(useCosmeticPacks.getState().manifest),
  known: (id: string | null | undefined): boolean => isKnownCosmeticSet(useCosmeticPacks.getState().manifest, id),
  info: (id: string | null | undefined): CosmeticPack | null => cosmeticSetInfo(useCosmeticPacks.getState().manifest, id),
  label: (id: string | null | undefined): string | null => cosmeticSetLabel(useCosmeticPacks.getState().manifest, id),
  asset: (
    id: string | null | undefined,
    piece: CosmeticPiece,
    preferredKinds: readonly CosmeticAssetKind[],
  ): ResolvedCosmeticAsset | null =>
    cosmeticPackAsset(useCosmeticPacks.getState().manifest, currentServerUrl(), id, piece, env().platform, preferredKinds),
  poster: (id: string | null | undefined, piece: CosmeticPiece): ResolvedCosmeticAsset | null =>
    cosmeticPackPoster(useCosmeticPacks.getState().manifest, currentServerUrl(), id, piece, env().platform),
  mode: (
    id: string | null | undefined,
    piece: CosmeticPiece,
    playableKinds: readonly CosmeticAssetKind[],
  ): CosmeticRenderMode => cosmeticRenderMode(useCosmeticPacks.getState().manifest, id, piece, env().platform, playableKinds),
};
