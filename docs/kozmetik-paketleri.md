# Kozmetik paketleri

Hareketli setler (profil efekti, avatar dekorasyonu, isim plakası) istemcide kodla çizilmez; **hazır, kusursuz
döngülü medya dosyaları** olarak sunucudan dağıtılır. Yeni set eklemek için istemci sürümü çıkarmak gerekmez:
paket sunucuya yayınlanır, istemciler bildirimi çalışırken alır.

Ücretsiz bir “mağaza”dır: yayınlanan her set **herkese açıktır**. Sahiplik, satın alma, yetki ya da yönetici
ataması yoktur.

- Sözleşme (tipler, doğrulama): `packages/shared/src/cosmetics.ts`
- Sunucu: `apps/server/src/cosmeticPacks.ts` (depo), `routes/cosmetics.ts` (uçlar), `cosmetics-cli.ts` (araç)
- İstemci: `packages/client-core/src/cosmeticPacks.ts` (bildirim deposu ve seçiciler)

## Yayın paketi

Tek bir UTF-8 JSON dosyası; dosyaların içeriği base64 olarak içindedir.

```json
{
  "format": 1,
  "pack": {
    "id": "buz",
    "label": "Kristal Buz",
    "accent": "#9fe6ff", "from": "#0b2a44", "to": "#6fb3d9",
    "fallback": ["#04101c", "#2a5d80", "rgba(180,235,255,.35)"],
    "description": "Buz köşelerden dallanarak büyür…",
    "pieces": ["profil efekti açıklaması", "dekorasyon açıklaması", "isim plakası açıklaması"],
    "loopSeconds": 6, "fps": 30,
    "platforms": ["desktop"]
  },
  "files": [
    { "piece": "card", "kind": "avif", "name": "card.avif", "width": 600, "height": 900, "data": "<base64>" },
    { "piece": "card", "kind": "stacked-h264", "name": "card.mp4", "width": 600, "height": 900,
      "stackedWidth": 1216, "alphaX": 616, "data": "<base64>" },
    { "piece": "card", "kind": "poster", "name": "card-poster.webp", "width": 600, "height": 900, "data": "<base64>" }
  ]
}
```

**Bilgi (`pack`)**

| Alan | Kural |
|---|---|
| `id` | `^[a-z][a-z0-9-]{1,23}$`. Yerleşik altı setin kimliği (karadelik, sakura, kuzey, atesbocegi, buz, neon) ya da yeni bir kimlik. `snow`, `sparkles`, `petals` ayrılmıştır. |
| `label` | Setin adı, 1–40 karakter |
| `accent`, `from`, `to` | `#rrggbb` |
| `fallback` | Üç renk: ilk ikisi `#rrggbb`, üçüncüsü `#rrggbb` ya da `rgba(r,g,b,a)` / `rgb(r,g,b)` |
| `description` | En fazla 400 karakter |
| `pieces` | Üç açıklama (kart, dekorasyon, plaka), her biri en fazla 160 karakter |
| `loopSeconds`, `fps` | 1–60 sn; 1–60 kare/sn (tam sayı) |
| `platforms` | `desktop`, `android`, `ios` değerlerinden tekrarsız liste (boş olabilir) |

Renkler istemcide CSS'e ve çizime olduğu gibi girdiğinden biçimleri katıdır. Tanınmayan alanlar yok sayılır
(saklanmaz).

**Dosyalar (`files`)**

- `piece`: `card` (profil kartı efekti), `deco` (avatar dekorasyonu), `plate` (isim plakası).
- `kind`:
  - `avif`, `webp`: saydam, **hareketli** resim
  - `stacked-h264`: sıradan, saydam olmayan bir MP4 (H.264); karesi yan yana `[önceden çarpılmış renk | boşluk |
    gri tonlu alfa]`. `width`/`height` görünen kare, `stackedWidth` videonun tam genişliği, `alphaX` alfa
    yarısının başladığı sütun (`width ≤ alphaX ≤ stackedWidth − width`)
  - `poster`: saydam, **sabit** WebP: “hareketi azalt” açıkken, durdurulmuş görünümlerde ve yüklenirken
- `name`: `^[a-z0-9][a-z0-9.-]{0,39}$`, paket içinde tekrarsız; uzantısı türüne uymalı (`.avif`, `.webp`,
  `.mp4`; poster `.webp`).
- `data`: standart base64, boşluk ve satır sonu olmadan.
- Parça başına her türden en fazla bir dosya. **Üç parçanın da** en az bir resmi (poster, avif ya da webp)
  olmalı; yalnızca video yetmez.
- Boyutlar: görünen kare 8–2048 piksel, `stackedWidth` en fazla 4096.

**Sınırlar:** dosya başına 8 MB, paket başına 40 MB (çözülmüş), en fazla 64 paket.

