# Diskort

10–20 kişilik kapalı topluluklar için Discord kalitesinde **ses**, **ekran paylaşımı** ve **metin kanalları** uygulaması.
Masaüstü (Electron) ve Android (React Native) uygulamaları + kendi sunucun (LiveKit SFU + API).

İndirme sayfası: **https://diskort.ziroo.net**

## Özellikler

- **Ses:** Opus 64 kbps (32–128 ayarlanabilir), DTX + RED (paket kaybına dayanıklı), ~30 ms jitter buffer
- **Gürültü engelleme:** standart (varsayılan) / yapay zekâ: DeepFilterNet 3 ya da daha kaliteli DPDFNet-2 48 kHz
  (uygulamanın içinde, sunucusuz; model ayrı gerçek zamanlı iş parçacığında) / kapalı;
  Android'de de DPDFNet (varsayılan; ONNX Runtime ile telefonda, WebRTC'nin ses işleme hattının sonunda) / standart / kapalı;
  yankı engelleme, otomatik kazanç
- **Ses aktivitesi** (otomatik veya elle eşik) ve **bas-konuş** (global kısayol, fare yan tuşları, bırakma gecikmesi)
- **Sustur / sağırlaştır**, kişi başı ses seviyesi (0–200%) ve yerel susturma (sağ tık)
- **Konuşan göstergesi** (yeşil halka), ping göstergesi, katılma/ayrılma sesleri
- **Ekran paylaşımı:** Discord tarzı pencere/ekran seçici; varsayılan **Otomatik** kalite içeriğe (oyun/video → 60 FPS,
  metin/kod → tam çözünürlük) ve bağlantıya göre ayarlanır (1,5–8 Mbps); sabit 720p30 → 1440p60 (3–15 Mbps), H.264/VP9/VP8/AV1,
  sistem sesi (Windows; sohbet sesleri otomatik hariç tutulur → yankı yok)
- **“Yayını İzle”:** video yalnızca izlemek isteyene gönderilir; tam ekran, yayın sesi ayarı
- Kanala girmeden **kim hangi kanalda**, kim susturulmuş, kim yayında görünür
- **Metin kanalları:** kalıcı mesaj geçmişi (yukarı kaydırdıkça yüklenir), düzenleme (↑ ile son mesaj) ve silme,
  **kalın**/*italik*/~~çizik~~/`kod`/kod bloğu/alıntı/sürpriz (`||metin||`) biçimlendirme, bağlantılar,
  “yazıyor…” göstergesi, okunmamış kanal ve **@bahsetme** rozetleri (sunucuda tutulur, çevrimdışıyken gelenler de
  görünür), bahsetmede bildirim + görev çubuğu uyarısı, “YENİ” ayracı
- **Direkt mesajlar:** bire bir ve küçük grup (en fazla 10 kişi) konuşmaları; metin kanallarının her özelliği
  (biçimlendirme, dosya, tepki, düzenleme/silme, “yazıyor…”, okunmamış rozetleri). Yalnızca konuşmadakiler görür,
  sunucu yöneticileri de okuyamaz. Her mesajda telefon bildirimi (ayrı bildirim kanalı). Üyeye sağ tık (Android'de
  dokun) → “Mesaj Gönder”
