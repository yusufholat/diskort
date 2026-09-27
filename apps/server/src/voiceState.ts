import { EventEmitter } from 'node:events';
import type { VoiceState } from '@diskort/shared';

type SelfFlags = { selfMute: boolean; selfDeaf: boolean };
export type ServerFlags = { serverMute: boolean; serverDeaf: boolean };

const NO_SERVER_FLAGS: ServerFlags = { serverMute: false, serverDeaf: false };

export interface VoiceSnapshotEntry {
  channelId: string;
  streaming: boolean;
}

interface VoiceEvents {
  update: [VoiceState];
  delete: [{ userId: string; channelId: string }];
}

/**
 * Kimin hangi ses kanalında olduğunu tutar. Katılma/ayrılma bilgisi LiveKit
 * webhook'larından gelir (tek doğruluk kaynağı); mute/deafen bayrakları
 * istemcinin gateway üzerinden bildirdiği değerlerdir. Sunucu tarafı susturma/sağırlaştırma
 * yetkililerce verilir ve kanaldan çıkınca da sürer (veritabanında saklanır).
 */
export class VoiceStateStore extends EventEmitter<VoiceEvents> {
  private readonly states = new Map<string, VoiceState>();
  private readonly selfFlags = new Map<string, SelfFlags>();
  private readonly serverFlags = new Map<string, ServerFlags>();
  /** Kullanıcının geçerli LiveKit oturumu (participant SID) */
  private readonly sessions = new Map<string, string>();

  list(): VoiceState[] {
    return [...this.states.values()];
  }

  get(userId: string): VoiceState | undefined {
    return this.states.get(userId);
  }

  join(userId: string, channelId: string, streaming = false, sessionId?: string): VoiceState {
    if (sessionId) this.sessions.set(userId, sessionId);
    const prev = this.states.get(userId);
    if (prev && prev.channelId === channelId) return prev;
    if (prev) this.remove(userId);
    const flags = this.selfFlags.get(userId) ?? { selfMute: false, selfDeaf: false };
    const server = this.serverFlags.get(userId) ?? NO_SERVER_FLAGS;
    const state: VoiceState = { userId, channelId, ...flags, ...server, streaming, joinedAt: Date.now() };
    this.states.set(userId, state);
    this.emit('update', state);
    return state;
  }

  /**
   * Yalnızca kullanıcı hâlâ o kanaldaysa çıkarır (geç gelen webhook'lara karşı). Aynı hesap aynı kanala
   * başka bir cihazdan bağlanınca LiveKit eski oturumu kapatır; o eski oturumun "ayrıldı" bildirimi,
   * oturum kimliği güncel olanla uyuşmadığı için yok sayılır.
   */
  leave(userId: string, channelId: string, sessionId?: string): boolean {
    const prev = this.states.get(userId);
    if (!prev || prev.channelId !== channelId) return false;
    const current = this.sessions.get(userId);
    if (sessionId && current && current !== sessionId) return false;
    this.remove(userId);
    return true;
  }

  leaveChannel(channelId: string): void {
    for (const state of this.list()) {
      if (state.channelId === channelId) this.remove(state.userId);
    }
  }

  setSelf(userId: string, flags: SelfFlags): void {
    this.selfFlags.set(userId, flags);
    const prev = this.states.get(userId);
    if (!prev || (prev.selfMute === flags.selfMute && prev.selfDeaf === flags.selfDeaf)) return;
    const next = { ...prev, ...flags };
    this.states.set(userId, next);
    this.emit('update', next);
  }

  getServerFlags(userId: string): ServerFlags {
    return this.serverFlags.get(userId) ?? NO_SERVER_FLAGS;
  }

  setServerFlags(userId: string, flags: ServerFlags): void {
    if (flags.serverMute || flags.serverDeaf) this.serverFlags.set(userId, flags);
    else this.serverFlags.delete(userId);
    const prev = this.states.get(userId);
    if (!prev || (prev.serverMute === flags.serverMute && prev.serverDeaf === flags.serverDeaf)) return;
    const next = { ...prev, ...flags };
    this.states.set(userId, next);
    this.emit('update', next);
  }

  setStreaming(userId: string, channelId: string, streaming: boolean): void {
    const prev = this.states.get(userId);
    if (!prev || prev.channelId !== channelId || prev.streaming === streaming) return;
    const next = { ...prev, streaming };
    this.states.set(userId, next);
    this.emit('update', next);
  }

  /** LiveKit'ten alınan anlık görüntüyle durumu eşitler (sunucu yeniden başlatma, kaçan webhook). */
  reconcile(snapshot: Map<string, VoiceSnapshotEntry>): void {
    for (const state of this.list()) {
      const live = snapshot.get(state.userId);
      if (!live || live.channelId !== state.channelId) this.remove(state.userId);
    }
    for (const [userId, live] of snapshot) {
      const state = this.states.get(userId);
      if (!state) this.join(userId, live.channelId, live.streaming);
      else this.setStreaming(userId, live.channelId, live.streaming);
    }
  }

  private remove(userId: string): void {
    const prev = this.states.get(userId);
    if (!prev) return;
    this.states.delete(userId);
    this.sessions.delete(userId);
    this.emit('delete', { userId, channelId: prev.channelId });
  }
}
