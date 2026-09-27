# iOS sürümü

Diskort'un iPhone uygulaması App Store ya da TestFlight olmadan, **Ad Hoc** imzayla kendi sitemizden
(`https://diskort.ziroo.net`) kurulur. Mac gerekmez: derleme GitHub'ın macOS makinelerinde yapılır.

Ad Hoc'un sınırı: uygulama yalnızca **UDID'si önceden kaydedilmiş cihazlara** kurulur (yılda en fazla
100 iPhone). Yeni bir cihaz eklendiğinde dağıtım profili yenilenir ve uygulama yeniden derlenir.

## Şu an durum

| Parça | Durum |
| --- | --- |
| iOS projesi (`expo prebuild`) ve derleme | Hazır. Actions → **iOS** → Run workflow, iOS Simülatörü için imzasız derler. |
| İmzalı IPA | Apple hesabı ve GitHub gizli değişkenleri bekleniyor (aşağıda). Gizli değişkenler yokken iş atlanır. |
| Sesli sohbet arka planda | `audio` arka plan kipi + LiveKit'in yönettiği ses oturumu (AVAudioSession). Ön plan servisi ve bildirim düğmeleri yok (Android'e özgü). |
| Kablosuz (OTA) güncelleme | Hazır: `/updates/expo/ios`. Sürüm iş akışı IPA ile birlikte iOS paketini de yükler. |
| Uygulama güncellemesi (yeni IPA) | Uygulama, sunucu yeni IPA bildirince "Yükle" penceresini açar (`itms-services`). |
| Bildirimler | Sunucu doğrudan Apple'a (APNs) gönderir; Firebase gerekmez. APNs anahtarı sunucuya konunca çalışır. |
| İndirme sayfası | Sürümde IPA varsa iPhone kartı kendiliğinden görünür. |

## Kullanıcının yapması gerekenler

### 1. Apple Developer hesabı

1. <https://developer.apple.com/programs/enroll/> adresinden **Apple Developer Program**'a katıl (yıllık 99 $).
   Bireysel hesap yeterli. Onay birkaç saat ile iki gün sürebilir.
2. Onaylanınca <https://developer.apple.com/account> → **Membership details** sayfasındaki **Team ID**'yi
   (10 karakter, ör. `AB12CD34EF`) bir kenara yaz.

### 2. App ID (paket kimliği)

1. **Certificates, Identifiers & Profiles** → **Identifiers** → **+** → **App IDs** → **App**.
2. Description: `Diskort`, Bundle ID: **Explicit** → `com.diskort.app` (Android paket adıyla aynı).
3. **Capabilities** listesinde **Push Notifications**'ı işaretle. Başka bir şey gerekmez.
4. Continue → Register.

### 3. APNs anahtarı (bildirimler için)

1. **Keys** → **+** → ad: `Diskort APNs`, **Apple Push Notifications service (APNs)** işaretli → Continue → Register.
2. `AuthKey_XXXXXXXXXX.p8` dosyasını indir (**yalnızca bir kez indirilebilir**, sakla). Dosya adındaki
   10 karakter **Key ID**'dir.
3. Sunucuda:
   ```sh
   scp AuthKey_XXXXXXXXXX.p8 diskort-vps:/opt/diskort/infra/secrets/apns.p8
   ssh diskort-vps 'chmod 600 /opt/diskort/infra/secrets/apns.p8'
   ```
   `/opt/diskort/infra/.env` dosyasına ekle:
   ```
   APNS_KEY_FILE=/run/secrets/apns.p8
   APNS_KEY_ID=XXXXXXXXXX
   APNS_TEAM_ID=AB12CD34EF
   ```
   sonra `docker compose up -d api`. Sunucu günlüğünde `iOS bildirimleri açık (APNs)` görünmeli.

Not: Firebase'in iOS tarafı (GoogleService-Info.plist) **kullanılmıyor**. iPhone'un cihaz jetonu
doğrudan APNs jetonudur; sunucu Android'e FCM, iPhone'a APNs ile gönderir.

### 4. Dağıtım sertifikası (Apple Distribution)

