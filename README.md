# Diskort

10–20 kişilik kapalı topluluklar için Discord kalitesinde **ses** ve **ekran paylaşımı** uygulaması.
Masaüstü uygulaması (Electron) + kendi sunucun (LiveKit SFU + API).

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
- **Davet kodu + hesap** sistemi, yönetici paneli (davet oluşturma, kanal ekleme/düzenleme/silme)
- Tepsiye küçültme, başlangıçta açılma, otomatik güncelleme (GitHub Releases)

| Özellik | Windows | Linux | macOS |
|---|---|---|---|
| Ses, mute/deafen, cihaz seçimi | ✅ | ✅ | ✅ |
| Ekran/pencere paylaşımı | ✅ | ✅ (Wayland'da sistem seçicisi) | ✅ (sistem seçicisi) |
| Yayına sistem sesi | ✅ | ❌ (planlı) | ❌ (planlı) |
| Global kısayollar / bas-konuş | ✅ | ✅ X11 · ⚠️ Wayland | ✅ (Erişilebilirlik izni) |

## Mimari

```
Masaüstü (Electron + React)  ──HTTPS/WSS──►  API (Fastify, SQLite)   ◄── webhook ──┐
        │                                      hesaplar, davetler, kanallar,       │
        │                                      ses jetonu, gateway (anlık durum)   │
        └──────── WebRTC (UDP) ───────────►  LiveKit SFU (ses + ekran) ────────────┘
```

- `apps/desktop` — Electron uygulaması (`src/main` ana süreç, `src/preload` köprü, `src/renderer` arayüz)
  - Ses motoru: `src/renderer/src/features/voice/voiceClient.ts`
  - Mikrofon zinciri (RNNoise + ses kapısı): `micProcessor.ts`, `gate-worklet.js`
- `apps/server` — API + gateway + LiveKit entegrasyonu
- `apps/web` — indirme sayfası (`https://diskort.ziroo.net`, derleme adımı yok; Caddy doğrudan sunar).
  Butonlar `/download/<platform>` adresine gider; API en son GitHub sürümünü bulup dosyaya yönlendirir.
- `packages/shared` — ortak tipler
- `infra` — VPS için Docker Compose, LiveKit ve Caddy yapılandırması

## Geliştirme (Windows)

Gerekenler: Node.js 22+ ve pnpm (`npm i -g pnpm`).

```bash
pnpm install
```

LiveKit sunucusu (Windows için `tools/livekit/livekit-server.exe` bekler;
[sürümler](https://github.com/livekit/livekit/releases) sayfasından `windows_amd64` zip'ini oraya aç):

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

Aynı bilgisayarda ikinci bir istemci açmak için (ayrı profil, `dev:desktop` açıkken):

```bash
pnpm dev:desktop2
```

Geliştirme bayrakları: `DISKORT_FAKE_MEDIA=1` (sahte mikrofon/kamera), `DISKORT_DEBUG_PORT=9222`
(Chrome DevTools Protokolü ile otomatik test). Paketlenmiş sürümde devre dışıdır.

Testler ve tip kontrolü:

```bash
pnpm test
```

```bash
pnpm typecheck
```

## Sunucuya kurulum (VPS)

Önerilen: Türkiye'deki kullanıcılar için İstanbul lokasyonlu bir VPS veya Hetzner (Almanya/Finlandiya),
2 vCPU / 2–4 GB RAM yeterli. 20 kişilik ses ≈ 1–2 Mbps; 1080p60 yayını izleyen her kişi ≈ 7 Mbps.

1. İki alan adı (ör. `diskort.ornek.com`, `lk.ornek.com`) için DNS A kaydını VPS IP'sine yönlendir.
2. Depoyu VPS'e kopyala ve hazırlık betiğini çalıştır (Docker + güvenlik duvarı + rastgele anahtarlar):
   ```bash
   sudo bash infra/setup-vps.sh
   ```
3. `infra/.env` içindeki `DISKORT_DOMAIN` ve `LIVEKIT_DOMAIN` değerlerini düzenle, sonra:
   ```bash
   cd infra && docker compose up -d --build
   ```
4. Sunucuyu güncellemek için: `cd /opt/diskort && git pull && cd infra && docker compose up -d --build`
5. İlk yönetici davet kodu için:
   ```bash
   docker compose logs api | grep -i davet
   ```

Açık olması gereken portlar: `80/tcp`, `443/tcp`, `7881/tcp`, `3478/udp`, `50000–60000/udp`.

## Masaüstü paketleri

Paketlenmiş uygulamanın varsayılan sunucusu `apps/desktop/.env.production` içindeki
`VITE_DEFAULT_SERVER` değeridir (şu an `https://diskort.ziroo.net`; kullanıcılar giriş ekranından
değiştirebilir). Geliştirme sürümü ayrı bir profil (`%APPDATA%\Diskort-dev`) kullanır, kurulu
uygulamanın oturumuna karışmaz.

```bash
pnpm --filter @diskort/desktop dist:win
```

Çıktı: `apps/desktop/release/<sürüm>/Diskort-Setup-<sürüm>.exe`. Linux paketleri Linux'ta,
macOS paketi macOS'ta derlenmelidir (`dist:linux`, `dist:mac`).

### Güncelleme yayınlama

Uygulama güncellemeleri `yusufholat/diskort` deposunun GitHub Releases'inden otomatik indirir.
Yeni sürüm için `apps/desktop/package.json` içindeki `version`'ı artır ve (gh CLI ile giriş yapılmış olarak):

```bash
pnpm release:win
```

Bu, kurulum dosyasını taslak (draft) bir GitHub sürümüne yükler. GitHub'da taslağı yayınladığında
açık olan tüm uygulamalar güncellemeyi arka planda indirir ve yeniden başlatınca kurar.

## Yol haritası

- Metin kanalları ve mesaj geçmişi, emoji/tepkiler, dosya paylaşımı
- Roller ve yetkiler, özel mesajlar (DM)
- Kamera, Linux/macOS'ta yayın sesi
- Birden çok topluluk (sunucu) desteği — veri modeli hazır (`guilds` tablosu)
