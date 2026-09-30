import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CosmeticPack, CosmeticPackManifest, User } from '@diskort/shared';
import {
  configureClient,
  cosmeticPackAsset,
  cosmeticPackOf,
  cosmeticPackPoster,
  cosmeticPacks,
  cosmeticRenderMode,
  cosmeticSetInfo,
  cosmeticSetLabel,
  isKnownCosmeticSet,
  noteCosmeticUsers,
  refreshCosmeticPacks,
  selectableCosmeticSets,
  unknownCosmeticSets,
  useCosmeticPacks,
  type KeyValueStorage,
} from '../src';
import { hydrateCosmeticPacks } from '../src/cosmeticPacks';

const VERSION = 'a1b2c3d4e5f60718';

/** Bildirimdeki bir paket: her parçada avif + yan yana video + poster */
function pack(id: string, overrides: Partial<CosmeticPack> = {}): CosmeticPack {
  const url = (name: string): string => `/api/cosmetics/packs/${id}/${VERSION}/${name}`;
  const assets = (piece: string, w: number, h: number) => [
    { kind: 'avif' as const, url: url(`${piece}.avif`), width: w, height: h, bytes: 1000 },
    { kind: 'stacked-h264' as const, url: url(`${piece}.mp4`), width: w, height: h, bytes: 2000, stackedWidth: 2 * w + 16, alphaX: w + 16 },
    { kind: 'poster' as const, url: url(`${piece}-poster.webp`), width: w, height: h, bytes: 300 },
  ];
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
    assets: { card: assets('card', 600, 900), deco: assets('deco', 264, 264), plate: assets('plate', 480, 84) },
    ...overrides,
  };
}

const manifestOf = (packs: CosmeticPack[], version = '00112233445566ff'): CosmeticPackManifest => ({ version, packs });

const BASE = 'http://sunucu.test';
const user = (extra: Partial<User>): Pick<User, 'animatedEffect' | 'avatarDecoration' | 'nameplate'> => extra;

