import { hasPermission, Permission, type User } from '@diskort/shared';
import type { Store } from './db.js';
import { TrackSource, type LiveKitService, type PublishSources } from './livekit.js';
import type { PermissionService } from './permissions.js';
import type { ServerFlags, VoiceStateStore } from './voiceState.js';

/**
 * Sesli sohbette yetkilerin LiveKit'e yansıması:
 * - Jeton ve bağlı katılımcının izni kanaldaki yetkilerden gelir: SPEAK → mikrofon, STREAM → ekran.
 * - Sunucuda susturulan/sağırlaştırılan üyenin mikrofonu susturulur ve yayın izni alınır; sağırlaştırma
 *   dinlemeyi istemci uygular (LiveKit'te dinleme izni alınıp geri verilince abonelikler geri gelmiyor).
 * - Kanalı görme ya da bağlanma yetkisini kaybeden (veya atılan) sesten çıkarılır.
 */
export class VoiceModeration {
  /** Kullanıcıya en son uygulanan izin (kanal + kaynaklar); gereksiz LiveKit çağrısı yapılmasın */
  private readonly applied = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly voice: VoiceStateStore,
    private readonly livekit: LiveKitService,
    private readonly permissions: PermissionService,
  ) {
    // Sunucu yeniden başlasa da susturmalar sürsün
    for (const [userId, flags] of store.serverVoiceFlags()) voice.setServerFlags(userId, flags);
  }

  canConnect(userId: string, channelId: string): boolean {
    return this.permissions.can(userId, Permission.VIEW_CHANNEL | Permission.CONNECT, channelId);
  }

  /** Kullanıcının bu kanalda yayınlayabileceği kaynaklar */
  sources(userId: string, channelId: string): PublishSources {
    const perms = this.permissions.inChannel(userId, channelId);
    const flags = this.voice.getServerFlags(userId);
    const sources: PublishSources = [];
    if (hasPermission(perms, Permission.SPEAK) && !flags.serverMute && !flags.serverDeaf) {
      sources.push(TrackSource.MICROPHONE);
    }
    if (hasPermission(perms, Permission.STREAM)) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
    return sources;
  }

  joinToken(user: User, channelId: string): Promise<string> {
    return this.livekit.createJoinToken(user, channelId, this.sources(user.id, channelId));
  }

  /**
   * Katılma bildirimi (webhook): jeton alındıktan sonra yetkiler değişmiş ya da katılımcı eski bir jetonla
   * yeniden bağlanmış olabilir; izin her katılışta güncel duruma getirilir.
   */
  async onJoined(userId: string, channelId: string): Promise<void> {
    this.applied.delete(userId);
    await this.enforce(userId, channelId);
  }

  /** Yetkiler değişince (rol, kanal izni, üyelik) seste olan herkesi yeni duruma getirir. */
  async enforceAll(): Promise<void> {
    await Promise.all(this.voice.list().map((s) => this.enforce(s.userId, s.channelId)));
  }

  private async enforce(userId: string, channelId: string): Promise<void> {
    if (!this.canConnect(userId, channelId)) {
      await this.disconnect(userId);
      return;
    }
    const sources = this.sources(userId, channelId);
    const key = `${channelId}:${sources.join(',')}`;
    if (this.applied.get(userId) === key) return;
    this.applied.set(userId, key);
    await this.livekit.setPublishSources(channelId, userId, sources);
  }

  /** Sunucu tarafı susturma/sağırlaştırma: kalıcıdır, kanaldan çıkıp girince de sürer. */
  async setServerFlags(userId: string, flags: ServerFlags): Promise<void> {
    this.store.setServerVoiceFlags(userId, flags);
    this.voice.setServerFlags(userId, flags);
    const state = this.voice.get(userId);
    if (!state) return;
    if (flags.serverMute || flags.serverDeaf) await this.livekit.muteMicrophone(state.channelId, userId);
    await this.enforce(userId, state.channelId);
  }

  /** Sesten çıkarır; seste değilse false. */
  async disconnect(userId: string): Promise<boolean> {
    const state = this.voice.get(userId);
    this.applied.delete(userId);
    if (!state) return false;
    await this.livekit.removeParticipant(state.channelId, userId);
    this.voice.leave(userId, state.channelId);
    return true;
  }

  /** Bağlı üyeyi başka kanala taşır (LiveKit bağlantısı kopmadan odasını değiştirir). */
  async move(userId: string, channelId: string): Promise<void> {
    const state = this.voice.get(userId);
    if (!state || state.channelId === channelId) return;
    await this.livekit.moveParticipant(state.channelId, userId, channelId);
    // Webhook'lar da gelir; beklemeden güncelle ki herkes hemen görsün
    this.voice.join(userId, channelId, state.streaming);
    this.applied.delete(userId);
    await this.enforce(userId, channelId);
  }
}
