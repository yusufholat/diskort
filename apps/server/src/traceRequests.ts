import { randomBytes } from 'node:crypto';
import { VOICE_TRACE_REQUEST_GAP_MS } from '@diskort/shared';
import type { Gateway } from './gateway.js';
import type { VoiceStateStore } from './voiceState.js';

/** Olay kaydı isteğinin sonucu */
export interface TraceRequestResult {
  /** İsteğin kimliği: gelen kayıtların `eventId` alanında bulunur */
  eventId: string;
  channelId: string;
  /** Kanalda (sunucunun bildiği ses durumuna göre) bulunan kullanıcı sayısı */
  users: number;
  /** İsteğin gönderildiği oturum sayısı (olay kaydını tanıyan istemciler; eski istemcilere gönderilmez) */
  sessions: number;
  /** Aynı kanaldan az önce istendi: bu istek gönderilmedi */
  throttled: boolean;
}

/**
 * Bir ses kanalındaki bütün istemcilerden olay kaydını (son ~2 dakikanın saniyelik bağlantı ölçümleri) ister.
 * Kendi tetikleyicisi çalışmamış istemcilerin de aynı saniyelere bakışı böylece toplanır. İstemciler çok sık
 * isteği zaten yok sayar; sunucu da kanal başına aynı aralıkla sınırlar.
 */
export type RequestVoiceTraces = (channelId: string, reason: string, eventId?: string) => TraceRequestResult;

export function createTraceRequester(deps: {
  gateway: Pick<Gateway, 'sendVoiceTraceRequest'>;
  voice: Pick<VoiceStateStore, 'list'>;
  onRequest?: (result: TraceRequestResult, reason: string) => void;
  now?: () => number;
}): RequestVoiceTraces {
  const now = deps.now ?? Date.now;
  const last = new Map<string, number>();
  return (channelId, reason, eventId) => {
    const at = now();
    for (const [id, t] of last) if (at - t > VOICE_TRACE_REQUEST_GAP_MS) last.delete(id);
    const id = (eventId ?? `ist-${at.toString(36)}-${randomBytes(4).toString('hex')}`).slice(0, 64);
    const userIds = deps.voice
      .list()
      .filter((v) => v.channelId === channelId)
      .map((v) => v.userId);
    const result: TraceRequestResult = { eventId: id, channelId, users: userIds.length, sessions: 0, throttled: last.has(channelId) };
    if (result.throttled) return result;
    last.set(channelId, at);
    result.sessions = deps.gateway.sendVoiceTraceRequest(userIds, { channelId, eventId: id, reason: reason.slice(0, 48) });
    deps.onRequest?.(result, reason);
    return result;
  };
}