describe('saf seçiciler', () => {
  const m = manifestOf([
    pack('sakura', { label: 'Sakura', platforms: ['desktop', 'android'] }),
    pack('yeni-set', { label: 'Yeni Set' }),
    pack('buz', { platforms: [] }),
  ]);

  it('seçilebilir setler: bildirimdeki paketler, bildirimdeki sırayla; bildirim yoksa boş', () => {
    expect(selectableCosmeticSets(m)).toEqual(['sakura', 'yeni-set', 'buz']);
    // Aynı bildirim için aynı dizi (durum seçicisinde yeniden çizim tetiklemez)
    expect(selectableCosmeticSets(m)).toBe(selectableCosmeticSets(m));
    expect(selectableCosmeticSets(null)).toEqual([]);
    expect(selectableCosmeticSets(null)).toBe(selectableCosmeticSets(undefined));
    // Yerleşik setler bildirimde yoksa listede de yok (istemcide yerleşik tablo kullanılmaz)
    expect(selectableCosmeticSets(manifestOf([]))).toEqual([]);
  });

  it('bilgi ve ad bildirimden gelir; tanınmayan kimlikte null', () => {
    expect(cosmeticSetLabel(m, 'sakura')).toBe('Sakura');
    expect(cosmeticSetInfo(m, 'yeni-set')).toMatchObject({
      accent: '#9fe6ff',
      from: '#0b2a44',
      to: '#6fb3d9',
      fallback: ['#04101c', '#2a5d80', 'rgba(180,235,255,.35)'],
      description: 'Açıklama',
      pieces: ['kart', 'dekorasyon', 'plaka'],
      loopSeconds: 6,
      fps: 30,
    });
    expect(cosmeticPackOf(m, 'yeni-set')).toBe(m.packs[1]);
    for (const id of ['karadelik', 'yok', '', null, undefined]) {
      expect(cosmeticSetInfo(m, id)).toBeNull();
      expect(cosmeticSetLabel(m, id)).toBeNull();
      expect(isKnownCosmeticSet(m, id)).toBe(false);
    }
    // Bildirim yokken hiçbir set tanınmaz (yerleşikler de)
    expect(cosmeticSetInfo(null, 'sakura')).toBeNull();
    expect(cosmeticSetLabel(undefined, 'sakura')).toBeNull();
    expect(isKnownCosmeticSet(m, 'buz')).toBe(true);
  });

  it('dosya: tercih sırasına göre ilk bulunan tür, tam adresle', () => {
    expect(cosmeticPackAsset(m, BASE, 'sakura', 'card', 'desktop', ['avif', 'stacked-h264'])).toEqual({
      kind: 'avif',
      url: `${BASE}/api/cosmetics/packs/sakura/${VERSION}/card.avif`,
      width: 600,
      height: 900,
      bytes: 1000,
    });
    // Tercih sırası istemcinindir, bildirimdeki sıra değil
    expect(cosmeticPackAsset(m, BASE, 'sakura', 'deco', 'android', ['stacked-h264', 'avif'])).toMatchObject({
      kind: 'stacked-h264',
      url: `${BASE}/api/cosmetics/packs/sakura/${VERSION}/deco.mp4`,
      stackedWidth: 544,
      alphaX: 280,
    });
    // Pakette olmayan tür atlanır
    expect(cosmeticPackAsset(m, BASE, 'sakura', 'plate', 'desktop', ['webp', 'avif'])?.kind).toBe('avif');
    expect(cosmeticPackAsset(m, BASE, 'sakura', 'plate', 'desktop', ['webp'])).toBeNull();
    expect(cosmeticPackAsset(m, BASE, 'sakura', 'plate', 'desktop', [])).toBeNull();
    // Paket bu platformda oynatılmıyor
    expect(cosmeticPackAsset(m, BASE, 'sakura', 'card', 'ios', ['avif'])).toBeNull();
    expect(cosmeticPackAsset(m, BASE, 'yeni-set', 'card', 'android', ['avif'])).toBeNull();
    expect(cosmeticPackAsset(m, BASE, 'buz', 'card', 'desktop', ['avif'])).toBeNull();
    // Tanınmayan set, bildirim yok
    expect(cosmeticPackAsset(m, BASE, 'yok', 'card', 'desktop', ['avif'])).toBeNull();
    expect(cosmeticPackAsset(null, BASE, 'sakura', 'card', 'desktop', ['avif'])).toBeNull();
    // Bildirimdeki nesne değişmez (adres yalnızca dönen kopyada tam)
    expect(m.packs[0]!.assets.card[0]!.url).toBe(`/api/cosmetics/packs/sakura/${VERSION}/card.avif`);
  });

  it('poster: platformda açık paketin sabit resmi', () => {
    expect(cosmeticPackPoster(m, BASE, 'sakura', 'plate', 'android')).toEqual({
      kind: 'poster',
      url: `${BASE}/api/cosmetics/packs/sakura/${VERSION}/plate-poster.webp`,
      width: 480,
      height: 84,
      bytes: 300,
    });
    expect(cosmeticPackPoster(m, BASE, 'sakura', 'plate', 'ios')).toBeNull();
    expect(cosmeticPackPoster(m, BASE, 'buz', 'plate', 'desktop')).toBeNull();
    const noPoster = manifestOf([pack('sade', { assets: { ...pack('sade').assets, deco: pack('sade').assets.deco.slice(0, 1) } })]);
    expect(cosmeticPackPoster(noPoster, BASE, 'sade', 'deco', 'desktop')).toBeNull();
    expect(cosmeticPackPoster(noPoster, BASE, 'sade', 'card', 'desktop')?.kind).toBe('poster');
  });

  it('gösterim kararı: pack | static | none', () => {
    const kinds = ['avif', 'stacked-h264'] as const;
    // Platformda açık ve oynatılabilir dosyası var
    expect(cosmeticRenderMode(m, 'sakura', 'card', 'desktop', kinds)).toBe('pack');
    expect(cosmeticRenderMode(m, 'sakura', 'plate', 'android', ['stacked-h264'])).toBe('pack');
    // Platform listede yok: sabit görünüm (emniyet supabı)
    expect(cosmeticRenderMode(m, 'sakura', 'card', 'ios', kinds)).toBe('static');
    expect(cosmeticRenderMode(m, 'yeni-set', 'deco', 'android', kinds)).toBe('static');
    expect(cosmeticRenderMode(m, 'buz', 'card', 'desktop', kinds)).toBe('static');
    // Platformda açık ama bu istemcinin oynatabildiği tür yok
    expect(cosmeticRenderMode(m, 'sakura', 'card', 'desktop', ['webp'])).toBe('static');
    expect(cosmeticRenderMode(m, 'sakura', 'card', 'desktop', [])).toBe('static');
    // Tanınmayan kimlik: yerleşik set adı da olsa bildirimde yoksa hiçbir şey
    expect(cosmeticRenderMode(m, 'karadelik', 'card', 'desktop', kinds)).toBe('none');
    expect(cosmeticRenderMode(m, 'yok', 'card', 'desktop', kinds)).toBe('none');
    expect(cosmeticRenderMode(m, null, 'card', 'desktop', kinds)).toBe('none');
    expect(cosmeticRenderMode(null, 'sakura', 'card', 'desktop', kinds)).toBe('none');
    // Parça parça: bir parçada oynatılabilir dosya yoksa yalnızca o parça sabit kalır
    const partial = manifestOf([
      pack('yarim', { assets: { ...pack('yarim').assets, plate: pack('yarim').assets.plate.filter((a) => a.kind === 'poster') } }),
    ]);
    expect(cosmeticRenderMode(partial, 'yarim', 'card', 'desktop', kinds)).toBe('pack');
    expect(cosmeticRenderMode(partial, 'yarim', 'plate', 'desktop', kinds)).toBe('static');
  });

  it('kullanıcıların taşıdığı tanınmayan kimlikler', () => {
    expect(
      unknownCosmeticSets(m, [
        user({ animatedEffect: 'sakura', avatarDecoration: 'anim:yeni-set', nameplate: 'buz' }),
        user({ animatedEffect: 'dun-yayinlandi', avatarDecoration: 'anim:karadelik', nameplate: 'dun-yayinlandi' }),
        user({ animatedEffect: null, avatarDecoration: null, nameplate: null }),
        // Biçimi bozuk değerler ve eski katalog kimlikleri set kimliği sayılmaz
        user({ animatedEffect: 'Büyük Harf', avatarDecoration: 'crown', nameplate: '../x' }),
        user({}),
        null,
        undefined,
      ]),
    ).toEqual(['dun-yayinlandi', 'karadelik']);
    expect(unknownCosmeticSets(m, [user({ nameplate: 'sakura' })])).toEqual([]);
    expect(unknownCosmeticSets(null, [user({ nameplate: 'sakura' })])).toEqual(['sakura']);
  });
});

