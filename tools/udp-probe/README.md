# Diskort hat testi (udp-probe)

Bilgisayar ile sunucu arasındaki UDP yolunu LiveKit'ten bağımsız ölçer: yukarı ve aşağı yönde saniye saniye kayıp,
hız eşiği, paket/sn sınırı, yayın benzeri yük, TCP karşılaştırması ve (yöneticiler için) patlama testi. Sonuç yönetim
panelinde **Bağlantı teşhisi > Testler** bölümüne yüklenir ve otomatik yorumlanır. Sese girmek gerekmez; ek paket
gerekmez (yalnızca Node 18+ ya da Diskort uygulaması).

## Arkadaşın nasıl çalıştırır (yönetici kod verir)

1. Yönetici panelde **Bağlantı teşhisi > Testler > Test kodu üret** der, kodu arkadaşına verir (12 saat geçerli).
2. Arkadaşı iki dosyayı aynı klasöre koyar: `probe.mjs` ve `hat-testi.cmd`
   (GitHub: `tools/udp-probe/`). `hat-testi.cmd` tek başına da olur: `probe.mjs`'yi GitHub'dan indirir ve içindeki sabit SHA-256 ile doğrular, uymazsa çalıştırmaz. `probe.mjs` değişirse `hat-testi.cmd` içindeki `PROBE_SHA256` güncellenmeli (sunucu testi uyuşmazlığı yakalar).
3. `hat-testi.cmd` dosyasına çift tıklar, kodu ve adını yazar. 2-3 dakika bekler, sonuç ekranda çıkar.

Tek komut (Node kuruluysa):

```
node probe.mjs --kod KOD --ad ADIN
```

Diskort hesabı olanlar kodsuz da çalıştırabilir: uygulamada **Ayarlar > Ses ve Görüntü > Hat testi** (kısa, ~12 sn).
Hesapla (kodsuz) yalnızca kısa test açılabilir; tam paket için test kodu gerekir.

## Kim neyi çalıştırabilir

| Kimlik | Profiller | Sınır |
| --- | --- | --- |
| Diskort hesabı (yönetici değil) | yalnızca kısa test (`--hizli`) | 10 dakikada 6 test |
| Test kodu | tam paket ve kısa test | sunucu toplam bant sınırı (varsayılan 24 Mbps) |
| Yönetici hesabı ya da **yönetici kodu** | hepsi + patlama testi (`--patlama`) | yönetici bant sınırı (varsayılan 48 Mbps) |

## Patlama testi (yalnızca yönetici kodu / yönetici hesabı)

Yayında sahne değişimi gibi **ani hız artışını** sese girmeden taklit eder; şüphelenilen "patlama sağlayıcının hız
sınırını tetikliyor ve ardından her şey birkaç saniye kesiliyor" durumunu yeniden üretmek içindir.

```
node probe.mjs --kod YONETICI_KODU --ad ADIN --patlama
hat-testi.cmd --patlama
```

- Aşağı yön (sunucu → bilgisayar): taban 3 Mbps, arada 2 sn'lik patlamalar: 10, 20, 30, 40 Mbps.
- Yukarı yön (bilgisayar → sunucu): taban 3 Mbps, patlamalar: 6, 10, 12 Mbps.
- Her yönde saniye saniye kayıp ölçülür. Asıl sonuç: sunucu, test sürerken ve hemen sonrasında **kendi ağında
  kesinti** (dış sondaların yanıtsız kalması ve/veya sunucuya paket gelmemesi) görüp görmediğini sonuca ekler:
  `!! SUNUCU KESİNTİ GÖRDÜ: "patlama 30 Mbps" adımından 1,2 sn sonra: TAM KESİNTİ …`
- 40 Mbps'i taşıyamayan ev bağlantısında üst basamaklarda kayıp görülmesi olağandır; sunucu kesinti görmediyse
  sorun sunucu ağında değildir (yorum bunu ayırır).
- Canlı yayın varken başlamaz (yayını dondurabilir ve teşhisi bulandırır). Bilerek çalıştırmak için `--zorla`.
- Panelde kodu üretirken **"Yönetici kodu (patlama testi)"** seçilmelidir; sıradan test koduyla reddedilir.

## Birkaç kişi aynı anda (ortak test)

Herkes aynı saatte başlasın diye (sunucu saatine göre hizalanır, bilgisayar saat farkı önemsiz):

```
node probe.mjs --kod KOD --ad ADIN --at 21:30:00
```

Panelde aynı dakikadaki testler **Ortak test** olarak yan yana gösterilir. Aynı anda en fazla birkaç kişi
çalışabilir (sunucu toplam bant sınırı, varsayılan 24 Mbps; dolunca "meşgul" der, biraz sonra tekrar denenir).

## Seçenekler

| Seçenek | Anlamı |
| --- | --- |
| `--server URL` | Sunucu (varsayılan https://diskort.ziroo.net) |
| `--hizli` | Yalnızca kısa test (~12 sn) |
| `--patlama` | Patlama testi (~45 sn; yönetici kodu ya da yönetici hesabı gerekir) |
| `--zorla` | Canlı yayın varken de patlama testini başlat |
| `--tcp-yok` | TCP karşılaştırmasını atla |
| `--tracert` | Yol izlemeyi (tracert) de ekle: servis sağlayıcıya destek talebi için |
| `--at SS:DD:SN` | Belirli saatte başla |
| `--token JETON` | Kod yerine Diskort hesap jetonu |
| `--json` | Sonucu JSON olarak da yaz (sunucunun gördüğü kesintiler dahil) |

Test sırasında canlı yayın açık olup olmadığı sunucuda otomatik kaydedilir (boşta ve yayın açıkken karşılaştırma için).
Sunucu ayrıca test sürerken kendi olay döngüsünün gecikmesini kaydeder (ölçüm sunucu yükünden etkilendiyse görülür).

## Ne ölçer (tam paket, ~2,5 dk)

1. Hız basamakları aşağı yön: 0,5 → 12 Mbps (1200 bayt paket, adım başı 4 sn)
2. Hız basamakları yukarı yön
3. Küçük paketler (200 bayt, 250 → 6000 paket/sn), iki yön
4. Yayın benzeri: 8 Mbps, 30 kare/sn patlamalar, 30 sn, iki yön aynı anda
5. TCP karşılaştırması (HTTPS üzerinden aynı basamaklar)

Protokol ve güvenlik notları: `apps/server/src/lineTest/` başındaki açıklamalar.
