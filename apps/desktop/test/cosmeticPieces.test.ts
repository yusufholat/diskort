import { describe, expect, it } from 'vitest';
import type { CosmeticAssetKind, CosmeticPack, CosmeticPackAsset, CosmeticPackManifest, CosmeticPiece } from '@diskort/shared';
import { cosmeticPackAsset, cosmeticPackPoster, cosmeticRenderMode, cosmeticSetInfo } from '@diskort/client-core';
import {
  ANIMATED_DECORATION_MIN_SIZE,
  decorationBox,
  nameplateNameColor,
  pickSource,
  PLAYABLE_KINDS,
  resolvePiece,
  staticCardBackground,
  staticPlateBackground,
  staticRingStyle,
  staticThumbBackground,
  type PieceLookup,
} from '../src/renderer/src/components/cosmetics/pieces.js';

const BASE = 'http://sunucu.test';
const VERSION = 'a1b2c3d4e5f60718';

const SIZES: Record<CosmeticPiece, [number, number]> = { card: [600, 900], deco: [264, 264], plate: [446, 80] };
const EXT: Record<CosmeticAssetKind, string> = { avif: '.avif', webp: '.webp', 'stacked-h264': '.mp4', poster: '-poster.webp' };

/** Bildirimdeki bir paket: her parçada verilen türlerde birer dosya */
function pack(id: string, kinds: CosmeticAssetKind[], overrides: Partial<CosmeticPack> = {}): CosmeticPack {
  const assets = (piece: CosmeticPiece): CosmeticPackAsset[] =>
    kinds.map((kind) => ({
      kind,
      url: `/api/cosmetics/packs/${id}/${VERSION}/${piece}${EXT[kind]}`,
      width: SIZES[piece][0],
      height: SIZES[piece][1],
      bytes: 1000,
      ...(kind === 'stacked-h264' ? { stackedWidth: 2 * SIZES[piece][0] + 16, alphaX: SIZES[piece][0] + 16 } : {}),
    }));
  return {
    id,
    label: `Set ${id}`,
    accent: '#9fe6ff',
    from: '#0b2a44',
    to: '#6fb3d9',
    fallback: ['#04101c', '#2a5d80', 'rgba(180,235,255,.35)'],
    description: 'Açıklama',
    pieces: ['kart', 'dekorasyon', 'plaka'],
    loopSeconds: 6,
    fps: 30,
    platforms: ['desktop'],
    version: VERSION,
    assets: { card: assets('card'), deco: assets('deco'), plate: assets('plate') },
    ...overrides,
  };
}

/** Masaüstü istemcisinin paket deposu gibi davranan seçiciler (client-core'un saf seçicileriyle) */
function lookup(packs: CosmeticPack[]): PieceLookup {
  const manifest: CosmeticPackManifest = { version: '00112233445566ff', packs };
  return {
    info: (id) => cosmeticSetInfo(manifest, id),
    mode: (id, piece, kinds) => cosmeticRenderMode(manifest, id, piece, 'desktop', kinds),
    asset: (id, piece, kinds) => cosmeticPackAsset(manifest, BASE, id, piece, 'desktop', kinds),
    poster: (id, piece) => cosmeticPackPoster(manifest, BASE, id, piece, 'desktop'),
  };
}

const url = (id: string, file: string): string => `${BASE}/api/cosmetics/packs/${id}/${VERSION}/${file}`;