Mac olmadan, OpenSSL ile (Windows'ta Git Bash içinde çalışır):

```sh
openssl genrsa -out diskort-ios.key 2048
openssl req -new -key diskort-ios.key -out diskort-ios.csr -subj "/emailAddress=SENIN@EPOSTAN/CN=Diskort/C=TR"
```

1. **Certificates** → **+** → **Apple Distribution** → Continue → `diskort-ios.csr`'ı yükle → indir
   (`distribution.cer`).
2. `.p12`'ye çevir (parolayı bir kenara yaz, `IOS_CERT_PASSWORD` olacak):
   ```sh
   openssl x509 -inform DER -in distribution.cer -out distribution.pem
   openssl pkcs12 -export -legacy -inkey diskort-ios.key -in distribution.pem -out diskort-ios.p12
   ```
   (`-legacy`: macOS'un anahtar zinciri yeni OpenSSL 3 şifrelemesini okuyamıyor. OpenSSL 1.x'te bu
   seçenek yoksa kaldır.)
3. `diskort-ios.key` ve `.p12` gizlidir; depoya koyma, güvenli bir yerde sakla. Sertifika 1 yıl geçerli.

### 5. Cihazları kaydet (UDID)

Her iPhone'un UDID'si gerekir. En kolay yol: iPhone'u bilgisayara bağla, Windows'ta **Apple Devices**
uygulaması (ya da iTunes) → cihaz → seri numarasına tıklayınca UDID görünür. Alternatif: <https://udid.tech>
gibi bir sitenin yapılandırma profiliyle iPhone'un kendisinden okunabilir.

**Devices** → **+** → Platform iOS, ad (ör. `Yusuf iPhone`), UDID → Register. Her cihaz için tekrarla.

### 6. Ad Hoc dağıtım profili

1. **Profiles** → **+** → **Distribution** altında **Ad Hoc** → App ID: `com.diskort.app` →
   sertifika: 4. adımdaki → cihazlar: hepsini seç → ad: `Diskort Ad Hoc` → Generate → indir
   (`Diskort_Ad_Hoc.mobileprovision`).
2. Yeni cihaz eklendiğinde: profili **Edit** ile açıp cihazı işaretle, yeniden indir, 7. adımdaki
   `IOS_PROVISIONING_PROFILE_BASE64`'ü güncelle ve IPA'yı yeniden derlet (yeni sürüm yayınla ya da iş
   akışını elle çalıştır). Profil 1 yıl geçerli.

### 7. GitHub gizli değişkenleri

Depo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Ad | Değer |
| --- | --- |
| `APPLE_TEAM_ID` | Team ID (1. adım) |
| `IOS_CERT_P12_BASE64` | `base64 -w0 diskort-ios.p12` çıktısı |
| `IOS_CERT_PASSWORD` | `.p12` parolası |
| `IOS_PROVISIONING_PROFILE_BASE64` | `base64 -w0 Diskort_Ad_Hoc.mobileprovision` çıktısı |

`OTA_SIGNING_KEY` zaten var (Android ile aynı anahtar, iOS OTA paketini de imzalar).

### 8. İlk IPA

- Deneme: Actions → **iOS** → Run workflow (**İmzalı Ad Hoc IPA** işaretli). Bitince IPA ve
  `manifest.plist` "artifact" olarak iner. Bunu kurmak için yayınlanmış sürüm gerekir (aşağıda) ya da
  IPA'yı iPhone'a Apple Devices uygulamasıyla sürükle-bırak yapabilirsin.
- Yayın: her zamanki gibi `vX.Y.Z` etiketi gönder. Sürüm iş akışı artık iOS'u da derler, taslağa
  `Diskort-X.Y.Z-ios.ipa` ve `Diskort-X.Y.Z-ota-ios.json` (+ paket dosyaları) yükler. Taslak
  yayınlanınca indirme sayfasında iPhone kartı çıkar.

### 9. iPhone'a kurulum

iPhone'da **Safari** ile `https://diskort.ziroo.net` → **Yükle** (ya da doğrudan
`https://diskort.ziroo.net/download/ios`). iOS "Diskort yüklensin mi?" diye sorar. Uygulama ana ekrana iner.

