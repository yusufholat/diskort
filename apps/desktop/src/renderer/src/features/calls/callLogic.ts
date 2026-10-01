// DM aramalarının arayüzdeki saf kararları (depoya dokunmaz, test edilir): hangi arama sesi çalsın,
// aramada olmayan katılımcılar, arama kaydının metni, yeni gelen aramalar.
import { callDurationMs, formatCallDuration, isMissedCall, type DmCall, type Message } from '@diskort/shared';

export interface CallSoundInput {
  /** Seni çalan arama sayısı (useIncomingCalls) */
  incoming: number;
  selfId: string | undefined;
  /** Bağlı olunan (ya da bağlanılan) ses odası; DM aramasıysa konuşmanın kimliği */
  voiceChannelId: string | null;
  /** Ses bağlantısı kuruluyor ya da kurulu mu */
  inVoice: boolean;
  /** Bağlı olunan konuşmanın araması (sunucu kanalındaysan undefined) */
  call: Pick<DmCall, 'ringing'> | undefined;
  /** Aramadakiler (ses odasındakilerin kimlikleri) */
  members: readonly string[];
}

/**
 * Çalması gereken arama sesleri. 'ring': seni çalan bir arama var. 'ringback': aradığın konuşmada senden
 * başka kimse katılmadı ve hâlâ çalınan biri var (ikisi birden çalmaz; gelen arama öncelikli).
 */
export function wantedCallSounds(i: CallSoundInput): { ring: boolean; ringback: boolean } {
  const ring = i.incoming > 0;
  const ringback =
    !ring &&
    i.inVoice &&
    i.voiceChannelId !== null &&
    i.call !== undefined &&
    i.call.ringing.some((id) => id !== i.selfId) &&
    i.members.every((id) => id === i.selfId);
  return { ring, ringback };
}

export interface AbsentParticipant {
  userId: string;
  /** Şu an çalınıyor */
  ringing: boolean;
}

/** Konuşmanın aramada olmayan katılımcıları (kendin hariç), konuşmadaki sırasıyla */
export function absentParticipants(
  participantIds: readonly string[],
  members: readonly string[],
  selfId: string | undefined,
  ringing: readonly string[],
): AbsentParticipant[] {
  const inCall = new Set(members);
  return participantIds
    .filter((id) => id !== selfId && !inCall.has(id))
    .map((userId) => ({ userId, ringing: ringing.includes(userId) }));
}

export type CallRecordState =
  | { kind: 'ongoing' }
  | { kind: 'missed' }
  | { kind: 'ended'; duration: string };

/** Arama kaydının durumu: sürüyor, cevapsız ya da süresiyle bitti */
export function callRecordState(message: Pick<Message, 'type' | 'call' | 'createdAt'>): CallRecordState {
  if (isMissedCall(message)) return { kind: 'missed' };
  if (!message.call || message.call.endedAt === null) return { kind: 'ongoing' };
  return { kind: 'ended', duration: formatCallDuration(callDurationMs(message) ?? 0) };
}

/**
 * Kayıttaki satırın metni (adın ardından): "arama başlattı", "arama başlattı · 12 dk sürdü" ya da cevapsız.
 * Cevapsız aramada, arayan sen değilsen "seni aradı · Cevapsız arama", arayan sensen "arama başlattı · Cevapsız".
 */
export function callRecordText(state: CallRecordState, ownCall: boolean): string {
  switch (state.kind) {
    case 'ongoing':
      return 'arama başlattı';
    case 'missed':
      return ownCall ? 'arama başlattı · Cevapsız arama' : 'aradı · Cevapsız arama';
    case 'ended':
      return `arama başlattı · ${state.duration} sürdü`;
  }
}

/** Önceki listede olmayan (yeni gelen) aramalar: bildirim ve pencere uyarısı yalnızca bunlar için */
export function newIncomingCalls(
  seen: ReadonlySet<string>,
  calls: readonly Pick<DmCall, 'channelId' | 'startedAt'>[],
): string[] {
  return calls.map(callKey).filter((key) => !seen.has(key));
}

/** Bir aramanın kimliği (aynı konuşmada yeni arama yeni anahtar alır) */
export const callKey = (c: Pick<DmCall, 'channelId' | 'startedAt'>): string => `${c.channelId}:${c.startedAt}`;

/**
 * "Ses sahnesi" görünümünün gerçek hedefi: DM aramasındaysan konuşmanın kendisi (arama orada çizilir),
 * sunucu ses kanalındaysan sahne.
 */
export function voiceViewTarget(
  voiceChannelId: string | null,
  dms: Readonly<Record<string, unknown>>,
): { kind: 'dm'; channelId: string } | { kind: 'voice' } {
  return voiceChannelId && dms[voiceChannelId] ? { kind: 'dm', channelId: voiceChannelId } : { kind: 'voice' };
}
