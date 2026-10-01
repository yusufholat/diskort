# Direkt mesajlar

Bire bir ve küçük grup (en fazla 10 kişi) konuşmaları. Metin kanallarının her özelliği burada da vardır:
biçimlendirme, dosya, tepki, düzenleme/silme, "yazıyor…", okunmamış rozetleri.

## Gizlilik

- Konuşmayı yalnızca katılımcılar okur, yazar ve olaylarını alır.
- Roller, kanal izinleri ve Yönetici yetkisi DM'lerde **uygulanmaz**; sunucu sahibi de başkasının konuşmasını
  hiçbir uçtan göremez (yokmuş gibi 404 döner).
- Kanal yönetimi ve ses uçları DM'lere ulaşamaz.

## Konuşmaların davranışı

- Aynı iki kişi için tek bir bire bir konuşma vardır; yeniden açınca aynısı gelir.
- Boş bir konuşma karşı tarafta ilk mesajla görünür. "Konuşmayı kapat" onu listeden kaldırır, yeni mesaj gelince
  geri döner.
- **Grup:** isteğe bağlı ad, her katılımcı kişi ekleyebilir (eklenen geçmişi görür). Sahip ayrılırsa sahiplik
  sıradakine geçer; son kişi ayrılınca konuşma silinir.
- Konuşma yalnızca **ortak bir sunucusu olan** kişilerle başlatılabilir. Ortak sunucu kalmazsa mesajlar durur,
  bire bir konuşmada iki taraf geçmişi okuyabilir ama yazamaz.
- Hesap silinince kişi konuşmadan düşer; kimse kalmayan konuşma silinir.

## Bildirimler

Her DM mesajı diğer katılımcılara ayrı bir Android bildirim kanalından (`diskort-dm`) gider. Konuşma okununca
bildirimler kalkar, bildirime dokununca konuşma açılır.

## Teknik ayrıntılar

- **Veri modeli (şema 9):** konuşma da bir kanaldır (`channels.type = 'dm'`, bir sunucuya bağlı değildir).
  Mesajlar, dosyalar, tepkiler ve okunma durumu metin kanallarıyla aynı tablolarda ve aynı uçlardan
  (`/api/channels/:id/messages` …) gelir. Ek tablolar: `dm_channels` (bire bir anahtar, grup sahibi) ve
  `dm_participants` (katılımcılar, konuşmanın listede açık olup olmadığı).
- **Eski istemciler:** DM'ler READY'de ayrı alanda (`dms`) ve ayrı olaylarla (`DM_CHANNEL_*`) yalnızca
  IDENTIFY'da `features: ['dm']` bildiren istemcilere gelir. Eski sürümler hiçbir DM verisi almaz.
- **Sesli arama için hazır:** konuşma bir kanal olduğundan LiveKit odası (`ch_<kimlik>`) ve yetkiler aynı yoldan
  eklenebilir.