- **Emoji tepkileri:** mesajın altında tepki hapları, hızlı tepkiler ve kategorili seçici (canlı güncellenir)
- **Dosya ve resim paylaşımı:** düğme, sürükle-bırak, panodan yapıştırma (Android'de galeri/dosya seçici);
  yükleme ilerlemesi, resimler mesajın içinde, tam boyut görüntüleyici; dosya başına varsayılan en fazla 25 MB.
  JPEG'lerdeki konum (GPS) bilgisi sunucuda silinir
- **Profil fotoğrafı:** masaüstünde sürükle/yakınlaştır kırpma penceresi, Android'de sistemin kırpma ekranı;
  sunucu 256×256 WebP'ye çevirir (konum dahil üst veriler silinir), değişiklik herkese anında yansır.
  Fotoğraf yoksa baş harfler ve profil rengi
- **Davet kodu + hesap** sistemi; **şifre sıfırlama** (yöneticinin verdiği tek kullanımlık kodla) ve şifre değiştirme
- **Roller ve yetkiler** (Discord gibi): renkli, sıralı roller, üye listesinde ayrı gösterme, 19 yetki,
  kanal başına rol izinleri (özel, salt okunur kanallar, yalnızca bazı rollerin girebildiği ses kanalları),
  hiyerarşi; sunucuda susturma/sağırlaştırma, başka kanala taşıma, sesten çıkarma, atma ve yasaklama
  (ayrıntılar: [Roller ve yetkiler](#roller-ve-yetkiler))
- **Sunucu Ayarları** (sunucu adının yanındaki menü): genel, roller, üyeler, davetler, yasaklar, geri bildirimler
- **Uygulama içi geri bildirim:** hata/öneri/diğer, en fazla 3 ekran görüntüsü (masaüstünde yalnızca Diskort
  penceresinin görüntüsü), isteğe bağlı teknik bilgiler; gönderen durumunu "Geri bildirimlerim"de izler
  (ayrıntılar: [Geri bildirim](#geri-bildirim))
- **Yedek bağlantı:** doğrudan UDP kurulamayan ağlarda TURN/UDP 3478, yalnızca 443'e izin veren ağlarda
  (okul, yurt, iş yeri) TURN/TLS 443 — röle üzerinden gecikme doğrudan bağlantıya göre ~2 ms fazla (ölçüldü)
- Tepsiye küçültme, başlangıçta açılma, otomatik güncelleme

| | Windows | Linux | macOS | Android |
|---|---|---|---|---|
| Ses, mute/deafen | ✅ | ✅ | ✅ | ✅ (hoparlör/ahize, ekran kilitliyken de) |
| Metin kanalları | ✅ | ✅ | ✅ | ✅ |
| Tepkiler, dosya/resim paylaşımı | ✅ | ✅ | ✅ | ✅ |
| Direkt mesajlar (bire bir, grup) | ✅ | ✅ | ✅ | ✅ |
| Rol renkleri, üye listesi, gizli kanallar | ✅ | ✅ | ✅ | ✅ |
| Seste yönetim (sustur, taşı, çıkar), at/yasakla, mesaj silme | ✅ | ✅ | ✅ | ✅ (uzun basınca) |
| Rol ve kanal izni düzenleme (Sunucu Ayarları) | ✅ | ✅ | ✅ | ❌ (şimdilik masaüstünde) |
| Ekran/pencere paylaşımı | ✅ | ✅ (Wayland'da sistem seçicisi) | ✅ (sistem seçicisi) | yalnızca izleme (paylaşma planlı) |
| Yayına sistem sesi | ✅ | ❌ (planlı) | ❌ (planlı) | — |
| Global kısayollar / bas-konuş | ✅ | ✅ X11 · ⚠️ Wayland | ✅ (Erişilebilirlik izni) | — |
| Paket | NSIS kurulum (x64) | AppImage, .deb (x64) | .dmg (Apple Silicon, Intel) | APK (Android 7+) |
| Otomatik güncelleme | ✅ | ✅ | ❌ (Apple imzası gerekir; indirme sayfasından) | ✅ arayüz kablosuz (OTA), yerel kısım APK ile |
| Kod imzası | ❌ şimdilik (SmartScreen uyarısı, yalnızca ilk kurulumda); SignPath Foundation hazırlığı: [docs/kod-imzalama.md](docs/kod-imzalama.md) | — | ad-hoc (ilk açılışta “Yine de Aç”) | kendi anahtarımız |

## Roller ve yetkiler

Discord'un modeli, 10–20 kişilik bir arkadaş grubuna göre sadeleştirildi. Hesaplama sunucuda ve istemcilerde
aynı koddur (`packages/shared/src/permissions.ts`); sunucu her isteği ve gateway olayını denetler, istemciler
yalnızca yapılamayacak düğmeleri gizler.

- **Roller:** ad, renk, sıra, "üyeleri ayrı göster" ve yetkiler. Herkeste örtük **@everyone** rolü vardır
  (kimliği topluluğun kimliğidir). Üyenin adının rengi renkli rollerinden en üsttekinin rengidir; üye listesi
  ayrı gösterilen en üst rolüne göre gruplanır.
- **Sahip:** ilk kayıt olan (eski kurulumlarda en eski yönetici). Her yetkiye sahiptir, herkesin üstündedir;
  kimse onu atamaz, yasaklayamaz, rollerini değiştiremez. Hesabını silmeden önce Sunucu Ayarları > Genel'den
  sahipliği devretmelidir.
- **Hiyerarşi:** yalnızca kendi en üst rolünün altındaki rolleri düzenleyip verebilir, yalnızca en üst rolü
  kendisininkinden aşağıda olan üyeleri yönetebilir (at, yasakla, sustur, taşı…). Kimse kendinde olmayan bir
  yetkiyi (rol ya da kanal izni yoluyla) veremez; yönetici hariç.

| Grup | Yetki | @everyone'da |
|---|---|---|
| Genel | Yönetici (her şey, kanal izinlerini aşar), Sunucuyu Yönet (ad), Rolleri Yönet (roller + kanal izinleri), Kanalları Yönet, Davetleri Yönet, Üyeleri At, Üyeleri Yasakla | yok |
| Metin | Kanalları Gör, Mesaj Gönder, Dosya Ekle, Tepki Ekle | var |
| Metin | @everyone Bahset (kanalı gören herkese bildirim) | var |
| Metin | Mesajları Yönet (başkasının mesajını sil) | yok |
| Ses | Bağlan, Konuş, Ekran Paylaş | var |
| Ses | Üyeleri Sustur, Üyeleri Sağırlaştır, Üyeleri Taşı (sesten çıkarma dahil) | yok |

**Kanal izinleri** rol başına "izin ver / varsayılan / engelle"dir. Sıra Discord'daki gibi: @everyone'ın rol
yetkileri → kanalın @everyone izni → üyenin rollerinin kanal izinleri (izin verme engellemeye üstün gelir).
Kanalı göremeyen kanalda hiçbir şey yapamaz; mesaj gönderemeyen dosya ekleyemez ve @everyone kullanamaz;
bağlanamayan ses yetkilerini kullanamaz. Kanal düzenleme penceresindeki "Özel kanal" kısayolu @everyone'dan
kanalı görmeyi alır.

**Görünürlük:** kullanıcı yalnızca görebildiği kanalları, onların mesajlarını, tepkilerini, "yazıyor"unu ve ses
durumlarını alır (READY ve tüm gateway olayları süzülür, REST 404 döner). Rol ya da izin değişince bağlı herkesin
görünümü anında güncellenir (kanal eklenir/kalkar). Dosya ekleri kimlik doğrulamasız ama tahmin edilemeyen
adreslerdendir: adresi önceden bilen, kanalı göremez olsa da dosyayı açabilir.

**Ses:** LiveKit jetonu ve bağlı katılımcının izni kanaldaki yetkilerden gelir (Konuş → mikrofon, Ekran Paylaş →
ekran ve sesi). Sunucuda susturulan üyenin mikrofon izni LiveKit'te alınır (mikrofonu kendisi açamaz, değiştirilmiş
bir istemciyle de); sunucuda sağırlaştırma mikrofonu da alır, duymayı ise uygulama keser. Susturma kalıcıdır
(kanaldan çıkıp girince de sürer). Kendi sunucumuzdaki LiveKit katılımcı taşımayı desteklemediği için **taşıma**
istemci üzerindendir: sunucu hedef kanala bağlanabildiğini denetler, istemciye `VOICE_MOVE` gönderir, istemci o
kanala geçer. Bağlanma yetkisini kaybeden (ya da atılan) sesten çıkarılır.

**Atma ve yasaklama** (tek topluluk, hesap = üyelik): atılanın oturumları kapanır, rolleri ve bildirim
jetonları silinir; hesabı ve mesajları (adıyla) kalır. Geri dönmek için yeni bir davet koduyla "Kayıt ol"
ekranında **kendi kullanıcı adı ve şifresiyle** kaydolur (hesap geri gelir, roller gelmez). Yasaklanan ayrıca
giriş yapamaz ve davetle dönemez; yasak Sunucu Ayarları > Yasaklar'dan kaldırılınca atılmış sayılır. Yasak hesaba
bağlıdır: davet kodu olmadan kimse yeni hesap açamadığı için ona yeni davet verilmemesi yeterlidir. "Hesabı sil"
(yalnızca yönetici) ise hesabı kalıcı olarak siler.

**Rollerden önceki sürümlerden geçiş (şema 8):** yöneticiler "Yönetici" rolüne (Yönetici yetkisi) geçer, en eski
yönetici sahip olur; diğer herkesin bugünkü yetkileri @everyone'da kalır ve hiçbir kanalın izni olmadığından
herkes her kanalı görmeye devam eder. (Şema 8–16 arasında `users.is_admin` rollerden hesaplanıyordu; şema 17'den
beri hesabın kendi bayrağıdır, bkz. "Hesap yöneticileri".) Rollerden önceki istemciler çalışmaya devam eder (`isAdmin` alanı ve "yönetici yap" isteği
yönetici rolünü verir/alır; yeni olayları tanımadan geçerler).

## Hesap yöneticileri

Hesap yöneticiliği **hesabın kendi bayrağıdır** (`users.is_admin`), hiçbir sunucuya bağlı değildir: hiçbir
sunucunun sahipliği ya da Yönetici rolü bunu vermez, alınması da onları etkilemez. Hesap yöneticileri geri
bildirimleri yönetir, yalnızca hesap açtıran davetler oluşturur, şifre sıfırlama kodu üretir ve hesap siler (başka
bir hesap yöneticisininkini değil: önce yöneticiliği alınmalı). İlk hesap (ve yönetici davetiyle açılan hesap)
yöneticidir.

- **Göç (şema 17):** o güne kadar hesap yöneticisi sayılanlar (ana sunucunun sahibi ve orada Yönetici yetkisi
  olan üyeler) yönetici kalır, diğer herkesin bayrağı sıfırlanır.
- **Uygulamada:** Kullanıcı Ayarları > Hesap Yönetimi (yalnızca yöneticilere): "Geri bildirimler (yönetim)" ve
  "Yönetim" (hesap yöneticileri ekle/çıkar, hesap davetleri, hesaplar: sıfırlama kodu, silme). Son yönetici
  çıkarılamaz. Android'de Ayarlar > Hesap yönetimi > Geri bildirimler (yönetim).
- **API:** `GET /api/users` (tüm hesaplar), `GET /api/admins`, `PUT /api/admins/:id`, `DELETE /api/admins/:id`
  (son yönetici: 400 `last_admin`); hepsi hesap yöneticisi ister.
- **Komut satırı** (API imajında `dist/admin-cli.js`; veritabanını doğrudan açar, değişiklik hemen geçerlidir,
  açık uygulamaların arayüzü yeniden bağlanınca güncellenir):

```bash
cd /opt/diskort/infra
docker compose exec api node dist/admin-cli.js list            # hesap yöneticileri (--json)
docker compose exec api node dist/admin-cli.js grant <kullanıcı>
docker compose exec api node dist/admin-cli.js revoke <kullanıcı>   # son yönetici alınamaz
```

## Direkt mesajlar

- **Veri modeli (şema 9):** konuşma da bir kanaldır (`channels.type = 'dm'`, topluluğa bağlı değil); mesajlar,
  dosyalar, tepkiler ve okunma durumu metin kanallarıyla aynı tablolarda ve aynı uçlardan
  (`/api/channels/:id/messages`…). `dm_channels` (bire bir konuşmada iki kişinin anahtarı, grubun sahibi) ve
  `dm_participants` (katılımcılar, konuşma listede açık mı). Göç 9 `channels` tablosunu SQLite'ın önerdiği yolla
  yeniden kurar (yabancı anahtar denetimi göç boyunca kapalı); hiçbir mesaj taşınmaz ya da silinmez.
- **Gizlilik:** yalnızca katılımcılar okur, yazar ve olay alır. Roller, kanal izinleri ve Yönetici yetkisi DM'de
  uygulanmaz; sahip de başkasının konuşmasını hiçbir uçtan göremez (yokmuş gibi 404). Kanal yönetimi ve ses
  uçları DM'lere ulaşamaz. Dosya adresleri, kanallardaki gibi tahmin edilemeyen yetenek adresleridir.
- **Konuşmalar:** aynı iki kişi için tek bire bir konuşma (yeniden açınca aynısı). Boş konuşma karşı tarafta ilk
  mesajla görünür; "Konuşmayı kapat" listeden kaldırır, yeni mesaj gelince geri döner. Grup: en fazla 10 kişi,
  isteğe bağlı ad, her katılımcı kişi ekleyebilir (eklenen geçmişi görür), ayrılan sahipse sahiplik sıradakine geçer,
  son kişi ayrılınca konuşma silinir.
- **Atma/yasaklama:** atılanın mesajları kalır; bire bir konuşmada karşı taraf geçmişi okur ama yazamaz (geri
  dönerse konuşma kaldığı yerden sürer). Hesap silinince konuşmadan düşer; kimse kalmayan konuşma silinir.
- **Eski istemciler:** DM'ler READY'de ayrı alanda (`dms`) ve ayrı olaylarla (`DM_CHANNEL_*`) gelir, yalnızca
  IDENTIFY'da `features: ['dm']` bildiren istemcilere. Bildirmeyen eski sürümler hiçbir DM verisi ya da olayı
  almaz, kanal listeleri değişmez.
- **Telefon bildirimi:** her DM mesajı diğer katılımcılara `diskort-dm` Android kanalından gider; aynı konuşmanın
  bildirimleri üst üste biner (etiket). Dokununca konuşma açılır.
- Veri modeli DM'de sesli aramaya hazır: konuşma bir kanal olduğundan LiveKit odası (`ch_<kimlik>`) ve yetkiler
  (bağlanma, konuşma) aynı yoldan eklenebilir.

## Geri bildirim

Arkadaşlar uygulamanın içinden hata ve öneri gönderir; sahip/yöneticiler inceler, durumunu değiştirir.

- **Gönderme:** masaüstünde sol çubuğun altındaki yeşil düğme ya da Kullanıcı Ayarları > "Geri bildirim gönder";
  Android'de Ayarlar > "Geri bildirim gönder". Tür (Hata / Öneri / Diğer), isteğe bağlı başlık, açıklama (en fazla
  4000 karakter) ve en fazla 3 resim. Masaüstündeki "Uygulamanın ekran görüntüsünü ekle" yalnızca Diskort
  penceresini çeker (`webContents.capturePage`; masaüstü ya da başka pencereler asla), pencere bir anlığına gizlenir.
  Resim dosyası da eklenebilir ya da yapıştırılabilir; Android'de galeriden seçilir.
- **Teknik bilgiler** (kullanıcı "Gönderilecek teknik bilgiler"de görür, kutuyu kaldırıp göndermeyebilir):
  uygulama sürümü, platform, işletim sistemi ve sürümü, cihaz/mimari, ekran ve pencere boyutu, açık görünümün
  türü (metin kanalı / ses sahnesi; mesaj ya da kanal adı değil), seste olup olmadığı ve bu oturumdaki son 10
  uygulama hatasının mesajı. Sunucu bilinmeyen alanları atar.
- **Sınırlar:** kullanıcı başına saatte 5 geri bildirim; resimler en fazla 12 MB, sunucuda WebP'ye çevrilir (en
  uzun kenar 2560 px, EXIF/konum dahil hiçbir üst veri kalmaz) ve `/data/feedback/` altında durur.
- **Ekran görüntüleri herkese açık değildir:** `GET /api/feedback/screenshots/<id>` oturum jetonu ister ve yalnızca
  hesap yöneticilerine ve gönderene verir (masaüstü jetonla indirip blob adresiyle,
  Android başlıklı `<Image>` ile gösterir).
- **Durumlar:** `yeni` → `incelendi` / `planlandi` / `tamamlandi` / `reddedildi`. Yöneticinin notunu gönderen de
  görür ("Yanıt"). Durum değişince gönderenin uygulamasında bildirim çıkar; yeni geri bildirimler yetkililerde
  kırmızı rozetle görünür (Ayarlar dişlisi ve Kullanıcı Ayarları > Geri bildirimler (yönetim); hiçbir sunucuya
  bağlı değil).
- **API:** `POST /api/feedback/screenshots` (ham resim) → `POST /api/feedback` (herkes), `GET /api/feedback/mine`,
  `GET /api/feedback/:id` (gönderen ya da yetkili); `GET /api/feedback?status=&type=`, `GET /api/feedback/stats`,
  `PATCH /api/feedback/:id` (`status`, `adminNote`), `DELETE /api/feedback/:id` (hesap yöneticileri).

### Geri bildirimleri sunucuda okumak (komut satırı)

API imajında `dist/feedback-cli.js` vardır. Veritabanını doğrudan okur (sunucu çalışırken de güvenli); yalnızca
geri bildirim verisini yazdırır, ortam değişkenlerine ve gizli anahtarlara dokunmaz. Sunucuda `infra` klasöründe:

```bash
cd /opt/diskort/infra
docker compose exec api node dist/feedback-cli.js list                     # en yeni 50
docker compose exec api node dist/feedback-cli.js list --status yeni --json # yeni olanlar, JSON
docker compose exec api node dist/feedback-cli.js list --type hata --limit 20
docker compose exec api node dist/feedback-cli.js show 12                   # ayrıntı, teknik bilgiler, resim yolları
docker compose exec api node dist/feedback-cli.js show 12 --json
docker compose exec api node dist/feedback-cli.js set 12 planlandi "0.4.5 ile gelecek"   # durum (+ isteğe bağlı not)
docker compose exec api node dist/feedback-cli.js note 12 "Düzeltildi, güncelle"         # yalnızca not ("" siler)
docker compose exec api node dist/feedback-cli.js stats
```

Ekran görüntüsünü bilgisayara almak: `show` çıktısındaki yolu kullan, ör.
`docker compose cp api:/data/feedback/<id>.webp /tmp/` ve ardından `scp` ile indir.
Komut satırından yapılan değişiklik açık uygulamalara anında gitmez; listeler yeniden açılınca görünür
(uygulamadaki değişiklikler ise anında iletilir).

**Önerilen iş akışı:** yeni geri bildirimleri `list --status yeni --json` ile oku, her birini bir göreve çevir,
`set <id> incelendi` (ya da `planlandi` / `reddedildi` ve kısa bir not) ile işaretle; sürüm çıkınca
`set <id> tamamlandi "0.x.y ile düzeltildi"`. Gönderen durumu ve notu uygulamada görür.

Ekran görüntüleri `infra/backup-attachments.sh` ile her gün `BACKUP_DIR/feedback`'e de kopyalanır; geri
bildirim kayıtları veritabanı yedeğindedir.

## Mimari

```
Masaüstü (Electron + React) ──HTTPS/WSS──► Caddy :443 ──► API (Fastify, SQLite) ◄── webhook ──┐
        │                                   │  └─ indirme sayfası (apps/web)                  │
        │                                   └─ turn.* (SNI) ──► LiveKit TURN/TLS              │
        └──────── WebRTC (UDP 50000–60000) ──────────────────► LiveKit SFU (ses + ekran) ────┘
```

- `apps/desktop` — Electron uygulaması (`src/main` ana süreç, `src/preload` köprü, `src/renderer` arayüz)
  - Ses motoru: `src/renderer/src/features/voice/voiceClient.ts`
  - Mikrofon zinciri (gürültü engelleyici + ses kapısı): `micProcessor.ts`, `gate-worklet.js`, `denoise/`
    (köprü worklet'i ⇄ paylaşımlı halka tamponlar ⇄ ayrı, sessiz AudioContext'te hesap worklet'i; yedek: Web Worker),
    `deepfilter/` (DeepFilterNet 3), `dpdfnet/` (DPDFNet-2 48 kHz, onnxruntime-web).
    `deepfilter/df.wasm` kaynaktan `node scripts/build-deepfilter-wasm.mjs` ile üretilir (Rust gerekir;
    sarmalayıcı: `apps/desktop/deepfilter-wasm`). Çevrimdışı karşılaştırma (WAV + DNSMOS + kare süreleri):
    `apps/desktop/scripts/gurultu-degerlendir.mjs`
  - TURN/TLS portu güvencesi (olası 5349 bildirimini 443'e çevirir): `turnPort.ts`
  - Metin kanalları: `features/messages` (mesaj deposu, biçimlendirme), `components/text` (görünüm)
- `apps/mobile` — Android uygulaması (Expo SDK 57 + React Native, `src/app` ekranlar, `src/voice` sesli sohbet).
  Ekran kilitliyken sesin sürmesi için yerel Android modülü: `modules/voice-service` (ön plan servisi).
  DPDFNet gürültü engelleme: `modules/noise-filter` (Kotlin STFT/ISTFT + onnxruntime-android; model `assets/`).
  `android/` klasörü üretilir (`expo prebuild`), elle düzenlenmez; ayarlar `app.config.ts` ve eklentilerde.
- `apps/server` — API + gateway + LiveKit entegrasyonu, indirme yönlendirmeleri
- `apps/web` — indirme ve gizlilik sayfası (derleme adımı yok; Caddy doğrudan sunar). Butonlar `/download/<platform>`
  adresine gider; API en son GitHub sürümünü bulup dosyaya yönlendirir, kullanıcı GitHub'ı görmez.
- `packages/shared` — sunucu ve istemcilerin ortak tipleri
- `packages/client-core` — masaüstü ve (gelecekteki) mobil uygulamanın ortak mantığı: API, gateway,
  oturum/topluluk/mesaj depoları, biçimlendirme ayrıştırıcısı. Platforma özgü işler (bildirim, ses,
  pencere, depolama) `configureClient()` ile verilir; masaüstü karşılığı `apps/desktop/src/renderer/src/platform.ts`.
  Yeni özellikler önce buraya yazılır, iki arayüz de kullanır.
- `infra` — VPS için Docker Compose, LiveKit, Caddy (katman-4 eklentili), yedekleme betikleri

## Geliştirme (Windows)

Gerekenler: Node.js 22+ ve pnpm (`npm i -g pnpm`).

```bash
pnpm install
```

LiveKit sunucusu (Windows için `tools/livekit/livekit-server.exe` bekler;
[sürümler](https://github.com/livekit/livekit/releases) sayfasından `windows_amd64` zip'ini oraya aç).
Yerel yapılandırma (`infra/livekit.dev.yaml`) tüm medyayı tek UDP portundan (7882) akıtır.

```bash
pnpm dev:livekit
```

Ayrı terminallerde API ve uygulama:

```bash
pnpm dev:server
```

```bash
pnpm dev:desktop
```

İlk açılışta API konsolu **ilk yönetici davet kodunu** yazar. Uygulamada “Davet koduyla kaydol”
ile bu kodu kullan; ilk hesap yönetici olur. Diğer kişiler için Ayarlar → Davetler'den kod üret.
Geliştirme sürümü ayrı bir profil (`%APPDATA%\Diskort-dev`) kullanır, kurulu uygulamaya karışmaz.

Aynı bilgisayarda ikinci bir istemci açmak için (ayrı profil, `dev:desktop` açıkken):

```bash
pnpm dev:desktop2
```

Geliştirme bayrakları: `DISKORT_FAKE_MEDIA=1` (sahte mikrofon/kamera; `DISKORT_FAKE_AUDIO_FILE=<wav>` ile
mikrofon bip yerine o dosyayı çalar), `DISKORT_DEBUG_PORT=9222` (Chrome DevTools Protokolü ile otomatik test).
Paketlenmiş sürümde devre dışıdır.

Testler ve tip kontrolü (GitHub Actions her push'ta da çalıştırır):

```bash
pnpm test
```

```bash
pnpm typecheck
```

## Sunucuya kurulum (VPS)

Önerilen: Türkiye'deki kullanıcılar için İstanbul/Kocaeli lokasyonlu bir VPS veya Hetzner (Almanya/Finlandiya),
2 vCPU / 4 GB RAM yeterli. 20 kişilik ses ≈ 1–2 Mbps; 1080p60 yayını izleyen her kişi ≈ 7 Mbps.

1. Üç alan adının (ör. `diskort.ornek.com`, `lk.ornek.com`, `turn.ornek.com`) DNS A kaydını VPS IP'sine
   yönlendir. Cloudflare kullanılıyorsa kayıtlar **DNS only (gri bulut)** olmalı.
2. Depoyu `/opt/diskort`'a kopyala ve hazırlık betiğini çalıştır (Docker, güvenlik duvarı, günlük yedek
   zamanlayıcısı, rastgele anahtarlar):
   ```bash
   sudo bash infra/setup-vps.sh
   ```
3. `infra/.env` içindeki `DISKORT_DOMAIN`, `LIVEKIT_DOMAIN` ve `TURN_DOMAIN` değerlerini düzenle, sonra:
   ```bash
   cd infra && docker compose up -d --build
   ```
4. İlk yönetici davet kodu için:
   ```bash
   docker compose logs api | grep -i davet
   ```

Sunucuyu güncellemek için:

```bash
cd /opt/diskort && git pull && cd infra && docker compose up -d --build
```

`Caddyfile` değiştiyse Caddy'yi ayrıca yeniden başlat (tek dosya olarak bağlandığı için `git pull` sonrası
eski hâlini görmeye devam eder): `docker compose restart caddy`. LiveKit veya Caddy yeniden başlatılınca
süren görüşmeler birkaç saniye kopar; kimse seste değilken yap.

Açık olması gereken portlar: `80/tcp`, `443/tcp`, `7881/tcp`, `3478/udp`, `50000–60000/udp`
(TURN/TLS 443'ü HTTPS ile paylaşır; 5349 yalnızca sunucunun içinde kullanılır).

### Bakım ve güvenlik

- Güvenlik güncellemeleri her gün otomatik kurulur (`unattended-upgrades`); yeniden başlatma gerekirse
  sunucu gece 05:00'te kendini yeniden başlatır (`/etc/apt/apt.conf.d/52diskort-auto-reboot`).
- SSH yalnızca anahtarla (`/etc/ssh/sshd_config.d/00-diskort-hardening.conf`). Anahtar kaybolursa
  sağlayıcı panelindeki konsoldan root şifresiyle girip bu dosyayı silmek şifre girişini geri açar.

### Yedekleme

- **Sunucuda:** `diskort-backup.timer` her gece 04:00'te (Türkiye saati) `infra/backup-db.sh`'ı çalıştırır.
  Betik tutarlı bir kopya alıp bütünlüğünü kontrol eder ve `/var/backups/diskort/` altına sıkıştırarak koyar.
  Son 14 gün saklanır; `latest.db.gz` her zaman en yenisini gösterir.
- **Sunucu dışında:** `scripts/pull-db-backups.ps1`, Windows Görev Zamanlayıcı'daki "Diskort veritabanı yedeği"
  göreviyle her gün 12:00'de en son yedeği `OneDrive\Yedekler\Diskort` klasörüne indirir (60 gün saklanır,
  sonuçlar `yedek-gunlugu.txt` dosyasına yazılır).
- **Dosya ekleri yedeğe dahil değil:** gece yedeği yalnızca veritabanını (dosyaların adı, boyutu, hangi mesajda
  olduğu) kapsar; dosyaların kendisi `diskort-data` biriminde `/data/attachments/` altında durur. Elle kopya:
  `cd /opt/diskort/infra && docker compose cp api:/data/attachments /var/backups/diskort/ekler-$(date +%F)`.
  Eski bir veritabanı yedeği geri yüklenirse, yedekte karşılığı olmayan dosyalar bir saat içinde kendiliğinden
  silinir; yedekte olup diskte olmayan dosyaların adresi "bulunamadı" döner. Disk dolmasın diye sunucuda 1 GB'tan
  az yer kalınca yükleme reddedilir (tek dosya sınırı: `.env`'de `ATTACHMENT_MAX_MB`, varsayılan 25).
- **Profil fotoğrafları** de yedeğe dahil değil: `/data/avatars/` altında 256×256 WebP (kişi başı birkaç KB).
  Kaybolursa uygulamalar baş harfleri gösterir, kullanıcı fotoğrafını yeniden yükler. Kimsenin kullanmadığı
  dosyalar (ör. eski yedek geri yüklenince) bir saat sonra kendiliğinden silinir.
- **Geri yükleme** (önce mevcut veritabanının güvenlik kopyasını alır):
  ```bash
  bash /opt/diskort/infra/restore-db.sh /var/backups/diskort/diskort-2026-09-27_0400.db.gz
  ```
  Bilgisayardaki bir yedeği geri yüklemek için önce sunucuya kopyala:
  `scp -i ~/.ssh/diskort_vps <dosya>.db.gz root@185.92.0.242:/root/`

## Kurulum ve güncellemeler

**Herkes her zaman en son sürümü kullanır** (Discord'daki gibi):

1. **Açılışta:** uygulama önce küçük bir açılış penceresinde güncellemeyi denetler. Yeni sürüm varsa
   indirir (yalnızca değişen bloklar, genelde birkaç MB), kurar ve yeni sürümle yeniden açılır.
   İnternet yoksa uygulama açılır; bağlanınca sunucu yine denetler.
2. **Sunucuda:** gateway, en son yayınlanan sürümden eski istemcileri kabul etmez (`UPDATE_REQUIRED`);
   uygulama "Güncelleme gerekli" ekranını gösterip güncellemeyi kendisi kurar.
3. **Çalışırken:** yeni sürüm yayınlanınca sunucu bağlı uygulamalara haber verir, güncelleme arka planda
   iner ve üstte "Şimdi yeniden başlat" şeridi çıkar. Kullanıcı seste değilken uygulama 5 dakikadır
   tepside/simge durumundaysa güncelleme sessizce kurulur; uygulamadan çıkınca da kurulur.

Uygulamalar güncellemeyi `https://diskort.ziroo.net/updates/` adresinden ister
(`apps/desktop/src/shared/distribution.ts`); sunucu (`apps/server/src/routes/updates.ts`) dosyaları
GitHub Releases'e yönlendirir. Dağıtım yeri değişirse yalnızca sunucu değişir. macOS'ta Apple imzası
olmadan kendi kendine güncelleme mümkün olmadığından açılış penceresi indirme sayfasına yönlendirir.
Zorunluluk sunucuda `CLIENT_UPDATE_ENFORCE=0` ile kapatılabilir (acil durumlar için).

Windows kurulum düzeni (yönetici izni istemez, `build/installer.nsh`):

| | Konum |
|---|---|
| Uygulama | `%LOCALAPPDATA%\Programs\diskort` |
| Ayarlar ve oturum (kaldırınca silinmez) | `%APPDATA%\Diskort` |
| Günlükler (güncelleme sorunları için) | `%APPDATA%\Diskort\logs\updater.log` |
| İndirilen güncellemeler | `%LOCALAPPDATA%\diskort-updater` |

`appId`, paket adı (`diskort`), `productName` ve `nsis.guid` kurulu uygulamaların birbirini tanıması için
**değiştirilmemelidir** (`apps/desktop/electron-builder.yml`).

### Android APK

APK, GitHub Actions'ta derlenir (`.github/workflows/android.yml`) ve depoda **olmayan** kalıcı bir anahtarla
imzalanır (gizli değişkenler `ANDROID_KEYSTORE_*`; yedeği sahibinin bilgisayarında). Anahtar kaybolursa kurulu
uygulamalar güncellenemez, herkes kaldırıp yeniden kurmak zorunda kalır.

- Test APK'sı: GitHub → Actions → **Android APK** → *Run workflow* (çıktı "artifact" olarak iner). Varsayılan
  yalnızca arm64 derlenir (daha hızlı); *Tüm işlemciler* seçilirse armv7 ve evrensel APK da.
- Sürümde: etiket gönderilince sürüme OTA paketi (`Diskort-<sürüm>-ota-*`) ve APK'lar eklenir; indirme sayfası
  `/download/android` ile hepsini içeren APK'yı sunar.

**Güncellemeler iki katmanlıdır** (masaüstündeki gibi zorunlu):

1. **Kablosuz (OTA), yalnızca arayüz değiştiyse:** uygulama açılırken `https://diskort.ziroo.net/updates/expo/android`
   adresine sorar ([Expo Updates protokolü](https://docs.expo.dev/technical-specs/expo-updates-1/)). Yeni arayüz
   varsa birkaç MB'lık paketi indirip kendini yeniden başlatır; kullanıcı bir şey yapmaz. Uygulama açıkken yeni
   sürüm yayınlanırsa paket arka planda iner, uygulamaya dönünce (seste değilse) uygulanır.
2. **APK, yerel kısım değiştiyse** (Android kodu, yerel kütüphaneler, izinler, Expo/React Native sürümü):
   telefona uygun APK iner (`Diskort-<sürüm>-android-arm64-v8a.apk` / `-armeabi-v7a.apk`, ~50–60 MB) ve
   Android'in kurulum ekranı açılır; son onay kullanıcıdadır (Android sessiz kuruluma izin vermez).

Hangisinin gerektiğine **yerel kısmın parmak izi** karar verir (`apps/mobile/scripts/runtime-version.mjs`,
`@expo/fingerprint`; APK'ya `runtimeVersion` olarak yazılır). OTA paketi yalnızca aynı parmak izli APK'lara
gider. Sürüm derlenirken parmak izi önceki sürümünkiyle aynıysa APK hiç derlenmez, önceki sürümün APK'ları
taşınır (adlarında eski sürüm numarası kalır); böylece yalnızca arayüz değişen bir sürüm ~3 dakikada çıkar.

- OTA paketi ayrı bir anahtarla **imzalanır** (GitHub gizli değişkeni `OTA_SIGNING_KEY`; yedeği sahibinin
  bilgisayarında). Telefon, imzayı uygulamanın içindeki sertifikayla (`apps/mobile/certs/certificate.pem`)
  doğrular; sunucu ele geçirilse bile telefonlara kod gönderilemez. Anahtar kaybolursa OTA durur (APK'lar çalışır);
  yeni anahtar/sertifika yeni bir APK ile dağıtılır.
- Zorunluluk: sürümde OTA varsa sürümün kendisi, yoksa APK'nın sürümü gerekir. Sunucudaki `MIN_ANDROID_VERSION`
  yalnızca bunun altına inilmemesi içindir (normalde boş).
- Yerel derlemeler (`expo run:android`) `runtimeVersion` = `gelistirme` alır ve OTA almaz.
- **Bildirimler (bahsetmeler ve direkt mesajlar, iki ayrı Android kanalı):** sunucu, Google'ın FCM HTTP v1 arayüzüne doğrudan gönderir; Firebase yalnızca
  teslimat yapar. Sunucuda `infra/secrets/fcm.json` (Firebase → Proje ayarları → Service accounts →
  Generate new private key, `chmod 600`) ve `.env`'de `FCM_SERVICE_ACCOUNT_FILE=/run/secrets/fcm.json`.
  Uygulama tarafı `google-services.json` GitHub gizli değişkeni `GOOGLE_SERVICES_JSON`'dan (base64) derlemede yazılır.

### iOS (hazırlık)

iPhone uygulaması App Store'suz, Ad Hoc imzayla kendi sitemizden kurulacak (kayıtlı cihazlar). Derleme ve kod
hazır; Apple Developer hesabı ve imza anahtarları bekleniyor. Adımlar, iOS'a özgü farklar ve eksikler:
[docs/ios.md](docs/ios.md). Actions → **iOS** iş akışı simülatör için imzasız derler; imza gizli değişkenleri
varsa Ad Hoc IPA da üretir ve sürüm iş akışı bunu (iOS OTA paketiyle) sürüme yükler.
- **GIF araması (GIPHY):** sunucu `.env`'de `GIPHY_API_KEY` (developers.giphy.com → Create an App → **API**)
  tanımlıysa mesaj kutusunda GIF düğmesi çıkar; yoksa gizlenir. İstemciler GIPHY'ye değil sunucuya sorar
  (`/api/gifs/search`, `/api/gifs/trending`; anahtar sunucuda kalır, sonuçlar 5 dk önbellekte, kişi başı dakikada
  30 istek). GIF'ler GIPHY'nin sunucularından doğrudan yüklenir. İçerik sınırı `GIPHY_RATING` (varsayılan
  `pg-13`), arama dili `GIPHY_LANG` (varsayılan `tr`). Deneme ("beta") anahtarı saatte ~100 istekle sınırlıdır;
  sınır aşılırsa arama bir dakika yalnızca önbellekten yanıt verir.

### Sürüm yayınlama

Paketlenmiş uygulamanın varsayılan sunucusu `apps/desktop/.env.production` içindeki `VITE_DEFAULT_SERVER`
değeridir (şu an `https://diskort.ziroo.net`; kullanıcılar giriş ekranından değiştirebilir).

1. Sunucu değişikliği varsa **önce sunucuyu** güncelle (yeni istemci eski sunucuyla çalışmayabilir).
2. `apps/desktop/package.json` ve `apps/mobile/package.json` içindeki `version`'ı artır (ikisi aynı olmalı)
   ve commit'le.
3. Sürüm etiketini gönder:
   ```bash
   git tag v0.1.3 && git push origin v0.1.3
   ```
4. GitHub Actions (`.github/workflows/release.yml`) Windows, Linux, macOS ve Android paketlerini derleyip
   taslak (draft) sürüme yükler; Linux paketi sanal ekranda açılış testinden geçer. SignPath ayarlıysa
   Windows işi iki imzalama onayı bekler ([docs/kod-imzalama.md](docs/kod-imzalama.md)).
5. Taslağı yayınla (`gh release edit v0.1.3 --draft=false --latest`). **Yayınladığın anda bu sürüm
   zorunlu olur:** açılan her uygulama güncellenir, sunucu birkaç dakika içinde eski sürümleri reddeder.

Hatalı bir sürüm yayınlanırsa geri alınmaz (uygulamalar eski sürüme dönmez); düzeltmeyi daha yüksek bir
sürüm numarasıyla yayınla. Acil durumda sunucuda `CLIENT_UPDATE_ENFORCE=0` ile zorunluluğu geçici olarak kapat.

Yalnızca Windows paketini kendi bilgisayarından yüklemek için: `pnpm release:win` (imzasız; kod imzalama
etkinleştirildikten sonra kullanma).

## Yol haritası

- Kod imzalama (Windows: SignPath Foundation başvurusu, bkz. [docs/kod-imzalama.md](docs/kod-imzalama.md); macOS: Apple Developer ID)
- Mesaj arama, özel (sunucuya ait) emojiler, satır içi video oynatma
- Direkt mesajlarda sesli/görüntülü arama; Android'de rol ve kanal izni düzenleme
- Kamera, Linux/macOS'ta yayın sesi, mobil uygulama
- Birden çok topluluk (sunucu) desteği — veri modeli hazır (`guilds` tablosu)

## Lisans

[MIT](LICENSE)
