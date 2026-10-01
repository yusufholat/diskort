import { callDurationMs, formatCallDuration, isMissedCall, type DmCall, type Message } from '@diskort/shared';

// Direkt mesaj aramalarının telefondaki saf kuralları (zil/bekleme sesi seçimi, sohbetteki arama kaydı
// satırının metni, sesteki "aramada değil" listesi). Bileşenler ve ses denetleyicisi bunları kullanır;
// burada React Native ya da depo yok (test/calls.test.ts).

export type CallSound = 'ring' | 'ringback';

export interface CallSoundInput {
  /** Seni çalan arama sayısı (useIncomingCalls; içinde olduğun arama hariç) */
  incoming: number;
  /** Uygulama önde mi: zil yalnızca açıkken çalar (kapalı/kilitliyken telefon bildirimi var) */
  appActive: boolean;
  /** Bağlı olduğun (ya da bağlanmakta olduğun) DM'nin süren araması */
  myCall: DmCall | undefined;
  /** Aramada senden başka bağlı kişi sayısı */
  othersInCall: number;
  selfId: string | undefined;
}

/**
 * Şu an döngüyle çalması gereken arama sesi. Gelen arama (zil) önce gelir; bekleme sesi yalnızca sen bir
 * aramadayken, odada henüz kimse yokken ve çalınan biri varken (karşı taraf henüz açmadı).
 */
export function callSoundFor({ incoming, appActive, myCall, othersInCall, selfId }: CallSoundInput): CallSound | null {
  if (incoming > 0 && appActive) return 'ring';
  if (myCall && othersInCall === 0 && myCall.ringing.some((id) => id !== selfId)) return 'ringback';
  return null;
}

export interface CallRecordView {
  /** Satırın metni ("Ali arama başlattı", "Cevapsız arama") */
  text: string;
  /** Metnin ardındaki ayrıntı ("12 dk", "sürüyor", arayanın adı); yoksa null */
  detail: string | null;
  missed: boolean;
  /** Arama sürüyor */
  live: boolean;
}

/**
 * Sohbetteki arama kaydının (message.type 'call') kısa satırı. Bitmiş aramada süre, cevapsızda arayanın adı
 * (kendi aramansa ad yok), sürende "sürüyor". Kayıt bilgisi (call) eksikse içerik metnine düşülür.
 */
export function callRecordView(
  message: Pick<Message, 'type' | 'call' | 'createdAt' | 'authorId' | 'content'>,
  authorName: string | undefined,
  selfId: string | undefined,
  now: number = Date.now(),
): CallRecordView {
  const mine = message.authorId !== null && message.authorId === selfId;
  const name = authorName ?? 'Silinmiş Kullanıcı';
  if (!message.call) {
    return { text: message.content.replace(/^📞\s*/, '') || 'Arama', detail: null, missed: false, live: false };
  }
  if (isMissedCall(message)) {
    return { text: 'Cevapsız arama', detail: mine ? null : name, missed: true, live: false };
  }
  const started = mine ? 'Arama başlattın' : `${name} arama başlattı`;
  if (message.call.endedAt === null) return { text: started, detail: 'sürüyor', missed: false, live: true };
  return { text: started, detail: formatCallDuration(callDurationMs(message, now) ?? 0), missed: false, live: false };
}

export interface AbsentParticipant {
  userId: string;
  /** Şu an çalınıyor (henüz açmadı) */
  ringing: boolean;
}

/**
 * Aramada olmayan katılımcılar (ses ekranında "Tekrar çal" listesi): konuşmanın katılımcıları, odadakiler ve
 * sen hariç; çalınanlar önce.
 */
export function absentParticipants(
  participantIds: readonly string[],
  inCall: readonly string[],
  call: Pick<DmCall, 'ringing'> | undefined,
  selfId: string | undefined,
): AbsentParticipant[] {
  const here = new Set(inCall);
  const ringing = new Set(call?.ringing ?? []);
  return participantIds
    .filter((id) => id !== selfId && !here.has(id))
    .map((userId) => ({ userId, ringing: ringing.has(userId) }))
    .sort((a, b) => Number(b.ringing) - Number(a.ringing));
}
