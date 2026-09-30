import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_FEATURE_COSMETIC_PACKS,
  CLIENT_FEATURE_DM,
  CLIENT_FEATURES_HEADER,
  COSMETIC_PACK_MAX_COUNT,
  COSMETIC_PACK_MAX_FILE_BYTES,
  parseCosmeticPackManifest,
  type CosmeticPackManifest,
  type User,
} from '@diskort/shared';
import { knowsCosmeticPacks, withoutPackCosmetics } from '../src/cosmeticCompat.js';
import { CosmeticPackError, CosmeticPackStore, inspectPackFile, parseBundle } from '../src/cosmeticPacks.js';
import { avif, box, bundle, file, fullFiles, mp4, SIZES, webp, type BundleFile } from './cosmeticPackFixtures.js';
import { auth, connectGateway, startServer, type TestServer } from './helpers.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-kozmetik-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Komut satırı aracının yaptığı gibi: her seferinde yeni bir depo nesnesi (ayrı süreç) */
const cli = (): CosmeticPackStore => new CosmeticPackStore(dir, { recheckMs: 0 });

/** Klasörün bütün içeriği (göreli yollar, sıralı): "depo değişmedi" karşılaştırması için */
function tree(root = dir): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).replaceAll('\\', '/'))
    .sort();
}

const rejects = async (input: unknown, message: RegExp): Promise<void> => {
  await expect(parseBundle(input)).rejects.toThrow(CosmeticPackError);
  await expect(parseBundle(input)).rejects.toThrow(message);
};

/** Dosya listesinde tek dosyayı değiştirir */
const withFile = (name: string, change: (f: BundleFile) => BundleFile): BundleFile[] =>
  fullFiles().map((f) => (f.name === name ? change(f) : f));