describe('depo', () => {
  const memory = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  };
  let serverUrl = BASE;
  let platform: 'desktop' | 'android' | 'ios' = 'desktop';
  const reset = (): void =>
    useCosmeticPacks.setState({ manifest: null, serverUrl: null, status: 'idle', checkedAt: null, unknownRefreshAt: 0, unknownAsked: [] });

  type Call = { url: string; headers: Record<string, string> };
  /** Bildirimi sunan sahte sunucu: If-None-Match tutuyorsa 304 */
  function serve(current: () => unknown, status = 200): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: { headers?: Record<string, string> }) => {
      const headers = init?.headers ?? {};
      calls.push({ url, headers });
      const body = current() as { version?: string } | null;
      if (status === 200 && body?.version && headers['If-None-Match'] === `"${body.version}"`) {
        return new Response(null, { status: 304 });
      }
      return new Response(JSON.stringify(body), { status });
    });
    return calls;
  }

  beforeEach(async () => {
    memory.clear();
    serverUrl = BASE;
    platform = 'desktop';
    // Platform testte değiştirilebilsin diye okuyucu
    await configureClient({
      get platform() {
        return platform;
      },
      version: '9.9.9',
      storage,
      serverUrl: () => serverUrl,
      notifyError: () => undefined,
    });
    reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('tazeleme bildirimi alır, saklar; değişmediyse 304 ile gövde inmez', async () => {
    const m = manifestOf([pack('buz'), pack('yeni-set')]);
    const calls = serve(() => m);
    await refreshCosmeticPacks();
    expect(calls).toEqual([{ url: `${BASE}/api/cosmetics/packs`, headers: {} }]);
    expect(useCosmeticPacks.getState()).toMatchObject({ manifest: m, serverUrl: BASE, status: 'ready' });
    expect(JSON.parse(memory.get('diskort-cosmetic-packs')!)).toEqual({ serverUrl: BASE, manifest: m });

    const held = useCosmeticPacks.getState().manifest;
    await refreshCosmeticPacks();
    expect(calls[1]!.headers).toEqual({ 'If-None-Match': `"${m.version}"` });
    // Aynı nesne kalır: bileşenler yeniden çizilmez
    expect(useCosmeticPacks.getState().manifest).toBe(held);
    expect(useCosmeticPacks.getState().status).toBe('ready');

    // Depoya ve platforma bağlı seçiciler
    expect(cosmeticPacks.selectable()).toEqual(['buz', 'yeni-set']);
    expect(cosmeticPacks.label('yeni-set')).toBe('Set yeni-set');
    expect(cosmeticPacks.info('buz')?.accent).toBe('#9fe6ff');
    expect(cosmeticPacks.known('karadelik')).toBe(false);
    expect(cosmeticPacks.mode('buz', 'card', ['avif'])).toBe('pack');
    expect(cosmeticPacks.asset('buz', 'card', ['avif'])?.url).toBe(`${BASE}/api/cosmetics/packs/buz/${VERSION}/card.avif`);
    expect(cosmeticPacks.poster('buz', 'plate')?.url).toBe(`${BASE}/api/cosmetics/packs/buz/${VERSION}/plate-poster.webp`);
    platform = 'ios';
    expect(cosmeticPacks.mode('buz', 'card', ['avif'])).toBe('static');
    expect(cosmeticPacks.asset('buz', 'card', ['avif'])).toBeNull();
    expect(cosmeticPacks.poster('buz', 'plate')).toBeNull();
  });

  it('yeni bildirim eskisinin yerine geçer; aynı anda tek istek gider', async () => {
    let m = manifestOf([pack('buz')], '1111111111111111');
    const calls = serve(() => m);
    await Promise.all([refreshCosmeticPacks(), refreshCosmeticPacks(), refreshCosmeticPacks()]);
    expect(calls).toHaveLength(1);

    m = manifestOf([pack('buz', { platforms: [] }), pack('neon')], '2222222222222222');
    await refreshCosmeticPacks();
    expect(useCosmeticPacks.getState().manifest).toEqual(m);
    expect(cosmeticPacks.mode('buz', 'card', ['avif'])).toBe('static');
    expect(JSON.parse(memory.get('diskort-cosmetic-packs')!).manifest.version).toBe('2222222222222222');
  });

  it('maxAgeMs: son başarılı sorgu yeniyse sunucuya sorulmaz', async () => {
    const calls = serve(() => manifestOf([pack('buz')]));
    await refreshCosmeticPacks({ maxAgeMs: 60_000 });
    await refreshCosmeticPacks({ maxAgeMs: 60_000 });
    expect(calls).toHaveLength(1);
    useCosmeticPacks.setState({ checkedAt: Date.now() - 61_000 });
    await refreshCosmeticPacks({ maxAgeMs: 60_000 });
    expect(calls).toHaveLength(2);
    // Süre verilmezse (ayarlar açıldı) her zaman sorulur
    await refreshCosmeticPacks();
    expect(calls).toHaveLength(3);
  });

  it('sunucuya ulaşılamazsa, uç yoksa ya da yanıt bozuksa eldeki bildirim kalır; hata fırlatılmaz', async () => {
    const m = manifestOf([pack('buz')]);
    serve(() => m);
    await refreshCosmeticPacks();

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(refreshCosmeticPacks()).resolves.toBeUndefined();
    expect(useCosmeticPacks.getState()).toMatchObject({ manifest: m, status: 'error' });

    // Eski sunucu: uç yok
    serve(() => ({ error: 'not_found' }), 404);
    await refreshCosmeticPacks();
    expect(useCosmeticPacks.getState().manifest).toEqual(m);
    // Bozuk yanıtlar
    for (const body of [null, 'metin', { packs: [] }, { version: 'kısa', packs: [] }, { version: VERSION, packs: 'x' }]) {
      serve(() => body);
      await refreshCosmeticPacks();
      expect(useCosmeticPacks.getState(), JSON.stringify(body)).toMatchObject({ manifest: m, status: 'error' });
    }
    // Hiç bildirim yokken de: depo boş kalır
    reset();
    memory.clear();
    serve(() => ({ error: 'not_found' }), 404);
    await refreshCosmeticPacks();
    expect(useCosmeticPacks.getState()).toMatchObject({ manifest: null, status: 'error' });
    expect(cosmeticPacks.selectable()).toEqual([]);
    expect(memory.has('diskort-cosmetic-packs')).toBe(false);
  });

  it('bildirimdeki geçersiz kayıtlar ayıklanır: bozuk paket, yabancı adres, tanınmayan tür ve platform', async () => {
    const good = pack('buz');
    serve(() => ({
      version: VERSION,
      packs: [
        {
          ...good,
          platforms: ['desktop', 'tv'],
          assets: {
            ...good.assets,
            card: [
              ...good.assets.card,
              { kind: 'webm-alpha', url: `/api/cosmetics/packs/buz/${VERSION}/card.webm`, width: 600, height: 900, bytes: 5 },
              { kind: 'webp', url: 'https://kotu.example/card.webp', width: 600, height: 900, bytes: 5 },
              { kind: 'webp', url: `/api/cosmetics/packs/neon/${VERSION}/card.webp`, width: 600, height: 900, bytes: 5 },
              { kind: 'webp', url: `/api/cosmetics/packs/buz/${VERSION}/../../x.webp`, width: 600, height: 900, bytes: 5 },
            ],
          },
        },
        { ...pack('kotu-renk'), accent: 'red;background:url(//x)' },
        { ...pack('Kotu-Kimlik') },
        { ...pack('buz'), label: 'İkinci kez' },
        'paket değil',
      ],
    }));
    await refreshCosmeticPacks();
    const manifest = useCosmeticPacks.getState().manifest!;
    expect(manifest.packs.map((p) => p.id)).toEqual(['buz']);
    expect(manifest.packs[0]!.platforms).toEqual(['desktop']);
    expect(manifest.packs[0]!.label).toBe('Set buz');
    expect(manifest.packs[0]!.assets.card.map((a) => a.kind)).toEqual(['avif', 'stacked-h264', 'poster']);
  });

  it('saklanan bildirim açılışta yüklenir (çevrimdışı kaynak); başka sunucunun bildirimi kullanılmaz', async () => {
    const m = manifestOf([pack('buz')]);
    memory.set('diskort-cosmetic-packs', JSON.stringify({ serverUrl: BASE, manifest: m }));
    await hydrateCosmeticPacks();
    expect(useCosmeticPacks.getState()).toMatchObject({ manifest: m, serverUrl: BASE });
    // Çevrimdışı: tazeleme başarısız olsa da saklanan bildirimle gösterilir
    await refreshCosmeticPacks();
    expect(useCosmeticPacks.getState().status).toBe('error');
    expect(cosmeticPacks.mode('buz', 'card', ['avif'])).toBe('pack');

    reset();
    serverUrl = 'http://baska.test';
    await hydrateCosmeticPacks();
    expect(useCosmeticPacks.getState().manifest).toBeNull();

    // Bozuk kayıt yok sayılır
    serverUrl = BASE;
    for (const raw of ['{', '"metin"', JSON.stringify({ serverUrl: BASE, manifest: { version: 'x' } })]) {
      memory.set('diskort-cosmetic-packs', raw);
      await expect(hydrateCosmeticPacks()).resolves.toBeUndefined();
      expect(useCosmeticPacks.getState().manifest).toBeNull();
    }
  });

  it('eşzamansız önbellek deposu (telefon): cacheStorage verilmişse o kullanılır, güvenli depoya yazılmaz', async () => {
    const cache = new Map<string, string>();
    const m = manifestOf([pack('buz')]);
    cache.set('diskort-cosmetic-packs', JSON.stringify({ serverUrl: BASE, manifest: m }));
    await configureClient({
      platform: 'android',
      version: '9.9.9',
      storage,
      cacheStorage: {
        getItem: async (k) => cache.get(k) ?? null,
        setItem: async (k, v) => void cache.set(k, v),
        removeItem: async (k) => void cache.delete(k),
      },
      serverUrl: () => BASE,
      notifyError: () => undefined,
    });
    await vi.waitFor(() => expect(useCosmeticPacks.getState().manifest).toEqual(m));
    const next = manifestOf([pack('buz'), pack('neon')], '3333333333333333');
    serve(() => next);
    await refreshCosmeticPacks();
    await vi.waitFor(() => expect(JSON.parse(cache.get('diskort-cosmetic-packs')!).manifest.version).toBe('3333333333333333'));
    expect(memory.has('diskort-cosmetic-packs')).toBe(false);
  });

  it('sunucu değişince eski sunucunun bildirimi bırakılır', async () => {
    serve(() => manifestOf([pack('buz')]));
    await refreshCosmeticPacks();
    serverUrl = 'http://baska.test/';
    const calls = serve(() => manifestOf([pack('neon')], '4444444444444444'));
    await refreshCosmeticPacks({ maxAgeMs: 60_000 });
    // Öbür sunucunun sürümüyle koşullu istek yapılmaz
    expect(calls).toEqual([{ url: 'http://baska.test/api/cosmetics/packs', headers: {} }]);
    expect(useCosmeticPacks.getState()).toMatchObject({ serverUrl: 'http://baska.test' });
    expect(cosmeticPacks.selectable()).toEqual(['neon']);
    expect(cosmeticPacks.asset('neon', 'card', ['avif'])?.url).toBe(`http://baska.test/api/cosmetics/packs/neon/${VERSION}/card.avif`);
  });

  it('tanınmayan kimlik taşıyan kullanıcı gelince bildirim yeniden istenir: seyrek ve kimlik başına bir kez', async () => {
    let m = manifestOf([pack('buz')], '1111111111111111');
    const calls = serve(() => m);
    await refreshCosmeticPacks();
    expect(calls).toHaveLength(1);
    const t0 = 10_000_000;

    // Tanınan kimlikler istek doğurmaz
    noteCosmeticUsers([user({ animatedEffect: 'buz', avatarDecoration: 'anim:buz', nameplate: null })], t0);
    expect(calls).toHaveLength(1);

    // Yeni paket yayınlanmış: tanınmayan kimlik tazelemeyi tetikler
    m = manifestOf([pack('buz'), pack('yeni-set')], '2222222222222222');
    noteCosmeticUsers([user({ nameplate: 'yeni-set' })], t0);
    expect(calls).toHaveLength(2);
    await vi.waitFor(() => expect(cosmeticPacks.known('yeni-set')).toBe(true));

    // Kısa süre içinde başka bir tanınmayan kimlik: beklenir
    noteCosmeticUsers([user({ avatarDecoration: 'anim:baska' })], t0 + 59_000);
    expect(calls).toHaveLength(2);
    noteCosmeticUsers([user({ avatarDecoration: 'anim:baska' })], t0 + 60_000);
    expect(calls).toHaveLength(3);
    await vi.waitFor(() => expect(useCosmeticPacks.getState().status).toBe('ready'));
    // Tazelemeden sonra da tanınmıyorsa aynı kimlik için yeniden sorulmaz (bildirim değişene dek)
    noteCosmeticUsers([user({ avatarDecoration: 'anim:baska' }), user({ animatedEffect: 'karadelik' })], t0 + 200_000);
    expect(calls).toHaveLength(4); // yalnızca yeni görülen "karadelik" için
    await vi.waitFor(() => expect(useCosmeticPacks.getState().status).toBe('ready'));
    noteCosmeticUsers([user({ avatarDecoration: 'anim:baska' }), user({ animatedEffect: 'karadelik' })], t0 + 400_000);
    expect(calls).toHaveLength(4);
  });
});
