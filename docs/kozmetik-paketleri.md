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
| `id` | `^[a-z][a-z0-9-]{1,23}$`. Yerleşik altı setin kimliği (karadelik, sakura, kuzey, atesbocegi, buz, neon) ya da yeni bir kimlik. `snow`, `sparkles`, `petals` ve her nesnede bulunan adlar (`constructor` gibi) ayrılmıştır. |
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
- **Bir parçanın bütün dosyaları aynı görünen boyutu (`width` × `height`) bildirmelidir** (poster, avif, webp
  ve videonun görünen karesi): oynatıcı kutuyu hareketli dosyanın boyutundan kurar, posteri aynı kutuda
  gösterir. Parçalar birbirinden farklı boyutta olabilir (ör. kart 600×900, dekorasyon 264×264, plaka 446×80).

**Sınırlar:** dosya başına 8 MB, paket başına 40 MB (çözülmüş), en fazla 64 paket.

**İçerik denetimi.** Dosyalar olduğu gibi sunulduğundan türü içeriğinden doğrulanır (dosya imzası; uzantıya
güvenilmez) ve yapısı sağlam olmalıdır: WebP'nin uzunluğu başlığıyla, AVIF/MP4 kutuları dosyanın tamamıyla
uyuşmalı (sonunda artık veri taşınamaz). AVIF görüntü dizisi olmalı (`moov` kutusu), MP4'te H.264 görüntü izi
bulunmalı ve **ses izi olmamalı** (ffmpeg'de `-an`; iOS'ta video AVPlayer ile oynar, sesli dosya uygulamanın
ses oturumuna katılıp süren sesli görüşmeyi bozabilir). Poster yalın WebP de olabilir (`VP8 ` / `VP8L`, `VP8X` başlığı olmadan). Bildirilen ölçüler
dosyanınkiyle tutmalı: resimlerde `width`×`height`, videoda genişlik `stackedWidth` ve yükseklik `height`
(kodlayıcının 16'nın katına tamamladığı en çok 15 piksel fazlası kabul edilir). AVIF'in boyutu üst düzey `meta`
kutusundaki `ispe` özelliğinden, o yoksa iz başlıklarından (`tkhd`) okunur; hiçbiri yoksa dosya reddedilir
(denetim atlanmaz).

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
docker compose exec -T api node dist/cosmetics-cli.js prune           # --all: süresi dolmamış önceki sürümleri de
docker compose exec -T api node dist/cosmetics-cli.js --force-unlock  # takılı kalmış kilidi kaldırır
```

- `publish`: önce paketin tamamı doğrulanır; hata varsa **depoya hiç dokunulmaz**. Aynı kimlik yayındaysa
  yerine geçer (sıradaki yeri korunur). Bildirim (`manifest.json`) yazıldığı an yayın kesinleşir: sonrasındaki
  temizlik bir sorun çıkarırsa yayın başarısız olmaz, araç `Uyarı:` satırı yazar.
- **Yanlış klasöre karşı koruma.** `publish` yalnızca boş (ya da olmayan) bir klasöre ya da bir depoya
  (`manifest.json` olan klasör) yazar; içinde başka şeyler olan, `manifest.json`'suz bir klasörü (ör. `--dir`
  ile yanlışlıkla veri kökü) reddeder. `remove`, `prune`, `platforms` ve `order` depo olmayan klasörde
  çalışmaz ve oraya hiçbir şey yazmaz. Temizlik yalnızca tanıdığını siler: sürüm klasörleri, aracın kendi
  yarım kalmış hazırlık klasörleri (`.tmp-…`) ve yayında olmayan bir kimliğin, içinde bunlardan başka hiçbir
  şey bulunmayan klasörü. Tanınmayan dosya ve klasörlere dokunulmaz, uyarı verilir.
- **Önceki sürüm 24 saat durur.** Yeniden yayında yerini bırakan sürümün dosyaları hemen silinmez: açık
  istemciler bildirimi tazeleyene dek eski adresleri kullanır, o adresler bu sürede çalışmaya devam eder.
  Kimlik başına en fazla **bir** önceki sürüm tutulur (disk sınırlı kalır). 24 saat dolunca eski adresler
  **sunucu tarafında kapanır** (klasör henüz silinmemiş olsa da); klasörün kendisi bir sonraki
  `publish`/`remove` sırasında ya da `prune` ile silinir.
- `remove`: paketi yayından kaldırır ve **bütün sürümlerinin dosyalarını hemen siler** (bekleme süresi yok:
  kaldırılan paketin dosyaları sunulmaya devam etmez). O seti seçmiş kullanıcıların seçimi veritabanında kalır
  ama gönderilmez; paket yeniden yayınlanırsa geri gelir. Klasör silinemezse (içinde tanınmayan bir dosya
  var, dosya o an kullanımda) paket yine yayından kalkmıştır ama araç hata koduyla çıkar: klasörü elle sil.
- `order`: verilen kimlikler bu sırayla başa gelir, diğerleri kendi sıralarıyla arkada kalır. Seçicideki sıra
  budur.
- `prune`: yerini bırakmış, 24 saati geçmiş önceki sürümleri siler; `--all` ile süresi dolmamış olanları da
  (ör. yanlış yayınlanmış bir dosyanın eski adresten de hemen kalkması için).
- **Kilit.** Aynı anda tek yazma işlemi çalışır (`.lock` dosyası; içinde işlemi yapan süreç yazar). Araç
  yarıda kesilirse kilit kendiliğinden devralınır: sahibi artık çalışmıyorsa hemen, değilse 10 dakika sonra.
  Takılı kaldığından eminsen `--force-unlock` kaldırır (tek başına ya da bir komutla birlikte:
  `--force-unlock publish < buz.json`). Başka bir yayın gerçekten sürerken kullanma.
- Çalışan sunucu değişikliği **birkaç saniye içinde kendisi fark eder** (yeniden başlatmak gerekmez).

**İstemciler bildirimi ne zaman tazeler?** Oturum açarken (her bağlanışta), bağlıyken **10 dakikada bir**,
uygulama öne gelince, ayarlardaki seçici açılırken, tanımadıkları bir set görünce ve bir paket dosyası
yüklenemediğinde (en çok dakikada bir). Bildirim değişmediyse yanıt 304'tür (gövde inmez). Yani yeni kimlik
getirmeyen değişiklikler de (platform kapatma, yeniden yayın, kaldırma) açık istemcilere en geç ~10 dakikada
ulaşır; telefonda uygulama arka plandayken sorulmaz, öne gelince hemen sorulur. İstek 15 saniyede bitmezse
iptal edilir (asılı bir bağlantı sonraki tazelemeleri engellemez).

Geliştirirken: `pnpm --filter @diskort/server exec tsx src/cosmetics-cli.ts publish --dir <klasör> < buz.json`
(gerçek paketi sunucuya göndermeden önce doğrulamak için de kullanılır).

## Platform anahtarı (`platforms`)

Paketin **oynatıldığı** platformların listesi. Listede olmayan platformda istemci paketi oynatmaz; setin bilgi
renklerinden sabit bir görünüm gösterir. Emniyet supabıdır: bir platformda oynatma sorun çıkarırsa sürüm
çıkarmadan kapatılır. Açık istemcilere en geç ~10 dakikada ulaşır (bkz. yukarıda, bildirimin tazelenmesi).

```bash
docker compose exec -T api node dist/cosmetics-cli.js platforms buz desktop        # telefonlarda kapat
docker compose exec -T api node dist/cosmetics-cli.js platforms buz desktop,android,ios
docker compose exec -T api node dist/cosmetics-cli.js platforms buz none           # her yerde sabit görünüm
```

Paketler masaüstünde başlar; telefonda oynatma denendikçe platform platform açılır.

## Sunucuda

- Depo: `<DATA_DIR>/cosmetic-packs/` (üretimde `/data/cosmetic-packs`).
  - `manifest.json`: yayınlanmış paketler (gösterim sırasıyla) ve dosyalarının bilgisi; atomik yazılır.
    Klasörü depo yapan da bu dosyadır. Okunurken yalnızca kaydın bütünlüğü denetlenir; yayın kuralları
    (“her parçada bir resim”, “parçanın dosyaları aynı boyutta”) yalnızca yayın anında aranır: sonradan eklenen
    bir kural, yayında olan eski bir paketi geçersiz kılmaz.
  - `<kimlik>/<sürüm>/<dosya adı>`: dosyalar. Sürüm dosyaların içerik özetidir (16 onaltılık): dosyalar
    değişmedikçe aynı kalır, yalnızca bilgi (ad, platformlar, sıra) değişince adresler değişmez. Yayındaki
    sürümün yanında en fazla bir önceki sürüm durur (yerini bıraktığı an klasörün değişiklik zamanıdır; ayrı
    bir kayıt tutulmaz).
  - Veritabanı şeması değişmedi. Paketler yedeklenmez: yayın paketinden yeniden yayınlanabilir.
- `GET /api/cosmetics/packs`: bildirim (kimlik doğrulamasız; `ETag` = gövdedeki `version`, `max-age=60`).
- `GET /api/cosmetics/packs/<kimlik>/<sürüm>/<ad>`: dosya (süresiz önbellek, `nosniff`, HTTP Range).
  - Yayındaki sürümde yalnızca bildirimde kayıtlı dosyalar sunulur (türü kayıttan).
  - Önceki sürümde: paket hâlâ yayında olmalı, sürüm klasörü durmalı ve yerini bırakalı 24 saat geçmemiş
    olmalı, ad biçime uymalı ve uzantısı bir türe karşılık gelmeli (`.avif` / `.webp` / `.mp4`; Content-Type
    yalnızca bundan), dosya doğrudan o klasördeki düz bir dosya olmalı (alt klasör ve sembolik bağ sunulmaz).
  - Kaldırılan paketin hiçbir dosyası sunulmaz. Açılamayan dosya 404'tür; hata yanıtları önbellek başlığı
    taşımaz.
- Kullanıcıların seçebildiği setler: yerleşik altı kimlik ∪ yayında olan paketler. Yerleşik altı kimlik her
  zaman geçerlidir: 0.9.1 ve önceki istemciler onları kendi kodlarıyla çizer.

## Eski istemciler

0.9.1 ve önceki istemciler paketleri tanımaz ve tanımadıkları bir isim plakası kimliğinde bozulur (masaüstünde
çizim döngüsü durur). Bu yüzden sunucu, paketleri tanıdığını bildirmeyen istemciye set seçimlerinde
(`animatedEffect`, `avatarDecoration`, `nameplate`) **yalnızca yerleşik altı kimliği** gönderir; diğerleri `null`
olur. Yeni istemciler bunu gateway'de `IDENTIFY.features` içinde `cosmetic_packs`, HTTP isteklerinde
`X-Diskort-Features` başlığıyla bildirir (bkz. `apps/server/src/cosmeticCompat.ts`).

## Telefonda (Android, iOS)

Telefon setleri kodla çizmez; oynatıcı `apps/mobile/src/components/cosmetics/` altındadır (Skia).

| Parça | Oynatılan dosya | Hareket yokken |
|---|---|---|
| Avatar dekorasyonu (`deco`), isim plakası (`plate`) | `webp` (hareketli WebP) | `poster` |
| Profil efekti (`card`), iOS ve Android 10+ | `stacked-h264`; yoksa `webp` | `poster` |
| Profil efekti (`card`), Android 8–9 | `webp` varsa o; yoksa yalnızca `poster` (hareketsiz) | `poster` |

- **Uygulama en az Android 8 (API 26) ister.** Skia'nın videosu ancak API 26 ve üstüyle derlenen uygulamada
  vardır (`app.config.ts` → `minSdkVersion: 26`).
- **Android 8 ve 9'da kart videosu oynatılmaz** (`packSource.ts` → `STACKED_VIDEO_MIN_ANDROID_API = 29`): Skia'nın
  Android videosu her karede Android 9'da gelen bir yöntemi çağırır (Android 8'de uygulamayı kapatırdı) ve kare
  arabelleğini ancak Android 10'da GPU için açıkça ister. O telefonlarda kartın hareketli olması istenirse pakete
  kart için bir `webp` eklenebilir (kareleri arayüz iş parçacığında çözülür: ağır kalırsa oynatıcı kendiliğinden
  postere döner).
- Android'de video çözücüsü telefonun donanım çözücüsüdür: uygulama arka plana geçince ve kimse oynatmıyorken
  yarım dakika sonra bırakılır; aynı anda en çok bir boşta video tutulur.
- `avif` telefonda kullanılmaz. Poster düz bir resim olarak gösterilir: "hareketi azalt" açıkken, durdurulmuş
  görünümde (seçicide seçili olmayan seçenek, seste konuşmayan katılımcı), ekran dışında ve dosya yüklenirken.
- Küçük avatarlarda (64 pikselden küçük: mesajlar, listeler) dekorasyon yerine setin `accent` renginde sabit bir
  halka çizilir. Paket platformda kapalıysa: halka, plakada `fallback` renklerinden koyu bir zemin, kartta
  afişin üstünde hafif bir ışık.
- Dosyalar cihazda sürümlü adresleriyle önbelleklenir; bildirimde kalmayan sürümler silinir.
