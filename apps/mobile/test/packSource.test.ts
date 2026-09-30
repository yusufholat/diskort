// Bir setin bir parçasının telefonda nasıl gösterileceği: oynatılacak dosya, sabit resim ya da yalnızca setin
// renkleri. Paket deposunun saf seçicileri (client-core) gerçek bir bildirimle kullanılır.

import { describe, expect, it } from 'vitest';
import type { ClientPlatform, CosmeticPack, CosmeticPackAsset, CosmeticPackManifest, CosmeticPiece } from '@diskort/shared';
import { cosmeticPackAsset, cosmeticPackOf, cosmeticPackPoster } from '@diskort/client-core';
import { pieceSource, playableKinds, STACKED_VIDEO_PLATFORMS, type PackLookup, type PhoneOS } from '../src/components/cosmetics/packSource';

const BASE = 'https://sunucu.test';
const VERSION = '0123456789abcdef';

const file = (id: string, name: string, kind: CosmeticPackAsset['kind'], width: number, height: number, extra: Partial<CosmeticPackAsset> = {}): CosmeticPackAsset => ({
  kind,
  url: `/api/cosmetics/packs/${id}/${VERSION}/${name}`,
  width,
  height,
  bytes: 1000,
  ...extra,
});

function pack(id: string, platforms: CosmeticPack['platforms'], over: Partial<Record<CosmeticPiece, CosmeticPackAsset[]>> = {}): CosmeticPack {
  return {
    id,
    label: 'Kristal Buz',
    accent: '#9fe6ff',
    from: '#0b2a44',
    to: '#6fb3d9',
    fallback: ['#04101c', '#2a5d80', 'rgba(180,235,255,.35)'],
    description: '',
    pieces: ['', '', ''],
    loopSeconds: 6,
    fps: 30,
    platforms,
    version: VERSION,
    assets: {
      card: [
        file(id, 'card.avif', 'avif', 600, 900),
        file(id, 'card.mp4', 'stacked-h264', 600, 900, { stackedWidth: 1216, alphaX: 616 }),
        file(id, 'card-poster.webp', 'poster', 600, 900),
      ],
      deco: [file(id, 'deco.webp', 'webp', 264, 264), file(id, 'deco-poster.webp', 'poster', 264, 264)],
      plate: [file(id, 'plate.avif', 'avif', 446, 80), file(id, 'plate.webp', 'webp', 446, 80), file(id, 'plate-poster.webp', 'poster', 446, 80)],
      ...over,
    },
  };
}

const lookup = (manifest: CosmeticPackManifest | null, platform: ClientPlatform): PackLookup => ({
  info: (id) => cosmeticPackOf(manifest, id),
  asset: (id, piece, kinds) => cosmeticPackAsset(manifest, BASE, id, piece, platform, kinds),
  poster: (id, piece) => cosmeticPackPoster(manifest, BASE, id, piece, platform),
});

const manifest: CosmeticPackManifest = {
  version: VERSION,
  packs: [
    pack('buz', ['desktop', 'android', 'ios']),
    pack('neon', ['desktop']),
    pack('sakura', ['android', 'ios'], { card: [file('sakura', 'card.webp', 'webp', 300, 450), file('sakura', 'card-poster.webp', 'poster', 600, 900)] }),
    pack('kuzey', ['android', 'ios'], { deco: [file('kuzey', 'deco.avif', 'avif', 264, 264)] }),
  ],
};

const source = (id: string | null, piece: CosmeticPiece, os: PhoneOS) => pieceSource(lookup(manifest, os), id, piece, os);

describe('oynatılabilen türler', () => {
  it('dekorasyon ve plaka: hareketli WebP', () => {
    for (const os of ['android', 'ios'] as const) {
      expect(playableKinds('deco', os)).toEqual(['webp']);
      expect(playableKinds('plate', os)).toEqual(['webp']);
    }
  });

  it('kart: yan yana video yalnızca desteklenen platformda; WebP her yerde', () => {
    expect(STACKED_VIDEO_PLATFORMS).toEqual(['ios']);
    expect(playableKinds('card', 'ios')).toEqual(['stacked-h264', 'webp']);
    expect(playableKinds('card', 'android')).toEqual(['webp']);
  });
});

describe('pieceSource', () => {
  it('bildirimde olmayan set ve boş kimlik: hiçbir şey', () => {
    expect(source('yok', 'deco', 'android')).toEqual({ kind: 'none' });
    expect(source(null, 'card', 'ios')).toEqual({ kind: 'none' });
    expect(pieceSource(lookup(null, 'android'), 'buz', 'deco', 'android')).toEqual({ kind: 'none' });
  });

  it('dekorasyon ve plaka: hareketli WebP oynatılır, poster sabit resimdir; adresler tam', () => {
    const deco = source('buz', 'deco', 'android');
    expect(deco.kind).toBe('pack');
    if (deco.kind !== 'pack') return;
    expect(deco.asset?.kind).toBe('webp');
    expect(deco.asset?.url).toBe(`${BASE}/api/cosmetics/packs/buz/${VERSION}/deco.webp`);
    expect(deco.poster?.url).toBe(`${BASE}/api/cosmetics/packs/buz/${VERSION}/deco-poster.webp`);
    const plate = source('buz', 'plate', 'ios');
    expect(plate.kind === 'pack' && plate.asset?.kind).toBe('webp');
  });

  it("iOS'ta kart yan yana videoyla oynar", () => {
    const card = source('buz', 'card', 'ios');
    expect(card.kind === 'pack' && card.asset).toMatchObject({ kind: 'stacked-h264', width: 600, height: 900, stackedWidth: 1216, alphaX: 616 });
  });

  it("Android'de kart videosu oynatılmaz: yalnızca poster", () => {
    const card = source('buz', 'card', 'android');
    expect(card.kind).toBe('pack');
    if (card.kind !== 'pack') return;
    expect(card.asset).toBeNull();
    expect(card.poster?.kind).toBe('poster');
  });

  it("pakette kartın hareketli WebP'si varsa Android'de o oynar", () => {
    const card = source('sakura', 'card', 'android');
    expect(card.kind === 'pack' && card.asset).toMatchObject({ kind: 'webp', width: 300, height: 450 });
  });

  it('platformda kapalı paket: setin renklerinden sabit görünüm', () => {
    const plate = source('neon', 'plate', 'android');
    expect(plate.kind).toBe('static');
    expect(plate.kind === 'static' && plate.info.fallback[0]).toBe('#04101c');
    expect(source('neon', 'card', 'ios').kind).toBe('static');
  });

  it('oynatılabilir dosyası da posteri de olmayan parça: sabit görünüm', () => {
    expect(source('kuzey', 'deco', 'android').kind).toBe('static');
  });

  it('yerleşim bilgisi eksik video oynatılmaz', () => {
    const broken: PackLookup = {
      info: () => manifest.packs[0]!,
      asset: () => ({ ...file('buz', 'card.mp4', 'stacked-h264', 600, 900), url: `${BASE}/x` }),
      poster: () => null,
    };
    expect(pieceSource(broken, 'buz', 'card', 'ios').kind).toBe('static');
  });
});