describe('resolvePiece: parçanın dosyaları', () => {
  it('oynatılabilir türler sırayla avif, webp; video ve tuval yok', () => {
    expect(PLAYABLE_KINDS).toEqual(['avif', 'webp']);
  });

  it('avif ve webp varsa avif, posteriyle birlikte', () => {
    // Bildirimdeki sıra tercihi değiştirmez
    const packs = lookup([pack('buz', ['webp', 'stacked-h264', 'poster', 'avif'])]);
    const view = resolvePiece(packs, 'buz', 'plate');
    expect(view?.anim).toMatchObject({ kind: 'avif', url: url('buz', 'plate.avif'), width: 446, height: 80 });
    expect(view?.poster).toMatchObject({ kind: 'poster', url: url('buz', 'plate-poster.webp') });
    expect(view?.info.label).toBe('Set buz');
  });

  it('avif yoksa webp', () => {
    const view = resolvePiece(lookup([pack('buz', ['webp', 'poster'])]), 'buz', 'deco');
    expect(view?.anim).toMatchObject({ kind: 'webp', url: url('buz', 'deco.webp') });
  });

  it('posteri olmayan paket: hareketli dosya posteri olmadan', () => {
    const view = resolvePiece(lookup([pack('buz', ['avif'])]), 'buz', 'card');
    expect(view?.anim?.kind).toBe('avif');
    expect(view?.poster).toBeNull();
  });

  it('yalnızca video ve poster: masaüstü oynatamaz, sabit görünüm (poster de kullanılmaz)', () => {
    const view = resolvePiece(lookup([pack('buz', ['stacked-h264', 'poster'])]), 'buz', 'card');
    expect(view).toMatchObject({ anim: null, poster: null });
    expect(view?.info.fallback).toHaveLength(3);
  });

  it('paket masaüstünde kapalıysa sabit görünüm', () => {
    const view = resolvePiece(lookup([pack('buz', ['avif', 'poster'], { platforms: ['android'] })]), 'buz', 'plate');
    expect(view).toMatchObject({ anim: null, poster: null });
  });

  it('bildirimde olmayan set (ya da seçim yok): hiçbir şey', () => {
    const packs = lookup([pack('buz', ['avif', 'poster'])]);
    expect(resolvePiece(packs, 'yeni-set', 'card')).toBeNull();
    expect(resolvePiece(packs, null, 'card')).toBeNull();
    expect(resolvePiece(lookup([]), 'buz', 'deco')).toBeNull();
  });
});

describe('pickSource: gösterilecek dosya ve yedek zinciri', () => {
  const files = { anim: 'a.avif', poster: 'p.webp' };
  const playing = { still: false, primed: true, failed: [] as string[] };

  it('önce poster, poster gösterilince hareketli dosya', () => {
    expect(pickSource(files, { ...playing, primed: false })).toEqual({ url: 'p.webp', animated: false });
    expect(pickSource(files, playing)).toEqual({ url: 'a.avif', animated: true });
  });

  it('hareketi azalt / durdurulmuş / örtülmüş: poster (hareketli dosya yüklü olsa da)', () => {
    expect(pickSource(files, { ...playing, still: true })).toEqual({ url: 'p.webp', animated: false });
  });

  it('posteri yoksa hareketli dosya beklemeden; dururken sabit görünüm', () => {
    const noPoster = { anim: 'a.avif', poster: null };
    expect(pickSource(noPoster, { ...playing, primed: false })).toEqual({ url: 'a.avif', animated: true });
    expect(pickSource(noPoster, { ...playing, still: true })).toBeNull();
  });

  it('hareketli dosya yüklenemezse poster, o da yüklenemezse sabit görünüm', () => {
    expect(pickSource(files, { ...playing, failed: ['a.avif'] })).toEqual({ url: 'p.webp', animated: false });
    expect(pickSource(files, { ...playing, failed: ['a.avif', 'p.webp'] })).toBeNull();
    expect(pickSource(files, { ...playing, still: true, failed: ['p.webp'] })).toBeNull();
  });

  it('poster yüklenemezse hareketli dosya yine oynar', () => {
    expect(pickSource(files, { ...playing, primed: false, failed: ['p.webp'] })).toEqual({ url: 'a.avif', animated: true });
  });

  it('oynatılmayan paket (dosya yok): sabit görünüm', () => {
    expect(pickSource({ anim: null, poster: null }, playing)).toBeNull();
  });

  it('yeni sürümün adresleri eski hatalardan etkilenmez', () => {
    const next = { anim: 'a2.avif', poster: 'p2.webp' };
    expect(pickSource(next, { ...playing, failed: ['a.avif', 'p.webp'] })).toEqual({ url: 'a2.avif', animated: true });
  });
});

