import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  WebhookReceiver,
  type WebhookEvent,
} from 'livekit-server-sdk';
import { channelIdFromRoom, voiceRoomName, type User } from '@diskort/shared';
import type { Config } from './config.js';
import type { VoiceSnapshotEntry } from './voiceState.js';

const TOKEN_TTL = '12h';

/** Yayınlanabilecek kaynaklar: mikrofon (SPEAK), ekran ve sesi (STREAM) */
export type PublishSources = TrackSource[];

/** Katılımcının LiveKit izinleri; güncellemede tüm alanlar birlikte verilmeli (LiveKit hepsini değiştirir) */
function permission(sources: PublishSources) {
  return {
    canSubscribe: true,
    // Boş kaynak listesi LiveKit'te "hepsi" demektir; hiçbir şey yayınlayamayacaksa yayın kapatılır
    canPublish: sources.length > 0,
    canPublishData: true,
    canPublishSources: sources,
    canUpdateMetadata: false,
  };
}

export class LiveKitService {
  private readonly rooms: RoomServiceClient;
  private readonly receiver: WebhookReceiver;

  constructor(private readonly config: Config) {
    this.rooms = new RoomServiceClient(config.livekitApiUrl, config.livekitApiKey, config.livekitApiSecret);
    this.receiver = new WebhookReceiver(config.livekitApiKey, config.livekitApiSecret);
  }

  get publicUrl(): string {
    return this.config.livekitPublicUrl;
  }

  /**
   * Kullanıcının tek bir ses kanalına bağlanmasına izin veren kısa ömürlü jeton. `sources` kanaldaki
   * yetkilerinden gelir (bkz. VoiceModeration).
   */
  createJoinToken(
    user: User,
    channelId: string,
    sources: PublishSources = [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
  ): Promise<string> {
    const token = new AccessToken(this.config.livekitApiKey, this.config.livekitApiSecret, {
      identity: user.id,
      name: user.displayName,
      ttl: TOKEN_TTL,
      metadata: JSON.stringify({ avatarColor: user.avatarColor }),
    });
    const p = permission(sources);
    token.addGrant({
      room: voiceRoomName(channelId),
      roomJoin: true,
      canPublish: p.canPublish,
      canSubscribe: p.canSubscribe,
      canPublishData: p.canPublishData,
      canUpdateOwnMetadata: false,
      ...(sources.length > 0 ? { canPublishSources: sources } : {}),
    });
    return token.toJwt();
  }

  /** Bağlı katılımcının yayın izinlerini değiştirir (izni alınan kaynağın yayını LiveKit'te kapanır). */
  async setPublishSources(channelId: string, userId: string, sources: PublishSources): Promise<void> {
    try {
      await this.rooms.updateParticipant(voiceRoomName(channelId), userId, { permission: permission(sources) });
    } catch {
      // Katılımcı ayrılmış olabilir.
    }
  }

  /** Katılımcının mikrofonunu sunucudan susturur (izin de ayrıca alınır; bu anında sessizlik içindir). */
  async muteMicrophone(channelId: string, userId: string): Promise<void> {
    try {
      const room = voiceRoomName(channelId);
      const participant = await this.rooms.getParticipant(room, userId);
      for (const track of participant.tracks) {
        if (track.source === TrackSource.MICROPHONE && !track.muted) {
          await this.rooms.mutePublishedTrack(room, userId, track.sid, true);
        }
      }
    } catch {
      // Katılımcı ayrılmış ya da mikrofonu hiç açmamış olabilir.
    }
  }

  /** Bağlı katılımcıyı başka bir ses kanalına taşır (bağlantısı kopmadan). */
  async moveParticipant(fromChannelId: string, userId: string, toChannelId: string): Promise<void> {
    await this.rooms.moveParticipant(voiceRoomName(fromChannelId), userId, voiceRoomName(toChannelId));
  }

  receiveWebhook(body: string, authHeader: string | undefined): Promise<WebhookEvent> {
    return this.receiver.receive(body, authHeader);
  }

  /** LiveKit'teki tüm ses odalarındaki katılımcıların anlık görüntüsü. */
  async snapshot(): Promise<Map<string, VoiceSnapshotEntry>> {
    const result = new Map<string, VoiceSnapshotEntry>();
    const rooms = await this.rooms.listRooms();
    for (const room of rooms) {
      const channelId = channelIdFromRoom(room.name);
      if (!channelId || room.numParticipants === 0) continue;
      const participants = await this.rooms.listParticipants(room.name);
      for (const p of participants) {
        result.set(p.identity, {
          channelId,
          streaming: p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE),
        });
      }
    }
    return result;
  }

  async removeParticipant(channelId: string, userId: string): Promise<void> {
    try {
      await this.rooms.removeParticipant(voiceRoomName(channelId), userId);
    } catch {
      // Katılımcı zaten ayrılmış olabilir.
    }
  }

  async closeChannelRoom(channelId: string): Promise<void> {
    try {
      await this.rooms.deleteRoom(voiceRoomName(channelId));
    } catch {
      // Oda hiç açılmamış olabilir.
    }
  }
}

export { TrackSource };