describe('yayın paketinin doğrulanması', () => {
  it('geçerli paket: bilgi temizlenir, dosyalar çözülür', async () => {
    const parsed = await parseBundle(bundle('buz', { accent: '#9FE6FF', label: '  Kristal Buz ', platforms: ['ios', 'desktop'] }));
    expect(parsed.info).toMatchObject({ id: 'buz', label: 'Kristal Buz', accent: '#9fe6ff', platforms: ['desktop', 'ios'] });
    expect(parsed.files).toHaveLength(9);
    expect(parsed.files[1]!.info).toMatchObject({ piece: 'card', kind: 'stacked-h264', stackedWidth: 1216, alphaX: 616 });
    expect(parsed.files[0]!.info.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Tanınmayan alanlar saklanmaz
    const extra = await parseBundle({ ...bundle(), pack: { ...bundle().pack, owner: 'x', price: 5 } });
    expect(extra.info).not.toHaveProperty('owner');
    expect(extra.info).not.toHaveProperty('price');
  });

  it('biçim ve kimlik', async () => {
    await rejects(null, /JSON nesnesi/);
    await rejects([], /JSON nesnesi/);
    await rejects({ ...bundle(), format: 2 }, /format/);
    for (const id of ['Buz', 'b', '1buz', 'buz_1', 'buz.1', '../buz', 'a'.repeat(25), '', 'buz/x', 'anim:buz', 7, null]) {
      await rejects(bundle(id as string), /pack\.id/);
    }
    // Kaldırılan eski efektlerin adları: 0.8.x istemciler hâlâ gönderebilir
    for (const id of ['snow', 'sparkles', 'petals']) await rejects(bundle(id), /ayrılmış/);
    await expect(parseBundle(bundle('yeni-set-2'))).resolves.toBeTruthy();
  });

  it('renkler, metinler ve sayılar', async () => {
    const bad = (overrides: Record<string, unknown>, message: RegExp) => rejects(bundle('buz', overrides), message);
    await bad({ accent: 'red' }, /accent/);
    await bad({ from: '#fff' }, /accent/);
    await bad({ to: '#12345g' }, /accent/);
    await bad({ fallback: ['#04101c', '#2a5d80'] }, /fallback/);
    await bad({ fallback: ['#04101c', 'rgba(1,2,3,.5)', '#2a5d80'] }, /fallback/);
    // CSS'e olduğu gibi giren renk: başka hiçbir şey taşıyamaz
    await bad({ fallback: ['#04101c', '#2a5d80', 'rgba(1,2,3,.5);background:url(//x)'] }, /fallback/);
    await bad({ fallback: ['#04101c', '#2a5d80', 'rgba(300,2,3,.5)'] }, /fallback/);
    await bad({ fallback: ['#04101c', '#2a5d80', 'rgba(1,2,3,5)'] }, /fallback/);
    await bad({ fallback: ['#04101c', '#2a5d80', 'var(--x)'] }, /fallback/);
    await bad({ label: '' }, /label/);
    await bad({ label: 'a'.repeat(41) }, /label/);
    await bad({ label: 'Buz\u202egnp' }, /label/);
    await bad({ label: 'Buz\nSet' }, /label/);
    await bad({ description: 'a'.repeat(401) }, /description/);
    await bad({ description: 5 }, /description/);
    await bad({ pieces: ['a', 'b'] }, /pieces/);
    await bad({ pieces: ['a', 'b', 'c'.repeat(161)] }, /pieces/);
    await bad({ loopSeconds: 0 }, /loopSeconds/);
    await bad({ loopSeconds: 61 }, /loopSeconds/);
    await bad({ fps: 29.97 }, /fps/);
    await bad({ fps: 120 }, /fps/);
    await bad({ platforms: ['web'] }, /platforms/);
    await bad({ platforms: ['desktop', 'desktop'] }, /platforms/);
    await bad({ platforms: 'desktop' }, /platforms/);
    // Hiçbir platformda oynatılmayan paket geçerlidir (sabit görünüm)
    await expect(parseBundle(bundle('buz', { platforms: [] }))).resolves.toBeTruthy();
    await expect(parseBundle(bundle('buz', { fallback: ['#04101c', '#2a5d80', 'rgb(1, 2, 3)'] }))).resolves.toBeTruthy();
  });

  it('dosya adları: klasör dışına çıkan, gizli ya da uzantısı türüne uymayan ad alınmaz', async () => {
    const named = (name: string) => bundle('buz', {}, withFile('card.avif', (f) => ({ ...f, name })));
    for (const name of [
      '../card.avif',
      '..\\card.avif',
      'a/card.avif',
      '/etc/card.avif',
      '.card.avif',
      '..',
      'card.avif/',
      'CARD.avif',
      'card .avif',
      'card%2f.avif',
      'card\u0000.avif',
      `${'a'.repeat(40)}.avif`,
      '',
    ]) {
      await rejects(named(name), /files\[0\]\.name/);
    }
    // Uzantı türe uymalı
    await rejects(named('card.webp'), /uzantısı \.avif/);
    await rejects(named('.avif'), /files\[0\]\.name/);
    await rejects(bundle('buz', {}, withFile('card.mp4', (f) => ({ ...f, name: 'card.mov' }))), /uzantısı \.mp4/);
  });

  it('aynı ad ya da aynı parça/tür iki kez; eksik parça; yalnızca videosu olan parça', async () => {
    const files = fullFiles();
    await rejects(bundle('buz', {}, [...files, { ...files[0]!, piece: 'deco', kind: 'webp', name: 'card.avif' }]), /files\[9\]\.name|uzantısı/);
    await rejects(bundle('buz', {}, [...files, { ...files[2]!, piece: 'deco', kind: 'webp' }]), /birden çok kez/);
    await rejects(bundle('buz', {}, [...files, { ...files[0]!, name: 'card2.avif' }]), /birden çok "avif"/);
    await rejects(bundle('buz', {}, files.filter((f) => f.piece !== 'plate')), /"plate" parçasında en az bir resim/);
    await rejects(bundle('buz', {}, files.filter((f) => f.piece !== 'deco' || f.kind === 'stacked-h264')), /"deco" parçasında en az bir resim/);
    await rejects(bundle('buz', {}, []), /en az bir dosya/);
    await rejects({ format: 1, pack: bundle().pack }, /en az bir dosya/);
    // Yalnızca poster de yeter (hareketsiz set)
    await expect(parseBundle(bundle('buz', {}, files.filter((f) => f.kind === 'poster')))).resolves.toBeTruthy();
  });

  it('içerik bildirilen türde değilse alınmaz (dosya imzası)', async () => {
    const [w, h] = SIZES.card;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const content = (name: string, data: Buffer) => bundle('buz', {}, withFile(name, (f) => ({ ...f, data: data.toString('base64') })));

    await rejects(content('card-poster.webp', png), /WebP değil/);
    await rejects(content('card-poster.webp', html), /WebP değil/);
    await rejects(content('card.avif', webp(w, h, true)), /AVIF değil/);
    await rejects(content('card.avif', mp4(w, h)), /AVIF değil/);
    await rejects(content('card.avif', html), /AVIF değil/);
    await rejects(content('card.mp4', avif(1216, h)), /MP4 değil/);
    await rejects(content('card.mp4', html), /MP4 değil/);
    await rejects(content('card.mp4', mp4(1216, h, 'hvcC')), /H\.264/);
    // Sabit AVIF hareketli sayılmaz; hareketli poster ve sabit "webp" de alınmaz
    await rejects(content('card.avif', avif(w, h, false)), /hareketli AVIF/);
    await rejects(content('card-poster.webp', webp(w, h, true)), /poster sabit/);
    await rejects(
      bundle('buz', {}, [...fullFiles(), file('card', 'webp', 'card.webp', w, h, webp(w, h, false))]),
      /hareketli WebP/,
    );
    // Sonunda artık veri taşıyan ya da kırpılmış dosya
    await rejects(content('card-poster.webp', Buffer.concat([webp(w, h), Buffer.from('gizli')])), /WebP bozuk/);
    await rejects(content('card.avif', Buffer.concat([avif(w, h), Buffer.from('gizli')])), /AVIF değil/);
    await rejects(content('card.mp4', mp4(1216, h).subarray(0, 200)), /MP4 değil/);
  });

  it('boyutlar: bildirilen ölçü dosyanınkiyle ve yan yana videonun yerleşimiyle uyuşmalı', async () => {
    const [w, h] = SIZES.card;
    const edit = (name: string, change: Partial<BundleFile>) => bundle('buz', {}, withFile(name, (f) => ({ ...f, ...change })));
    await rejects(edit('card-poster.webp', { width: w + 1 }), /boyutu 600×900, bildirilen 601×900/);
    await rejects(edit('card.avif', { height: h - 1 }), /boyutu 600×900, bildirilen 600×899/);
    await rejects(edit('card.mp4', { data: mp4(1200, h).toString('base64') }), /genişliği 1200, bildirilen stackedWidth 1216/);
    await rejects(edit('card.mp4', { data: mp4(1216, h - 2).toString('base64') }), /yüksekliği 898/);
    // Kodlayıcının 16'nın katına tamamladığı yükseklik kabul edilir
    await expect(parseBundle(edit('card.mp4', { data: mp4(1216, h + 12).toString('base64') }))).resolves.toBeTruthy();
    await rejects(edit('card.mp4', { data: mp4(1216, h + 16).toString('base64') }), /yüksekliği 916/);

    await rejects(edit('card.mp4', { stackedWidth: 1199 }), /stackedWidth/);
    await rejects(edit('card.mp4', { stackedWidth: undefined }), /stackedWidth/);
    await rejects(edit('card.mp4', { alphaX: 599 }), /alphaX/);
    await rejects(edit('card.mp4', { alphaX: 617 }), /alphaX/);
    await rejects(edit('card.avif', { stackedWidth: 1216, alphaX: 616 }), /yalnızca stacked-h264/);
    await rejects(edit('card.avif', { width: 0 }), /width/);
    await rejects(edit('card.avif', { width: 4096 }), /width/);
    await rejects(edit('card.avif', { height: 12.5 }), /width \/ height/);
    await rejects(edit('card.avif', { piece: 'banner' as never }), /piece/);
    await rejects(edit('card.avif', { kind: 'gif' as never }), /kind/);
  });

  it('base64 ve boyut sınırları', async () => {
    const data = (value: unknown) => bundle('buz', {}, withFile('card.avif', (f) => ({ ...f, data: value as string })));
    await rejects(data(''), /base64 metin/);
    await rejects(data(42), /base64 metin/);
    await rejects(data('AAAA\nAAAA'), /geçerli base64 değil/);
    await rejects(data('AAA'), /geçerli base64 değil/);
    await rejects(data('AA=A'), /geçerli base64 değil/);
    await rejects(data('*'.repeat(8)), /geçerli base64 değil/);

    const [w, h] = SIZES.card;
    // Sınırın bir bayt üstü: çözülmeden, uzunluktan reddedilir
    const huge = webp(w, h, false, COSMETIC_PACK_MAX_FILE_BYTES);
    expect(huge.length).toBeGreaterThan(COSMETIC_PACK_MAX_FILE_BYTES);
    await rejects(
      bundle('buz', {}, withFile('card-poster.webp', (f) => ({ ...f, data: huge.toString('base64') }))),
      /card-poster\.webp\): dosya çok büyük \(en fazla 8 MB\)/,
    );

    // Tek tek sınırın altında ama toplamı 40 MB'ı aşan paket
    const big = 7 * 1024 * 1024;
    const heavy = (['card', 'deco', 'plate'] as const).flatMap((piece) => {
      const [pw, ph] = SIZES[piece];
      return [
        file(piece, 'poster', `${piece}-poster.webp`, pw, ph, webp(pw, ph, false, big)),
        file(piece, 'webp', `${piece}.webp`, pw, ph, webp(pw, ph, true, big)),
      ];
    });
    await rejects(bundle('buz', {}, heavy), /Paket çok büyük \(en fazla 40 MB\)/);
  });

  it('gerçek kodlayıcı çıktısı: sharp ile üretilen sabit ve hareketli WebP, AVIF boyutu', async () => {
    const frame = (r: number) =>
      sharp({ create: { width: 64, height: 32, channels: 4, background: { r, g: 0, b: 0, alpha: 0.5 } } });
    const still = await frame(255).webp().toBuffer();
    const frames = [await frame(255).png().toBuffer(), await frame(10).png().toBuffer()];
    const animated = await sharp(frames, { join: { animated: true } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    const poster = { piece: 'plate', kind: 'poster', name: 'p.webp', width: 64, height: 32 } as const;
    const moving = { piece: 'plate', kind: 'webp', name: 'a.webp', width: 64, height: 32 } as const;
    expect(await inspectPackFile(poster, still)).toBeNull();
    expect(await inspectPackFile(moving, animated)).toBeNull();
    expect(await inspectPackFile(poster, animated)).toMatch(/poster sabit/);
    expect(await inspectPackFile(moving, still)).toMatch(/hareketli WebP/);
    expect(await inspectPackFile({ ...poster, width: 65 }, still)).toMatch(/boyutu 64×32/);

    // Gerçek (sabit) AVIF: boyut "ispe" özelliğinden okunur; dizi olmadığından hareketli sayılmaz
    const stillAvif = await frame(255).avif().toBuffer();
    const meta = { piece: 'plate', kind: 'avif', name: 'a.avif', width: 64, height: 32 } as const;
    expect(await inspectPackFile(meta, stillAvif)).toMatch(/hareketli AVIF/);
    const sequence = Buffer.concat([stillAvif, box('moov', box('mvhd', Buffer.alloc(100)))]);
    expect(await inspectPackFile(meta, sequence)).toBeNull();
    expect(await inspectPackFile({ ...meta, height: 33 }, sequence)).toMatch(/boyutu 64×32, bildirilen 64×33/);
  });
});

describe('paket deposu (komut satırı)', () => {
  it('yayınlama: dosyalar sürüm klasörüne, bilgi manifest.json\'a yazılır; bildirim sözleşmedeki biçimdedir', async () => {
    const pack = await cli().publish(bundle());
    expect(pack.version).toMatch(/^[0-9a-f]{16}$/);
    expect(tree()).toEqual(
      ['manifest.json', ...fullFiles().map((f) => `buz/${pack.version}/${f.name}`)].sort(),
    );
    const onDisk = fs.readFileSync(path.join(dir, 'buz', pack.version, 'card.avif'));
    expect(onDisk.equals(avif(600, 900))).toBe(true);

    const { manifest, json, etag } = cli().served();
    expect(JSON.parse(json)).toEqual(manifest);
    expect(etag).toBe(`"${manifest.version}"`);
    expect(manifest.packs).toHaveLength(1);
    expect(manifest.packs[0]).toMatchObject({
      id: 'buz',
      label: 'Kristal Buz',
      accent: '#9fe6ff',
      fallback: ['#04101c', '#2a5d80', 'rgba(180,235,255,.35)'],
      loopSeconds: 6,
      fps: 30,
      platforms: ['desktop'],
      version: pack.version,
    });
    expect(manifest.packs[0]!.assets.card).toEqual([
      { kind: 'avif', url: `/api/cosmetics/packs/buz/${pack.version}/card.avif`, width: 600, height: 900, bytes: avif(600, 900).length },
      {
        kind: 'stacked-h264',
        url: `/api/cosmetics/packs/buz/${pack.version}/card.mp4`,
        width: 600,
        height: 900,
        bytes: mp4(1216, 900).length,
        stackedWidth: 1216,
        alphaX: 616,
      },
      { kind: 'poster', url: `/api/cosmetics/packs/buz/${pack.version}/card-poster.webp`, width: 600, height: 900, bytes: webp(600, 900).length },
    ]);
    expect(manifest.packs[0]!.assets.deco.map((a) => a.kind)).toEqual(['avif', 'stacked-h264', 'poster']);
    expect(manifest.packs[0]!.assets.plate).toHaveLength(3);
    // Sunucunun içindeki alanlar (özet, yayın zamanı) istemciye gitmez
    expect(json).not.toContain('sha256');
    expect(json).not.toContain('publishedAt');
    // İstemcinin okuyucusu bildirimi olduğu gibi kabul eder
    expect(parseCosmeticPackManifest(JSON.parse(json))).toEqual(manifest);
  });

  it('başarısız yayın depoya dokunmaz', async () => {
    // Boş depoda: klasör bile oluşmaz
    fs.rmSync(dir, { recursive: true });
    await expect(cli().publish(bundle('Buz'))).rejects.toThrow(CosmeticPackError);
    expect(fs.existsSync(dir)).toBe(false);

    await cli().publish(bundle());
    const before = tree();
    const manifest = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    const broken = withFile('plate-poster.webp', (f) => ({ ...f, data: Buffer.from('bozuk').toString('base64') }));
    await expect(cli().publish(bundle('buz', { label: 'Yeni Ad' }, broken))).rejects.toThrow(/WebP değil/);
    await expect(cli().publish(bundle('neon', {}, broken))).rejects.toThrow(/WebP değil/);
    await expect(cli().publish('{')).rejects.toThrow(CosmeticPackError);
    expect(tree()).toEqual(before);
    expect(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).toBe(manifest);
  });

  it('yeniden yayın yerine geçer: yeni sürüm klasörü, eskisi silinir, sıradaki yer korunur', async () => {
    const first = await cli().publish(bundle('buz'));
    await cli().publish(bundle('neon', { label: 'Neon Yağmur' }));
    const second = await cli().publish(bundle('buz', { label: 'Buz 2' }, fullFiles(2)));
    expect(second.version).not.toBe(first.version);
    expect(fs.existsSync(path.join(dir, 'buz', first.version))).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'buz'))).toEqual([second.version]);
    expect(cli().list().map((p) => [p.id, p.label])).toEqual([['buz', 'Buz 2'], ['neon', 'Neon Yağmur']]);

    // Aynı dosyalar, yalnızca bilgi değişti: sürüm (ve adresler) aynı kalır
    const third = await cli().publish(bundle('buz', { label: 'Buz 3', platforms: [] }, fullFiles(2)));
    expect(third.version).toBe(second.version);
    expect(fs.readdirSync(path.join(dir, 'buz'))).toEqual([second.version]);
    expect(cli().list()[0]).toMatchObject({ label: 'Buz 3', platforms: [] });
    // Bildirimin sürümü her değişiklikte değişir
    expect(cli().served().manifest.packs[0]!.version).toBe(second.version);

    // Yayındaki klasörden dosya eksilmişse aynı içerik yeniden yazılır
    fs.rmSync(path.join(dir, 'buz', second.version, 'card.avif'));
    await cli().publish(bundle('buz', { label: 'Buz 3' }, fullFiles(2)));
    expect(fs.existsSync(path.join(dir, 'buz', second.version, 'card.avif'))).toBe(true);
  });

  it('kaldırma, platformlar ve sıra', async () => {
    for (const id of ['buz', 'neon', 'yeni']) await cli().publish(bundle(id));
    const version = cli().served().manifest.version;

    expect(await cli().setPlatforms('neon', ['ios', 'android', 'desktop'])).toEqual(['desktop', 'android', 'ios']);
    expect(await cli().setPlatforms('buz', [])).toEqual([]);
    await expect(cli().setPlatforms('buz', ['web'])).rejects.toThrow(/Platformlar/);
    await expect(cli().setPlatforms('yok', ['ios'])).rejects.toThrow(/"yok" adlı paket yok/);
    expect(cli().list().map((p) => p.platforms)).toEqual([[], ['desktop', 'android', 'ios'], ['desktop']]);
    expect(cli().served().manifest.version).not.toBe(version);

    expect(await cli().setOrder(['yeni', 'buz'])).toEqual(['yeni', 'buz', 'neon']);
    expect(cli().served().manifest.packs.map((p) => p.id)).toEqual(['yeni', 'buz', 'neon']);
    await expect(cli().setOrder(['yeni', 'yeni'])).rejects.toThrow(/birden çok kez/);
    await expect(cli().setOrder(['yok'])).rejects.toThrow(/"yok" adlı paket yok/);
    await expect(cli().setOrder([])).rejects.toThrow(/En az bir/);

    await cli().remove('buz');
    expect(cli().list().map((p) => p.id)).toEqual(['yeni', 'neon']);
    expect(fs.existsSync(path.join(dir, 'buz'))).toBe(false);
    await expect(cli().remove('buz')).rejects.toThrow(/"buz" adlı paket yok/);
    // Kilit dosyası geride kalmaz
    expect(tree().some((f) => f.includes('.lock') || f.includes('.tmp'))).toBe(false);
  });

  it(`en fazla ${COSMETIC_PACK_MAX_COUNT} paket; var olanın güncellenmesi sınıra takılmaz`, async () => {
    await cli().publish(bundle('buz'));
    const file = path.join(dir, 'manifest.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as { format: number; packs: { id: string }[] };
    const packs = [stored.packs[0]!];
    for (let i = 1; i < COSMETIC_PACK_MAX_COUNT; i++) packs.push({ ...stored.packs[0]!, id: `set-${i}` });
    fs.writeFileSync(file, JSON.stringify({ ...stored, packs }));

    await expect(cli().publish(bundle('fazla'))).rejects.toThrow(/En fazla 64 paket/);
    expect(fs.existsSync(path.join(dir, 'fazla'))).toBe(false);
    await expect(cli().publish(bundle('buz', { label: 'Güncel' }))).resolves.toMatchObject({ label: 'Güncel' });
    expect(cli().list()).toHaveLength(COSMETIC_PACK_MAX_COUNT);
  });

  it('aynı anda tek yazan: süren işlemin kilidi beklenir, yarıda kalmış işlemin eski kilidi yok sayılır', async () => {
    fs.writeFileSync(path.join(dir, '.lock'), '');
    await expect(cli().publish(bundle())).rejects.toThrow(/Başka bir yayınlama işlemi sürüyor/);
    expect(tree()).toEqual(['.lock']);
    const old = new Date(Date.now() - 11 * 60_000);
    fs.utimesSync(path.join(dir, '.lock'), old, old);
    await expect(cli().publish(bundle())).resolves.toBeTruthy();
    expect(fs.existsSync(path.join(dir, '.lock'))).toBe(false);
  });

  it('bozuk manifest.json: komut satırı durur (üstüne yazmaz), çalışan sunucu son sağlam hali kullanır', async () => {
    const server = cli();
    await cli().publish(bundle());
    expect(server.knows('buz')).toBe(true);
    const version = server.served().manifest.version;

    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ "format": 1, "packs": [ { "id": "../x" } ] }');
    expect(server.served().manifest.version).toBe(version);
    expect(server.list()).toHaveLength(1);
    expect(() => cli().load()).toThrow(/manifest\.json okunamadı/);
    await expect(cli().publish(bundle('neon'))).rejects.toThrow(/manifest\.json okunamadı/);
    await expect(cli().remove('buz')).rejects.toThrow(/manifest\.json okunamadı/);
    expect(fs.existsSync(path.join(dir, 'neon'))).toBe(false);
  });

  it('çalışan sunucu başka sürecin yayınını fark eder; dosyaya en çok aralıkta bir bakar', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const server = new CosmeticPackStore(dir, { recheckMs: 2000 });
    expect(server.knows('yeni')).toBe(false);
    expect(server.knows('buz')).toBe(true); // yerleşik setler her zaman bilinir
    expect(server.hasCustomIds()).toBe(false);

    await cli().publish(bundle('buz'));
    await cli().publish(bundle('yeni'));
    const stat = vi.spyOn(fs, 'statSync');
    // Aralık dolmadan dosyaya bakılmaz
    now += 1999;
    for (let i = 0; i < 50; i++) expect(server.knows('yeni')).toBe(false);
    expect(stat).not.toHaveBeenCalled();
    now += 1;
    expect(server.knows('yeni')).toBe(true);
    expect(server.hasCustomIds()).toBe(true);
    expect(stat).toHaveBeenCalledTimes(1);

    await cli().remove('yeni');
    now += 2000;
    expect(server.knows('yeni')).toBe(false);
    // Yalnızca yerleşik kimlikli paketler kaldı: eski istemciler için süzmeye gerek yok
    expect(server.hasCustomIds()).toBe(false);
    expect(server.list().map((p) => p.id)).toEqual(['buz']);
  });

  it('dosya yolu yalnızca kayıtlı dosya için kurulur', async () => {
    const pack = await cli().publish(bundle());
    const store = cli();
    expect(store.fileOf('buz', pack.version, 'card.avif')).toEqual({
      path: path.join(dir, 'buz', pack.version, 'card.avif'),
      kind: 'avif',
      bytes: avif(600, 900).length,
    });
    for (const [id, version, name] of [
      ['buz', pack.version, 'yok.avif'],
      ['buz', pack.version, '../../manifest.json'],
      ['buz', pack.version, '..'],
      ['buz', '..', 'manifest.json'],
      ['buz', '0'.repeat(16), 'card.avif'],
      ['..', pack.version, 'card.avif'],
      ['neon', pack.version, 'card.avif'],
      ['buz', pack.version, 'CARD.AVIF'],
      ['buz', pack.version, ''],
    ] as const) {
      expect(store.fileOf(id, version, name), `${id}/${version}/${name}`).toBeNull();
    }
  });
});

