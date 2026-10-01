# Direkt mesajlar

Bire bir ve küçük grup (en fazla 10 kişi) konuşmaları. Metin kanallarının her özelliği burada da vardır:
biçimlendirme, dosya, tepki, düzenleme/silme, "yazıyor…", okunmamış rozetleri. Konuşmada sesli arama ve ekran
paylaşımı da yapılabilir.

## Gizlilik

- Konuşmayı yalnızca katılımcılar okur, yazar ve olaylarını alır.
- Roller, kanal izinleri ve Yönetici yetkisi DM'lerde **uygulanmaz**; sunucu sahibi de başkasının konuşmasını
  hiçbir uçtan göremez (yokmuş gibi 404 döner).
- Kanal yönetimi DM'lere ulaşamaz. Konuşmanın ses odasına (arama) yalnızca katılımcılar bağlanır.
- Yönetim panelinde DM aramaları "Özel arama" olarak, kimliksiz görünür (bkz. [Aramalar](#aramalar)).

## Konuşmaların davranışı

- Aynı iki kişi için tek bir bire bir konuşma vardır; yeniden açınca aynısı gelir.
- Boş bir konuşma karşı tarafta ilk mesajla görünür. "Konuşmayı kapat" onu listeden kaldırır, yeni mesaj gelince
  geri döner.
- **Grup:** isteğe bağlı ad, her katılımcı kişi ekleyebilir (eklenen geçmişi görür). Sahip ayrılırsa sahiplik
  sıradakine geçer; son kişi ayrılınca konuşma silinir.
- Konuşma yalnızca **ortak bir sunucusu olan** kişilerle başlatılabilir. Ortak sunucu kalmazsa mesajlar durur,
  bire bir konuşmada iki taraf geçmişi okuyabilir ama yazamaz.
- Hesap silinince kişi konuşmadan düşer; kimse kalmayan konuşma silinir.

## Aramalar

Her konuşmanın (bire bir ya da grup) bir ses odası vardır: sesli konuşma ve ekran paylaşımı sunucu kanallarındakiyle
aynıdır; sunucuda susturma/sağırlaştırma DM'de yoktur.

- **Başlatma:** "Ara" konuşmanın ses odasına bağlanır. Odaya ilk kişi bağlanınca (LiveKit katılma bildirimi) diğer
  katılımcılar **çalınır**: gelen arama penceresi ve zil sesi; telefonda uygulama kapalı/kilitliyse normal bir
  bildirim (dokununca konuşma açılır). Jeton alıp hiç bağlanmayan kimseyi çaldırmaz.
- **Çalma** kişi başına 30 saniye sürer; katılınca, reddedince ya da süre dolunca o kişi için biter. Aramadaki biri
  katılmayan birini yeniden çalabilir. **Rahatsız Etmeyin**'deki kişi çalınmaz ve arama bildirimi almaz (aramayı
  konuşmada yine görür, katılabilir). Grupta, aramayı başlatanı engellemiş kişi çalınmaz.
- **Arama kaydı:** arama başlayınca konuşmaya bir kayıt düşer ("Arama başlattı"; okunmamış sayılır, mesaj bildirimi
  yerine arama bildirimi gider). Oda boşalınca arama biter, kayıt süresiyle güncellenir. Başlatandan başka kimse
  katılmadıysa **cevapsız arama** olur; çalınanların telefonunda gelen arama bildiriminin yerine "Cevapsız arama"
  geçer. Kayıt düzenlenemez. Kimsenin açmadığı aramayı aynı kişi bitirip 30 saniye içinde yeniden başlatırsa
  (girip çıkıp duruyor) önceki kayıt sürer: yeni kayıt, okunmamış, çalma ve bildirim olmaz (aramadaki biri elle
  yeniden çalabilir). Açılmış bir aramanın ardından yeniden arama her zaman yeni aramadır ve çalar.
- Çalma istemcide de en çok 30 sn (+5 sn pay) sürer ve bağlantı yokken gösterilmez (`ringStartedAt` ile yenilenir).
- Kişi her zaman tek odadadır: aramaya girmek sunucu kanalındaki sesten çıkarır (tersi de).
- Salt okunur konuşmada (ortak sunucu kalmadı ya da engel) arama yapılamaz; böyle olursa süren bire bir arama biter.

## Engelleme

Bir kişiyi engellemek yalnızca DM'leri etkiler (sunucu kanallarında mesajları gizlenmez, seste susturulmaz):

- Bire bir konuşmanız **iki taraf için de salt okunur** olur (geçmiş kalır; mesaj, tepki, arama yok). Engellenene
  engellendiği söylenmez: yalnızca konuşmanın salt okunur olduğunu görür, iletiler genel kalır.
- Engellenen sana yeni bire bir konuşma açamaz; süren bire bir aramanız iki taraf için biter.
- Gruplar etkilenmez, yalnızca: aralarında engel olan iki kişiden biri diğerini gruba ekleyemez ya da onunla grup
  kuramaz; engellediğin kişinin başlattığı ya da yeniden çaldığı grup araması seni çalmaz (engellediğin anda o
  grupta çalan arama da susar).
- Engel listesini yalnızca engelleyen görür (Ayarlar).

## Bildirimler

Her DM mesajı diğer katılımcılara ayrı bir Android bildirim kanalından (`diskort-dm`) gider. Konuşma okununca
bildirimler kalkar, bildirime dokununca konuşma açılır. Gelen ve cevapsız aramalar ayrı, yüksek öncelikli bir
kanaldan (`diskort-call`) gider.

## Teknik ayrıntılar

- **Veri modeli (şema 9):** konuşma da bir kanaldır (`channels.type = 'dm'`, bir sunucuya bağlı değildir).
  Mesajlar, dosyalar, tepkiler ve okunma durumu metin kanallarıyla aynı tablolarda ve aynı uçlardan
  (`/api/channels/:id/messages` …) gelir. Ek tablolar: `dm_channels` (bire bir anahtar, grup sahibi) ve
  `dm_participants` (katılımcılar, konuşmanın listede açık olup olmadığı).
- **Eski istemciler:** DM'ler READY'de ayrı alanda (`dms`) ve ayrı olaylarla (`DM_CHANNEL_*`) yalnızca
  IDENTIFY'da `features: ['dm']` bildiren istemcilere gelir. Eski sürümler hiçbir DM verisi almaz.
- **Aramalar (şema 25):** konuşmanın LiveKit odası `ch_<kimlik>`; DM yetkilerinde CONNECT/SPEAK/STREAM vardır (salt
  okunur konuşmada yok). Süren aramalar yalnızca bellektedir (`apps/server/src/dmCalls.ts`). Sunucu yeniden
  başlarsa LiveKit eşitlemesi odaları geri getirir, bitmemiş arama kaydı sürdürülür (kimse yeniden çalınmaz), bayat
  kayıtlar kapanır. Arama kaydı `messages.type = 'call'` ve `call_data` (JSON) sütunlarındadır. Eski istemciler
  kaydı yazarın düz metni olarak görür (`content`) ve arama olaylarını (`DM_CALL_*`) yok sayar.
- **Engeller (şema 25):** `user_blocks (blocker_id, blocked_id, created_at)`. Yetki hesabı ortak koddadır
  (`dmPermissions`: `isBlocked`, `readOnly`).
- **Yönetim paneli:** DM aramalarının kalite ölçümleri ve olay kayıtları takma kimliklerle tutulur
  (`apps/server/src/privateCalls.ts`), ses geçmişine yazılmaz; bkz. [Yönetim](yonetim.md#dm-aramalarının-gizliliği).

## Sözleşme (istemciler için)

Masaüstü ve telefon arayüzü bunun üzerine kurulur; hepsi `@diskort/shared` ve `@diskort/client-core` içinde.

### REST

| Uç | Açıklama |
|---|---|
| `POST /api/voice/:dmId/join` | Aramaya bağlan / aramayı başlat (`VoiceJoinResponse`, oda `voiceRoomName(dmId)`). Katılımcı değilse 404, salt okunursa 403 |
| `POST /api/dms/:id/call/decline` | Çalan aramayı reddet (204, tekrarlanabilir) |
| `POST /api/dms/:id/call/ring` | Gövde `{ userId? }`: aramadaysan katılmayanı (yoksa hepsini) yeniden çal (204). Aramada değilsen 409 `not_in_call` |
| `GET /api/me/blocks` | `UserBlock[]` (`{ userId, createdAt, user }`; yalnızca kendi listen) |
| `PUT /api/me/blocks/:userId`, `DELETE /api/me/blocks/:userId` | Engelle / engeli kaldır (204, tekrarlanabilir; kendini 400, olmayan hesap 404) |
| `GET /api/voice/:dmId/stream-preview/:userId` | Yayın önizlemesi DM aramasında da (yalnızca katılımcılara) |

Engel varken `POST /api/dms` (yeni bire bir ya da grup) ve `PUT /api/dms/:id/participants/:userId` 403 döner; var
olan bire bir konuşma `readOnly: true` ile açılır. Salt okunur konuşmada mesaj, tepki ve arama 403.

### Gateway

Yalnızca `features: ['dm']` bildiren oturumlara ve konuşmanın katılımcılarına:

- `READY.dmCalls?: DmCall[]` (süren aramalar), `READY.blockedUserIds?: string[]` (eski sunucuda yok)
- `DM_CALL_UPDATE { channelId, startedBy, startedAt, ringing: string[], messageId: string | null }`
- `DM_CALL_DELETE { channelId }`
- `USER_BLOCKS_UPDATE { userIds: string[] }`: yalnızca engelleyenin kendi oturumlarına, tam liste
- Aramadakiler her zamanki `VOICE_STATE_UPDATE` / `VOICE_STATE_DELETE` ile gelir (`channelId` = konuşmanın kimliği)
- `DmChannel.readOnly?: true`: bire bir konuşmada engel var (yönü söylenmez; DM_CHANNEL_UPDATE ile değişir)
- `Message.type?: 'call'` ve `Message.call?: { participantIds, endedAt }`. Yardımcılar: `isCallMessage`,
  `isMissedCall`, `callDurationMs`, `formatCallDuration`, `callMessageText`. Tanınmayan tür düz mesaj gibi
  gösterilir; arama kaydında "Düzenle" gösterilmez (sunucu 400 `not_editable`).
- Sabitler: `DM_CALL_RING_MS` (30 sn), `DM_PERMISSIONS` (CONNECT, SPEAK, STREAM dahil).

### client-core

- Depo (`useGuild`): `dmCalls: Record<dmId, DmCall>`, `blockedIds: Record<userId, true>`; `setBlocked(userId, b)`,
  `stopRingingLocally(dmId, userId)`.
- Seçiciler: `dmCallOf(s, dmId)` / `useDmCall(dmId)`; `incomingCalls(s, selfId)` / `useIncomingCalls()` (seni
  çalanlar, en yeni önce; zaten içinde olduğun arama hariç); `isRingingMe(call, selfId)`; `callMembers(s, dmId)` /
  `useCallMembers(dmId)`; `canCallDm(s, selfId, dmId)` / `useCanCallDm(dmId)`; `isBlocked(s, userId)` /
  `useIsBlocked(userId)`; `useBlockedIds()`.
- İşlemler: `declineDmCall(dmId)`, `ringDmCall(dmId, userId?)`, `blockUser(userId)`, `unblockUser(userId)`,
  `loadBlocks()`. Ham uçlar: `api.declineDmCall`, `api.ringDmCall`, `api.listBlocks`, `api.blockUser`,
  `api.unblockUser`. Bağlanma platformun ses istemcisiyle olur: `api.joinVoice(dmId)` (kanal kimliği yerine
  konuşmanın kimliği).
- `dmBlockedReason(dm, users, selfId, reachable, blockedIds)`: yazma kutusunun yerine gösterilecek metin (kendi
  engelinse açık, değilse genel).
- `permissionsOf` / `useCan(Permission.CONNECT, dmId)` DM'de arama yetkisini verir.
- Arama kaydı okunmamış sayılır ama `env.onDirectMessage` çağrılmaz (zil sesi ve pencere ayrı).
- Sesler: `CALL_SOUND_NAMES = ['ring', 'ringback']` (`renderSound(name)` ile üretilir; `SOUND_NAMES` içinde değil),
  `CALL_SOUND_REPEAT_MS` (ring 2600 ms, ringback 3200 ms: arama sürdükçe bu aralıkla yeniden çal),
  `CALL_SOUND_LABELS`. 'ring': seni biri arıyor; 'ringback': sen arıyorsun ve çalınan biri var. Telefon dosyaları
  `apps/mobile/assets/sounds/ring.wav`, `ringback.wav` (`apps/mobile/scripts/generate-sounds.mjs` üretir).

### Telefon bildirimi

- Android kanalı `PUSH_CHANNEL_CALL = 'diskort-call'` (yüksek önem). Kanalı telefon uygulaması JS'te oluşturur
  (`setNotificationChannelAsync`); oluşturmamış eski sürümde Android bildirimi varsayılan kanalda gösterir.
  `PUSH_CHANNEL_DM` ve `PUSH_CHANNEL_MENTIONS` de sabit olarak dışa açık.
- Veri: `{ type: 'call' | 'missed_call', channelId: <dmId>, messageId?: <arama kaydı> }` (`PushDataType`). Etiket
  `pushTag(dmId, messageId)`: cevapsız arama aynı etiketle gelen aramanın yerini alır, konuşma okununca kalkar. iOS:
  normal uyarı, aynı `apns-collapse-id`.
- Başlık arayanın adı (grupta "Ad · Grup"); gövde "📞 Seni arıyor", "📞 Grup araması: seni çağırıyor" ya da
  "📞 Cevapsız arama". Masaüstünde etkin olana ve Rahatsız Etmeyin'dekine gitmez.