describe('decorationBox: dekorasyon resminin karesi', () => {
  it('80 piksellik avatarda 132 piksel (dış yarıçap 46), avatarın ortasında', () => {
    expect(decorationBox(80)).toEqual({ box: 132, offset: -26 });
  });

  it('oran bütün boylarda aynı: avatarın 1,65 katı', () => {
    for (const size of [24, 32, 40, 44, 48, 64, 80, 96, 128]) {
      const { box, offset } = decorationBox(size);
      expect(box).toBe(Math.round(size * 1.65));
      // Ortalanmış: iki yanda eşit taşar
      expect(offset * 2 + box).toBeCloseTo(size, 10);
    }
    expect(decorationBox(44).box).toBe(73);
    expect(decorationBox(64).box).toBe(106);
  });

  it('hareketli dekorasyonun en küçük avatar boyu', () => {
    expect(ANIMATED_DECORATION_MIN_SIZE).toBe(64);
  });
});

describe('sabit görünüm: yalnızca setin bilgi renkleri', () => {
  const info = pack('buz', []);

  it('halka: setin vurgu ve degrade renkleri, avatarın dışına taşan ince çizgi', () => {
    const small = staticRingStyle(info, 32);
    expect(small.inset).toBe(-2);
    expect(small.background).toContain('#9fe6ff');
    expect(small.background).toContain('#0b2a44');
    expect(small.background).toContain('#6fb3d9');
    expect(staticRingStyle(info, 40).inset).toBe(-2.5);
    expect(staticRingStyle(info, 80).inset).toBe(-3);
  });

  it('plaka: solu koyu (perde), setin rengi ve parıltısı sağda, zemini opak', () => {
    const bg = staticPlateBackground(info);
    expect(bg.startsWith('linear-gradient(to right, color-mix(in srgb, #04101c 86%, transparent) 0%')).toBe(true);
    expect(bg).toContain('color-mix(in srgb, #04101c 0%, transparent) 80%');
    expect(bg).toContain('rgba(180,235,255,.35)');
    expect(bg).toContain('color-mix(in srgb, #2a5d80 75%, transparent)');
    expect(bg.endsWith(', #04101c')).toBe(true);
  });

  it('kart ve seçici kutusu: parıltı rengi', () => {
    expect(staticCardBackground(info)).toBe('radial-gradient(circle 170px at 75% 32px, rgba(180,235,255,.35), transparent)');
    const thumb = staticThumbBackground(info);
    expect(thumb).toContain('rgba(180,235,255,.35)');
    expect(thumb).toContain('linear-gradient(154deg, #04101c, #2a5d80)');
  });
});

describe('nameplateNameColor: plakalı satırda rol rengi', () => {
  it('renk yoksa undefined (beyaz)', () => {
    expect(nameplateNameColor(null)).toBeUndefined();
    expect(nameplateNameColor(undefined)).toBeUndefined();
  });

  it('açık renk olduğu gibi kalır', () => {
    expect(nameplateNameColor('#ffcc00')).toBe('#ffcc00');
    expect(nameplateNameColor('#fff')).toBe('#fff');
  });

  it('koyu renk okunur olana kadar beyaza açılır', () => {
    expect(nameplateNameColor('#000080')).toMatch(/^color-mix\(in srgb, #000080 \d+%, #fff\)$/);
    // Siyah: %55 beyazla bağıl parlaklık 0,22'yi geçer
    expect(nameplateNameColor('#000000')).toBe('color-mix(in srgb, #000000 45%, #fff)');
  });

  it('çözülemeyen renk sabit oranda açılır', () => {
    expect(nameplateNameColor('rebeccapurple')).toBe('color-mix(in srgb, rebeccapurple 75%, #fff)');
  });
});