describe('komut satırı aracı (cosmetics-cli)', () => {
  it('publish (standart girdiden), list, platforms, order, remove; hatalar çıkış koduyla bildirilir', () => {
    // DATA_DIR/cosmetic-packs varsayılan klasördür
    const run = (args: string[], input = '') =>
      spawnSync(process.execPath, ['--import', 'tsx', 'src/cosmetics-cli.ts', ...args], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATA_DIR: dir },
        encoding: 'utf8',
        input,
      });
    // Aracın yazdığı depo, sunucunun okuduğu gibi okunur (her çağrı ayrı süreç: az sayıda tutulur)
    const listed = () =>
      new CosmeticPackStore(path.join(dir, 'cosmetic-packs'), { recheckMs: 0 }).list().map((p) => [p.id, p.platforms.join('+')]);

    const first = run(['publish'], JSON.stringify(bundle('buz')));
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('Yayınlandı');
    // Windows'ta kaydedilmiş JSON'un başındaki BOM sorun olmaz
    expect(run(['publish'], `\ufeff${JSON.stringify(bundle('yeni-set'))}`).status).toBe(0);
    expect(run(['publish'], JSON.stringify(bundle('buz', { label: 'Buz 2' }))).stdout).toContain('Güncellendi');
    expect(listed()).toEqual([['buz', 'desktop'], ['yeni-set', 'desktop']]);

    const invalid = run(['publish'], JSON.stringify(bundle('Buz')));
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('pack.id');
    const notJson = run(['publish'], 'json değil');
    expect(notJson.status).toBe(1);
    expect(notJson.stderr).toContain('geçerli bir JSON değil');

    expect(run(['platforms', 'buz', 'desktop,ios']).status).toBe(0);
    expect(run(['platforms', 'yeni-set', 'none']).status).toBe(0);
    expect(run(['platforms', 'buz', 'web']).status).toBe(1);
    expect(run(['order', 'yeni-set,buz']).stdout).toContain('Sıra: yeni-set, buz');
    expect(listed()).toEqual([['yeni-set', ''], ['buz', 'desktop+ios']]);
    expect(run(['list']).stdout).toMatch(/yeni-set {2}"Kristal Buz".*\n.*platformlar: yok/);
    const json = JSON.parse(run(['list', '--json']).stdout) as { id: string; label: string }[];
    expect(json.map((p) => [p.id, p.label])).toEqual([['yeni-set', 'Kristal Buz'], ['buz', 'Buz 2']]);

    expect(run(['remove', 'buz']).status).toBe(0);
    const again = run(['remove', 'buz']);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('"buz" adlı paket yok');
    expect(listed()).toEqual([['yeni-set', '']]);
    // Her çağrı ayrı bir süreç başlatır: paralel koşuda varsayılan süre yetmeyebilir
  }, 180_000);
});

