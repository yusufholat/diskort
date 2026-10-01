# Diskort hat testi (udp-probe)

Bilgisayar ile sunucu arasındaki UDP yolunu LiveKit'ten bağımsız ölçer: yukarı ve aşağı yönde saniye saniye kayıp,
hız eşiği, paket/sn sınırı, yayın benzeri yük ve TCP karşılaştırması. Sonuç yönetim panelinde **Hat testleri**
sekmesine yüklenir ve otomatik yorumlanır. Ek paket gerekmez (yalnızca Node 18+ ya da Diskort uygulaması).

## Arkadaşın nasıl çalıştırır (yönetici kod verir)

1. Yönetici panelde **Hat testleri > Test kodu üret** der, kodu arkadaşına verir (12 saat geçerli).
2. Arkadaşı iki dosyayı aynı klasöre koyar: `probe.mjs` ve `hat-testi.cmd`
   (GitHub: `tools/udp-probe/`; `hat-testi.cmd` tek başına da olur, `probe.mjs`'yi kendisi indirir).
3. `hat-testi.cmd` dosyasına çift tıklar, kodu ve adını yazar. 2-3 dakika bekler, sonuç ekranda çıkar.

Tek komut (Node kuruluysa):

```
node probe.mjs --kod KOD --ad ADIN
```

Diskort hesabı olanlar kodsuz da çalıştırabilir: uygulamada **Ayarlar > Ses ve Görüntü > Hat testi** (kısa, ~12 sn).

## Birkaç kişi aynı anda (ortak test)

Herkes aynı saatte başlasın diye (sunucu saatine göre hizalanır, bilgisayar saat farkı önemsiz):

```
node probe.mjs --kod KOD --ad ADIN --at 21:30:00
```

Panelde aynı dakikadaki testler **Ortak test** olarak yan yana gösterilir. Aynı anda en fazla birkaç kişi
çalışabilir (sunucu toplam bant sınırı, varsayılan 48 Mbps; dolunca "meşgul" der, biraz sonra tekrar denenir).

## Seçenekler

| Seçenek | Anlamı |
| --- | --- |
| `--server URL` | Sunucu (varsayılan https://diskort.ziroo.net) |
| `--hizli` | Yalnızca kısa test (~12 sn) |
| `--tcp-yok` | TCP karşılaştırmasını atla |
| `--tracert` | Yol izlemeyi (tracert) de ekle: servis sağlayıcıya destek talebi için |
| `--at SS:DD:SN` | Belirli saatte başla |
| `--token JETON` | Kod yerine Diskort hesap jetonu |
| `--json` | Sonucu JSON olarak da yaz |

Test sırasında canlı yayın açık olup olmadığı sunucuda otomatik kaydedilir (boşta ve yayın açıkken karşılaştırma için).

## Ne ölçer (tam paket, ~2,5 dk)

1. Hız basamakları aşağı yön: 0,5 → 12 Mbps (1200 bayt paket, adım başı 4 sn)
2. Hız basamakları yukarı yön
3. Küçük paketler (200 bayt, 250 → 6000 paket/sn), iki yön
4. Yayın benzeri: 8 Mbps, 30 kare/sn patlamalar, 30 sn, iki yön aynı anda
5. TCP karşılaştırması (HTTPS üzerinden aynı basamaklar)

Protokol ve güvenlik notları: `apps/server/src/lineTest/` başındaki açıklamalar.
