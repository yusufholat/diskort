# Geri bildirim

Kullanıcılar uygulamanın içinden hata ve öneri gönderir; hesap yöneticileri inceler ve durumunu değiştirir.
Gönderen, durumu ve yöneticinin notunu uygulamada görür.

## Gönderme

- Masaüstünde ve telefonda sunucu çubuğunun altındaki yeşil düğme ya da **Kullanıcı Ayarları → Destek → Geri bildirim**.
- Tür (Hata / Öneri / Diğer), isteğe bağlı başlık, açıklama (en fazla 4000 karakter) ve en fazla 3 resim.
- Masaüstündeki "Uygulamanın ekran görüntüsünü ekle" **yalnızca Diskort penceresini** çeker
  (`webContents.capturePage`); masaüstü ya da başka pencereler asla görüntülenmez.

### Gönderilen teknik bilgiler

Kullanıcı bunları gönderimden önce görür ve kutuyu kaldırarak göndermeyebilir: uygulama sürümü, platform,
işletim sistemi, cihaz/mimari, ekran ve pencere boyutu, açık görünümün türü (kanal adı değil), seste olup olmadığı
ve bu oturumdaki son 10 uygulama hatası. Sunucu bilinmeyen alanları atar.

## Sınırlar ve gizlilik

- Kullanıcı başına saatte 5 geri bildirim.
- Resimler en fazla 12 MB; sunucuda WebP'ye çevrilir (en uzun kenar 2560 px, EXIF ve konum silinir).
- Ekran görüntüleri herkese açık değildir: `GET /api/feedback/screenshots/<id>` oturum ister ve yalnızca
  gönderene ve hesap yöneticilerine verilir.

## Durumlar

`yeni` → `incelendi` / `planlandi` / `tamamlandi` / `reddedildi`

Durum değişince gönderenin uygulamasında bildirim çıkar. Yeni geri bildirimler hesap yöneticilerinde kırmızı
rozetle görünür.

## Komut satırından yönetmek

API imajında `dist/feedback-cli.js` vardır. Veritabanını doğrudan okur (sunucu çalışırken de güvenlidir) ve
yalnızca geri bildirim verisini yazdırır.

```bash
cd /opt/diskort/infra
docker compose exec api node dist/feedback-cli.js list                       # en yeni 50
docker compose exec api node dist/feedback-cli.js list --status yeni --json  # yeni olanlar, JSON
docker compose exec api node dist/feedback-cli.js show 12                    # ayrıntı, teknik bilgiler, resim yolları
docker compose exec api node dist/feedback-cli.js set 12 planlandi "0.9.5 ile gelecek"
docker compose exec api node dist/feedback-cli.js note 12 "Düzeltildi, güncelle"   # yalnızca not ("" siler)
docker compose exec api node dist/feedback-cli.js stats
```

Ekran görüntüsünü almak için `show` çıktısındaki yolu kullan:
`docker compose cp api:/data/feedback/<id>.webp /tmp/`, ardından `scp` ile indir.

Komut satırından yapılan değişiklik açık uygulamalara anında gitmez; listeler yeniden açılınca görünür.

**Önerilen akış:** `list --status yeni --json` ile oku → her birini bir göreve çevir → `set <id> incelendi`
(ya da `planlandi` / `reddedildi` + kısa not) → sürüm çıkınca `set <id> tamamlandi "0.x.y ile düzeltildi"`.

## API

| Uç | Kim |
|---|---|
| `POST /api/feedback/screenshots` (ham resim) → `POST /api/feedback` | herkes |
| `GET /api/feedback/mine`, `GET /api/feedback/:id` | gönderen ya da yönetici |
| `GET /api/feedback?status=&type=`, `GET /api/feedback/stats`, `PATCH /api/feedback/:id`, `DELETE /api/feedback/:id` | hesap yöneticileri |