describe('eski istemciler için süzme', () => {
  const user = (extra: Partial<User>): User =>
    ({ id: 'u1', username: 'ayse', displayName: 'Ayşe', avatarColor: '#fff', isAdmin: false, ...extra }) as User;

  it('yerleşik olmayan set kimlikleri null olur; yerleşikler ve diğer her şey olduğu gibi kalır', () => {
    const builtin = user({ animatedEffect: 'karadelik', avatarDecoration: 'anim:sakura', nameplate: 'neon' });
    const custom = user({ id: 'u2', animatedEffect: 'yeni-set', avatarDecoration: 'anim:yeni-set', nameplate: 'yeni-set' });
    const mixed = user({ id: 'u3', animatedEffect: 'buz', avatarDecoration: 'anim:yeni-set', nameplate: null });

    const onlyBuiltin = JSON.stringify({ t: 'READY', d: { user: builtin, users: [builtin] } });
    // Yerleşik olmayan kimlik yoksa metin hiç ayrıştırılmaz: aynı nesne döner
    expect(withoutPackCosmetics(onlyBuiltin)).toBe(onlyBuiltin);

    const ready = JSON.stringify({ t: 'READY', d: { user: custom, users: [builtin, custom, mixed], guilds: [{ id: 'g' }] } });
    expect(JSON.parse(withoutPackCosmetics(ready))).toEqual({
      t: 'READY',
      d: {
        user: { ...custom, animatedEffect: null, avatarDecoration: null, nameplate: null },
        users: [
          builtin,
          { ...custom, animatedEffect: null, avatarDecoration: null, nameplate: null },
          { ...mixed, avatarDecoration: null },
        ],
        guilds: [{ id: 'g' }],
      },
    });
    const update = JSON.stringify({ t: 'GUILD_MEMBER_ADD', d: { guildId: 'g', member: { userId: 'u2' }, user: custom } });
    expect(JSON.parse(withoutPackCosmetics(update)).d.user).toMatchObject({ animatedEffect: null, nameplate: null });
  });

  it('mesaj metninde geçen alan adı süzmeyi tetiklemez ve değişmez', () => {
    const content = '"nameplate":"yeni-set" yazınca ne oluyor? "avatarDecoration":"anim:yeni-set"';
    const message = JSON.stringify({ t: 'MESSAGE_CREATE', d: { id: '1', content } });
    expect(withoutPackCosmetics(message)).toBe(message);
    // Süzülen bir mesajın içindeki metin de olduğu gibi kalır
    const both = JSON.stringify({ users: [user({ nameplate: 'yeni-set' })], messages: [{ content }] });
    const result = JSON.parse(withoutPackCosmetics(both));
    expect(result.users[0].nameplate).toBeNull();
    expect(result.messages[0].content).toBe(content);
    expect(withoutPackCosmetics('JSON değil "nameplate":"x"')).toBe('JSON değil "nameplate":"x"');
  });

  it('özellik bildirimi: dizi (IDENTIFY) ya da virgüllü başlık', () => {
    expect(knowsCosmeticPacks([CLIENT_FEATURE_DM, CLIENT_FEATURE_COSMETIC_PACKS])).toBe(true);
    expect(knowsCosmeticPacks('dm, presence ,cosmetic_packs')).toBe(true);
    expect(knowsCosmeticPacks([CLIENT_FEATURE_DM])).toBe(false);
    expect(knowsCosmeticPacks('dm,cosmetic_packs_v2')).toBe(false);
    expect(knowsCosmeticPacks(undefined)).toBe(false);
    expect(knowsCosmeticPacks([7, null, {}])).toBe(false);
  });
});

