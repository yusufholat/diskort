# Diskort

10–20 kişilik kapalı topluluklar için Discord kalitesinde **ses**, **ekran paylaşımı** ve **metin kanalları** uygulaması.
Masaüstü (Electron) ve Android (React Native) uygulamaları + kendi sunucun (LiveKit SFU + API).

İndirme sayfası: **https://diskort.ziroo.net**

## Özellikler

- **Ses:** Opus 64 kbps (32–128 ayarlanabilir), DTX + RED (paket kaybına dayanıklı), ~30 ms jitter buffer
- **Gürültü engelleme:** RNNoise (yapay zekâ, Krisp benzeri) / standart / kapalı; yankı engelleme, otomatik kazanç
- **Ses aktivitesi** (otomatik veya elle eşik) ve **bas-konuş** (global kısayol, fare yan tuşları, bırakma gecikmesi)
- **Sustur / sağırlaştır**, kişi başı ses seviyesi (0–200%) ve yerel susturma (sağ tık)
- **Konuşan göstergesi** (yeşil halka), ping göstergesi, katılma/ayrılma sesleri
- **Ekran paylaşımı:** Discord tarzı pencere/ekran seçici, 720p30 → 1440p60, H.264/VP9/VP8/AV1,
  sistem sesi (Windows; sohbet sesleri otomatik hariç tutulur → yankı yok)
- **“Yayını İzle”:** video yalnızca izlemek isteyene gönderilir; tam ekran, yayın sesi ayarı
- Kanala girmeden **kim hangi kanalda**, kim susturulmuş, kim yayında görünür
- **Metin kanalları:** kalıcı mesaj geçmişi (yukarı kaydırdıkça yüklenir), düzenleme (↑ ile son mesaj) ve silme,
  **kalın**/*italik*/~~çizik~~/`kod`/kod bloğu/alıntı/sürpriz (`||metin||`) biçimlendirme, bağlantılar,
  “yazıyor…” göstergesi, okunmamış kanal ve **@bahsetme** rozetleri (sunucuda tutulur, çevrimdışıyken gelenler de
  görünür), bahsetmede bildirim + görev çubuğu uyarısı, “YENİ” ayracı
- **Davet kodu + hesap** sistemi; **şifre sıfırlama** (yöneticinin verdiği tek kullanımlık kodla) ve şifre değiştirme
- **Yönetici paneli:** davetler, kanallar, üyeler (sıfırlama kodu, yöneticilik, sesten atma, hesap silme)
- **Yedek bağlantı:** doğrudan UDP kurulamayan ağlarda TURN/UDP 3478, yalnızca 443'e izin veren ağlarda
  (okul, yurt, iş yeri) TURN/TLS 443 — röle üzerinden gecikme doğrudan bağlantıya göre ~2 ms fazla (ölçüldü)
- Tepsiye küçültme, başlangıçta açılma, otomatik güncelleme

| | Windows | Linux | macOS | Android |
|---|---|---|---|---|
| Ses, mute/deafen | ✅ | ✅ | ✅ | ✅ (hoparlör/ahize, ekran kilitliyken de) |
| Metin kanalları | ✅ | ✅ | ✅ | ✅ |
| Ekran/pencere paylaşımı | ✅ | ✅ (Wayland'da sistem seçicisi) | ✅ (sistem seçicisi) | yalnızca izleme (paylaşma planlı) |
| Yayına sistem sesi | ✅ | ❌ (planlı) | ❌ (planlı) | — |
| Global kısayollar / bas-konuş | ✅ | ✅ X11 · ⚠️ Wayland | ✅ (Erişilebilirlik izni) | — |
| Paket | NSIS kurulum (x64) | AppImage, .deb (x64) | .dmg (Apple Silicon, Intel) | APK (Android 7+) |
| Otomatik güncelleme | ✅ | ✅ | ❌ (Apple imzası gerekir; indirme sayfasından) | ❌ (uygulama yeni sürümü indirme sayfasına yönlendirir) |
| Kod imzası | ❌ (SmartScreen uyarısı, yalnızca ilk kurulumda) | — | ad-hoc (ilk açılışta “Yine de Aç”) | kendi anahtarımız |

## Mimari

```
Masaüstü (Electron + React) ──HTTPS/WSS──► Caddy :443 ──► API (Fastify, SQLite) ◄── webhook ──┐
        │                                   │  └─ indirme sayfası (apps/web)                  │
        │                                   └─ turn.* (SNI) ──► LiveKit TURN/TLS              │
        └──────── WebRTC (UDP 50000–60000) ──────────────────► LiveKit SFU (ses + ekran) ────┘
```

- `apps/desktop` — Electron uygulaması (`src/main` ana süreç, `src/preload` köprü, `src/renderer` arayüz)
  - Ses motoru: `src/renderer/src/features/voice/voiceClient.ts`
  - Mikrofon zinciri (RNNoise + ses kapısı): `micProcessor.ts`, `gate-worklet.js`
  - TURN/TLS portu güvencesi (olası 5349 bildirimini 443'e çevirir): `turnPort.ts`
  - Metin kanalları: `features/messages` (mesaj deposu, biçimlendirme), `components/text` (görünüm)
- `apps/mobile` — Android uygulaması (Expo SDK 57 + React Native, `src/app` ekranlar, `src/voice` sesli sohbet).
  Ekran kilitliyken sesin sürmesi için yerel Android modülü: `modules/voice-service` (ön plan servisi).
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

Geliştirme bayrakları: `DISKORT_FAKE_MEDIA=1` (sahte mikrofon/kamera), `DISKORT_DEBUG_PORT=9222`
(Chrome DevTools Protokolü ile otomatik test). Paketlenmiş sürümde devre dışıdır.

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

- Test APK'sı: GitHub → Actions → **Android APK** → *Run workflow* (çıktı "artifact" olarak iner).
- Sürümde: etiket gönderilince APK da derlenip sürüme `Diskort-<sürüm>-android.apk` olarak eklenir;
  indirme sayfası `/download/android` ile sunar.
- Mobil uygulamanın bağlanabilmesi için gereken en düşük sürüm sunucuda `MIN_ANDROID_VERSION`
  (yalnızca uyumsuz bir değişiklikte artırılır; her sürümde değil).

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
4. GitHub Actions (`.github/workflows/release.yml`) Windows, Linux ve macOS paketlerini derleyip taslak
   (draft) sürüme yükler; Linux paketi sanal ekranda açılış testinden geçer.
5. Taslağı yayınla (`gh release edit v0.1.3 --draft=false --latest`). **Yayınladığın anda bu sürüm
   zorunlu olur:** açılan her uygulama güncellenir, sunucu birkaç dakika içinde eski sürümleri reddeder.

Hatalı bir sürüm yayınlanırsa geri alınmaz (uygulamalar eski sürüme dönmez); düzeltmeyi daha yüksek bir
sürüm numarasıyla yayınla. Acil durumda sunucuda `CLIENT_UPDATE_ENFORCE=0` ile zorunluluğu geçici olarak kapat.

Yalnızca Windows paketini kendi bilgisayarından yüklemek için: `pnpm release:win`.

## Yol haritası

- Kod imzalama (Windows: Certum Open Source veya SignPath Foundation; macOS: Apple Developer ID)
- Emoji/tepkiler, dosya ve resim paylaşımı, mesaj arama
- Roller ve yetkiler, özel mesajlar (DM)
- Kamera, Linux/macOS'ta yayın sesi, mobil uygulama
- Birden çok topluluk (sunucu) desteği — veri modeli hazır (`guilds` tablosu)

## Lisans

[MIT](LICENSE)