- iOS 16+ ilk açılışta **Geliştirici Modu** isteyebilir: Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu
  → aç, telefon yeniden başlar. (Ad Hoc uygulamalarda genellikle gerekmez; istenirse böyle açılır.)
- "Bu uygulama yüklenemedi": cihazın UDID'si profilde yok ya da profil/sertifika süresi dolmuş.

## Nasıl çalışıyor (teknik)

- **Yapılandırma**: `apps/mobile/app.config.ts` → `ios` bölümü (paket kimliği, Türkçe izin metinleri,
  `UIBackgroundModes: audio, voip`, `ITSAppUsesNonExemptEncryption: false`). `plugins/withIos.js`
  iOS'un OTA adresini (`/updates/expo/ios`) ve arka plan kiplerini yazar; CI
  (`scripts/check-ios-project.sh`) prebuild sonrası bunları denetler.
- **Android'e özgü yerel modüller** iOS'ta yok sayılır: sesli sohbet ön plan servisi
  (`modules/voice-service`, iOS'ta boş işlevler), APK güncelleyici (iOS'ta `itms-services` bağlantısı),
  `expo-intent-launcher` (iOS'ta dosyalar paylaşım sayfasıyla, videolar Safari'de açılır), titreşim
  (iOS'ta kapalı, bkz. eksikler).
- **Ses**: `registerGlobals()` iOS ses oturumunu LiveKit'e bıraktırır (`setupIOSAudioManagement`).
  Arayüz sesleri (expo-audio) iOS'ta ses kipini değiştirmez ve oturumu kapatmaz; yoksa görüşme kesilirdi.
  Hoparlör düğmesi iOS'ta "hoparlöre zorla / varsayılan yol" arasında geçer.
- **OTA**: iOS'un parmak izi ayrıdır (`node scripts/runtime-version.mjs --platform ios`). IPA ile OTA
  paketi aynı macOS işinde üretilir; parmak izi değişmediyse IPA yeniden derlenmez, önceki sürümünki taşınır.
- **Sürüm kuralı**: `MIN_IOS_VERSION` ve en son sürümün iOS'a ulaşabilen hali (IPA ya da iOS OTA)
  Android'deki gibi uygulanır. Sürümde IPA yoksa iOS için kural yoktur.
- **Kurulum bildirimi**: sunucu `/download/ios/manifest.plist`'i en son sürümdeki IPA'dan üretir
  (IPA adresi GitHub'daki dosya). `IOS_BUNDLE_ID` ayarı varsayılan `com.diskort.app`.

## Bilinen eksikler

- **Ekran paylaşımı (iPhone'dan)**: iOS'ta sistem geneli ekran yayını bir **Broadcast Upload Extension**
  (ayrı hedef, App Group, ayrı profil) gerektirir; eklenmedi. Başkalarının yayınını izlemek çalışır.
  Paylaşım düğmesine basılırsa hata mesajı çıkar.
- **Kilit ekranı / Dinamik Ada kontrolleri, CallKit**: yok. Görüşme arka planda sürer ama kilit ekranında
  "sustur / ayrıl" düğmesi yoktur (Android'deki bildirim düğmelerinin karşılığı). CallKit ile gelen arama
  ekranı veya Now Playing kartı ileride eklenebilir.
- **VoIP push (PushKit)** yok: `voip` arka plan kipi yalnızca işaret; uygulama tamamen kapalıyken sesli
  kanala çağrı bildirimi gelmez (normal bildirimler gelir).
- **Titreşim**: React Native'in `Vibration`'ı iOS'ta kısa desen desteklemediği için düğme titreşimleri iOS'ta
  kapalı. `expo-haptics` eklenirse açılabilir (yeni yerel bağımlılık, yeni IPA).
- **Cihazda denenmedi**: derleme simülatörde kanıtlandı; mikrofon, arka plan sesi, Bluetooth, bildirim ve
  `itms-services` kurulumu gerçek iPhone'da ilk IPA ile denenmeli.
- `itms-services` bildirimindeki IPA adresi GitHub'a gider ve oradan yönlendirilir; iOS bunu izler. Sorun
  çıkarsa sunucu IPA'yı kendisi sunacak şekilde değiştirilebilir.