describe('sunucu uçları', () => {
  let server: TestServer;
  /** Paketleri tanıyan (yeni) istemcinin başlığı */
  const modern = { [CLIENT_FEATURES_HEADER]: 'dm,presence,cosmetic_packs' };

  beforeEach(async () => {
    server = await startServer({ cosmeticPacksDir: dir, cosmeticPacksRecheckMs: 0 });
  });

  afterEach(async () => {
    await server.close();
  });

  const get = (url: string, headers: Record<string, string> = {}) => server.app.inject({ method: 'GET', url, headers });
  const patchMe = (token: string, payload: object, headers: Record<string, string> = modern) =>
    server.app.inject({ method: 'PATCH', url: '/api/me', headers: { ...auth(token), ...headers }, payload });
  const me = async (token: string, headers: Record<string, string> = modern): Promise<User> =>
    (await server.app.inject({ method: 'GET', url: '/api/me', headers: { ...auth(token), ...headers } })).json() as User;

  it('bildirim: kimlik doğrulamasız, ETag ve kısa önbellek; yayın sunucu yeniden başlatılmadan görünür', async () => {
    const empty = await get('/api/cosmetics/packs');
    expect(empty.statusCode).toBe(200);
    expect(empty.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(empty.headers['cache-control']).toBe('public, max-age=60');
    const body = empty.json() as CosmeticPackManifest;
    expect(body.packs).toEqual([]);
    expect(empty.headers.etag).toBe(`"${body.version}"`);
    expect((await get('/api/cosmetics/packs', { 'if-none-match': `"${body.version}"` })).statusCode).toBe(304);
    // Eski katalog ucu olduğu gibi duruyor
    expect((await get('/api/cosmetics')).json()).toEqual({ decorations: [], frames: [] });

    const pack = await cli().publish(bundle());
    const after = await get('/api/cosmetics/packs', { 'if-none-match': `"${body.version}"` });
    expect(after.statusCode).toBe(200);
    const manifest = after.json() as CosmeticPackManifest;
    expect(manifest.version).not.toBe(body.version);
    expect(manifest.packs.map((p) => [p.id, p.version])).toEqual([['buz', pack.version]]);
    expect(parseCosmeticPackManifest(manifest)).toEqual(manifest);
  });

  it('dosya: türüne göre Content-Type, süresiz önbellek, nosniff; Range ve If-None-Match', async () => {
    const pack = await cli().publish(bundle());
    const base = `/api/cosmetics/packs/buz/${pack.version}`;
    const video = mp4(1216, 900);

    const full = await get(`${base}/card.mp4`);
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload.equals(video)).toBe(true);
    expect(full.headers).toMatchObject({
      'content-type': 'video/mp4',
      'content-length': String(video.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
      'cross-origin-resource-policy': 'cross-origin',
      etag: `"${pack.version}-card.mp4"`,
    });
    expect(full.headers['content-security-policy']).toContain("default-src 'none'");
    expect((await get(`${base}/card.avif`)).headers['content-type']).toBe('image/avif');
    expect((await get(`${base}/card-poster.webp`)).headers['content-type']).toBe('image/webp');
    expect((await get(`${base}/card.avif`)).rawPayload.equals(avif(600, 900))).toBe(true);

    const part = await get(`${base}/card.mp4`, { range: 'bytes=10-49' });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 10-49/${video.length}`);
    expect(part.headers['content-length']).toBe('40');
    expect(part.headers['content-type']).toBe('video/mp4');
    expect(part.rawPayload.equals(video.subarray(10, 50))).toBe(true);
    const tail = await get(`${base}/card.mp4`, { range: 'bytes=-16' });
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload.equals(video.subarray(video.length - 16))).toBe(true);
    const open = await get(`${base}/card.mp4`, { range: 'bytes=0-' });
    expect(open.statusCode).toBe(206);
    expect(open.headers['content-range']).toBe(`bytes 0-${video.length - 1}/${video.length}`);

    const beyond = await get(`${base}/card.mp4`, { range: `bytes=${video.length}-` });
    expect(beyond.statusCode).toBe(416);
    expect(beyond.headers['content-range']).toBe(`bytes */${video.length}`);
    // If-Range başka bir sürümü gösteriyorsa dosyanın tamamı gönderilir
    expect((await get(`${base}/card.mp4`, { range: 'bytes=0-9', 'if-range': '"baska"' })).statusCode).toBe(200);

    const cached = await get(`${base}/card.mp4`, { 'if-none-match': `"${pack.version}-card.mp4"` });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');
    // HEAD: gövdesiz, aynı başlıklar
    const head = await server.app.inject({ method: 'HEAD', url: `${base}/card.mp4` });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe(String(video.length));

    // Başka kökenden (masaüstü uygulaması) okunabilir: video karesi tuvale/WebGL'e çizilebilsin
    const cross = await get(`${base}/card.mp4`, { origin: 'http://localhost:5173', range: 'bytes=0-9' });
    expect(cross.statusCode).toBe(206);
    expect(cross.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('başka kökenden istekler: özellik başlığı ve koşullu bildirim isteği ön denetimden geçer', async () => {
    const preflight = (url: string, headers: string) =>
      server.app.inject({
        method: 'OPTIONS',
        url,
        headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET', 'access-control-request-headers': headers },
      });
    const me = await preflight('/api/me', `authorization,${CLIENT_FEATURES_HEADER}`);
    expect(me.statusCode).toBe(204);
    expect(me.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(me.headers['access-control-allow-headers'])).toContain(CLIENT_FEATURES_HEADER);
    const manifest = await preflight('/api/cosmetics/packs', 'if-none-match');
    expect(manifest.statusCode).toBe(204);
    expect(String(manifest.headers['access-control-allow-headers'])).toContain('if-none-match');
    const res = await get('/api/cosmetics/packs', { origin: 'http://localhost:5173' });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('dosya: kayıtlı olmayan ad, eski sürüm ve klasör dışına çıkma denemeleri 404', async () => {
    const pack = await cli().publish(bundle());
    fs.writeFileSync(path.join(dir, 'buz', pack.version, 'gizli.webp'), webp(8, 8));
    const base = `/api/cosmetics/packs/buz/${pack.version}`;
    for (const url of [
      `${base}/yok.avif`,
      // Klasörde duran ama bildirimde kayıtlı olmayan dosya sunulmaz
      `${base}/gizli.webp`,
      `${base}/..%2F..%2Fmanifest.json`,
      `${base}/%2e%2e%2f%2e%2e%2fmanifest.json`,
      `${base}/..%5C..%5Cmanifest.json`,
      `${base}/card.avif%00.webp`,
      `${base}/CARD.AVIF`,
      `/api/cosmetics/packs/buz/..%2F/manifest.json`,
      `/api/cosmetics/packs/..%2F..%2Fdiskort.db/${pack.version}/card.avif`,
      `/api/cosmetics/packs/buz/${'0'.repeat(16)}/card.avif`,
      `/api/cosmetics/packs/neon/${pack.version}/card.avif`,
      `/api/cosmetics/packs/buz/${pack.version}`,
      `/api/cosmetics/packs/manifest.json`,
      `/api/cosmetics/packs/buz/${pack.version}/card.avif/ek`,
    ]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain('"format"');
    }
    // Dışarıdan yükleme ucu yok
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      expect((await server.app.inject({ method, url: '/api/cosmetics/packs', payload: {} })).statusCode).toBe(404);
      expect((await server.app.inject({ method, url: `${base}/card.avif` })).statusCode).toBe(404);
    }

    // Yeniden yayından sonra eski sürümün adresi 404; yeni adres çalışır
    const next = await cli().publish(bundle('buz', {}, fullFiles(2)));
    expect((await get(`${base}/card.avif`)).statusCode).toBe(404);
    expect((await get(`/api/cosmetics/packs/buz/${next.version}/card.avif`)).statusCode).toBe(200);
    await cli().remove('buz');
    expect((await get(`/api/cosmetics/packs/buz/${next.version}/card.avif`)).statusCode).toBe(404);
  });

  it('seçim doğrulaması dinamik: yalnızca yerleşik setler ∪ yayında olan paketler seçilebilir', async () => {
    const { token } = await server.member('uye');
    const pick = { profileEffect: 'yeni-set', avatarDecoration: 'anim:yeni-set', nameplate: 'yeni-set' };
    expect((await patchMe(token, { profileEffect: 'yeni-set' })).statusCode).toBe(400);
    expect((await patchMe(token, { avatarDecoration: 'anim:yeni-set' })).statusCode).toBe(400);
    expect((await patchMe(token, { nameplate: 'yeni-set' })).statusCode).toBe(400);

    await cli().publish(bundle('yeni-set', { label: 'Yeni Set' }));
    const ok = await patchMe(token, pick);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      profileEffect: null,
      animatedEffect: 'yeni-set',
      avatarDecoration: 'anim:yeni-set',
      nameplate: 'yeni-set',
    });
    // Yerleşik setler paket yayınlanmadan da seçilebilir; parçalar karıştırılabilir
    expect((await patchMe(token, { profileEffect: 'karadelik', nameplate: 'neon' })).json()).toMatchObject({
      animatedEffect: 'karadelik',
      avatarDecoration: 'anim:yeni-set',
      nameplate: 'neon',
    });
    // Biçimi bozuk ya da yayında olmayan kimlikler
    for (const payload of [
      { nameplate: 'Yeni-Set' },
      { nameplate: 'anim:yeni-set' },
      { nameplate: 'diger' },
      { nameplate: 7 },
      { profileEffect: 'diger' },
      { profileEffect: ['yeni-set'] },
      { avatarDecoration: 'anim:diger' },
      { avatarDecoration: 'anim:' },
      { avatarDecoration: 'anim:yeni-set/../x' },
    ]) {
      expect((await patchMe(token, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    // 0.8.x istemcilerin gönderdiği kaldırılmış kimlikler hâlâ sessizce yok sayılır
    const retired = await patchMe(token, { profileEffect: 'snow', avatarDecoration: 'crown', displayName: 'Üye' });
    expect(retired.statusCode).toBe(200);
    expect(retired.json()).toMatchObject({ displayName: 'Üye', animatedEffect: 'karadelik', avatarDecoration: 'anim:yeni-set' });
    expect((await patchMe(token, { profileEffect: null, avatarDecoration: null, nameplate: null })).json()).toMatchObject({
      animatedEffect: null,
      avatarDecoration: null,
      nameplate: null,
    });
  });

  it('yayından kaldırılan paketin kimliği gönderilmez; seçim saklı kalır ve paket dönünce geri gelir', async () => {
    const { token, user } = await server.member('uye');
    await cli().publish(bundle('yeni-set'));
    await patchMe(token, { profileEffect: 'yeni-set', avatarDecoration: 'anim:yeni-set', nameplate: 'buz' });
    expect(await me(token)).toMatchObject({ animatedEffect: 'yeni-set', avatarDecoration: 'anim:yeni-set', nameplate: 'buz' });

    await cli().remove('yeni-set');
    expect(await me(token)).toMatchObject({ animatedEffect: null, avatarDecoration: null, nameplate: 'buz' });
    expect(server.ctx.store.getUser(user.id)).toMatchObject({ animatedEffect: null, avatarDecoration: null, nameplate: 'buz' });
    const row = server.ctx.store.db.prepare('SELECT profile_effect, avatar_decoration FROM users WHERE id = ?').get(user.id);
    expect(row).toEqual({ profile_effect: 'yeni-set', avatar_decoration: 'anim:yeni-set' });
    // Artık seçilemez de
    expect((await patchMe(token, { nameplate: 'yeni-set' })).statusCode).toBe(400);

    await cli().publish(bundle('yeni-set'));
    expect(await me(token)).toMatchObject({ animatedEffect: 'yeni-set', avatarDecoration: 'anim:yeni-set' });
  });

  it('HTTP: paketleri tanıdığını bildirmeyen istemciye yerleşik olmayan kimlikler gitmez', async () => {
    const { token } = await server.member('uye');
    await cli().publish(bundle('yeni-set'));
    await patchMe(token, { profileEffect: 'yeni-set', avatarDecoration: 'anim:yeni-set', nameplate: 'yeni-set' });
    expect(await me(token, modern)).toMatchObject({ animatedEffect: 'yeni-set', avatarDecoration: 'anim:yeni-set', nameplate: 'yeni-set' });
    // Başlıksız (0.9.1 ve öncesi) ya da başka özellikler bildiren istemci
    const legacyHeaders: Record<string, string>[] = [{}, { [CLIENT_FEATURES_HEADER]: 'dm,presence' }];
    for (const headers of legacyHeaders) {
      expect(await me(token, headers)).toMatchObject({ animatedEffect: null, avatarDecoration: null, nameplate: null });
    }
    // Eski istemcinin kendi isteğinin yanıtı da süzülür (seçimi değişmez)
    const legacy = await patchMe(token, { displayName: 'Üye' }, {});
    expect(legacy.json()).toMatchObject({ displayName: 'Üye', animatedEffect: null, avatarDecoration: null, nameplate: null });
    expect(legacy.headers['content-length']).toBe(String(Buffer.byteLength(legacy.body)));
    // Başka kullanıcıları döndüren uçlar da (hesap listesi, giriş)
    const users = (await server.req(server.owner.token, 'GET', '/api/users')).json() as User[];
    expect(users.find((u) => u.username === 'uye')).toMatchObject({ animatedEffect: null, nameplate: null });
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'uye', password: 'sifre12345' } });
    expect(login.json().user).toMatchObject({ animatedEffect: null, avatarDecoration: null, nameplate: null });

    // Yerleşik kimlikler eski istemciye olduğu gibi gider
    await patchMe(token, { profileEffect: 'karadelik', avatarDecoration: 'anim:sakura', nameplate: 'neon' });
    expect(await me(token, {})).toMatchObject({ animatedEffect: 'karadelik', avatarDecoration: 'anim:sakura', nameplate: 'neon' });
  });

  it('gateway: eski oturuma READY ve USER_UPDATE\'te yalnızca yerleşik kimlikler gider', async () => {
    const uye = await server.member('uye');
    await cli().publish(bundle('yeni-set'));
    await patchMe(uye.token, { profileEffect: 'yeni-set', avatarDecoration: 'anim:buz', nameplate: 'yeni-set' });
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    const legacy = await connectGateway(server.app, server.owner.token, [CLIENT_FEATURE_DM]);
    const current = await connectGateway(server.app, server.owner.token, [CLIENT_FEATURE_DM, CLIENT_FEATURE_COSMETIC_PACKS]);
    try {
      const inReady = (ready: { users: User[] }) => ready.users.find((u) => u.id === uye.user.id);
      expect(inReady(current.ready)).toMatchObject({ animatedEffect: 'yeni-set', avatarDecoration: 'anim:buz', nameplate: 'yeni-set' });
      // Yerleşik kimlik (anim:buz) kalır, paket kimlikleri null olur
      expect(inReady(legacy.ready)).toMatchObject({ animatedEffect: null, avatarDecoration: 'anim:buz', nameplate: null });

      await patchMe(uye.token, { avatarDecoration: 'anim:yeni-set', nameplate: 'sakura' });
      await Promise.all([legacy.settle(), current.settle()]);
      expect(current.of('USER_UPDATE').at(-1)).toMatchObject({ animatedEffect: 'yeni-set', avatarDecoration: 'anim:yeni-set', nameplate: 'sakura' });
      expect(legacy.of('USER_UPDATE').at(-1)).toMatchObject({ animatedEffect: null, avatarDecoration: null, nameplate: 'sakura' });
    } finally {
      legacy.ws.close();
      current.ws.close();
    }
  });
});