**İçerik denetimi.** Dosyalar olduğu gibi sunulduğundan türü içeriğinden doğrulanır (dosya imzası; uzantıya
güvenilmez) ve yapısı sağlam olmalıdır: WebP'nin uzunluğu başlığıyla, AVIF/MP4 kutuları dosyanın tamamıyla
uyuşmalı (sonunda artık veri taşınamaz). AVIF görüntü dizisi olmalı (`moov` kutusu), MP4'te H.264 görüntü izi
bulunmalı. Bildirilen ölçüler dosyanınkiyle tutmalı: resimlerde `width`×`height`, videoda genişlik
`stackedWidth` ve yükseklik `height` (kodlayıcının 16'nın katına tamamladığı en çok 15 piksel fazlası kabul
edilir).

## Yayınlama

Yükleme için **HTTP ucu yoktur**: paketler yalnızca sunucunun içinden, komut satırı aracıyla yayınlanır
(dışarıya yeni bir kimlik doğrulamalı yüzey açılmaz).

```bash
# Sunucuda (/opt/diskort): paket standart girdiden verilir (-T şart)
docker compose exec -T api node dist/cosmetics-cli.js publish < buz.json
docker compose exec -T api node dist/cosmetics-cli.js list            # --json de olur
docker compose exec -T api node dist/cosmetics-cli.js remove buz
docker compose exec -T api node dist/cosmetics-cli.js platforms buz desktop,android   # ya da: none
docker compose exec -T api node dist/cosmetics-cli.js order sakura,buz,neon
```

- `publish`: önce paketin tamamı doğrulanır; hata varsa **depoya hiç dokunulmaz**. Aynı kimlik yayındaysa
  yerine geçer (sıradaki yeri korunur), eski dosyalar silinir.
- `remove`: paketi yayından kaldırır. O seti seçmiş kullanıcıların seçimi veritabanında kalır ama gönderilmez;
  paket yeniden yayınlanırsa geri gelir.
- `order`: verilen kimlikler bu sırayla başa gelir, diğerleri kendi sıralarıyla arkada kalır. Seçicideki sıra
  budur.
- Çalışan sunucu değişikliği **birkaç saniye içinde kendisi fark eder** (yeniden başlatmak gerekmez).
  İstemciler bildirimi oturum açarken, ayarlardaki seçici açılırken ve tanımadıkları bir set görünce tazeler.

Geliştirirken: `pnpm --filter @diskort/server exec tsx src/cosmetics-cli.ts publish --dir <klasör> < buz.json`
(gerçek paketi sunucuya göndermeden önce doğrulamak için de kullanılır).

## Platform anahtarı (`platforms`)

Paketin **oynatıldığı** platformların listesi. Listede olmayan platformda istemci paketi oynatmaz; setin bilgi
renklerinden sabit bir görünüm gösterir. Emniyet supabıdır: bir platformda oynatma sorun çıkarırsa sürüm
çıkarmadan kapatılır.

```bash
docker compose exec -T api node dist/cosmetics-cli.js platforms buz desktop        # telefonlarda kapat
docker compose exec -T api node dist/cosmetics-cli.js platforms buz desktop,android,ios
docker compose exec -T api node dist/cosmetics-cli.js platforms buz none           # her yerde sabit görünüm
```

Paketler masaüstünde başlar; telefonda oynatma denendikçe platform platform açılır.

## Sunucuda

- Depo: `<DATA_DIR>/cosmetic-packs/` (üretimde `/data/cosmetic-packs`).
  - `manifest.json`: yayınlanmış paketler (gösterim sırasıyla) ve dosyalarının bilgisi; atomik yazılır.
  - `<kimlik>/<sürüm>/<dosya adı>`: dosyalar. Sürüm dosyaların içerik özetidir (16 onaltılık): dosyalar
    değişmedikçe aynı kalır, yalnızca bilgi (ad, platformlar, sıra) değişince adresler değişmez.
  - Veritabanı şeması değişmedi. Paketler yedeklenmez: yayın paketinden yeniden yayınlanabilir.
- `GET /api/cosmetics/packs`: bildirim (kimlik doğrulamasız; `ETag` = gövdedeki `version`, `max-age=60`).
- `GET /api/cosmetics/packs/<kimlik>/<sürüm>/<ad>`: dosya (süresiz önbellek, `nosniff`, HTTP Range). Yalnızca
  bildirimde kayıtlı dosyalar sunulur.
- Kullanıcıların seçebildiği setler: yerleşik altı kimlik ∪ yayında olan paketler. Yerleşik altı kimlik her
  zaman geçerlidir: 0.9.1 ve önceki istemciler onları kendi kodlarıyla çizer.

## Eski istemciler

0.9.1 ve önceki istemciler paketleri tanımaz ve tanımadıkları bir isim plakası kimliğinde bozulur (masaüstünde
çizim döngüsü durur). Bu yüzden sunucu, paketleri tanıdığını bildirmeyen istemciye set seçimlerinde
(`animatedEffect`, `avatarDecoration`, `nameplate`) **yalnızca yerleşik altı kimliği** gönderir; diğerleri `null`
olur. Yeni istemciler bunu gateway'de `IDENTIFY.features` içinde `cosmetic_packs`, HTTP isteklerinde
`X-Diskort-Features` başlığıyla bildirir (bkz. `apps/server/src/cosmeticCompat.ts`).
