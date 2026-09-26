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

  /** Kullanıcının tek bir ses kanalına bağlanmasına izin veren kısa ömürlü jeton. */
  createJoinToken(user: User, channelId: string): Promise<string> {
    const token = new AccessToken(this.config.livekitApiKey, this.config.livekitApiSecret, {
      identity: user.id,
      name: user.displayName,
      ttl: TOKEN_TTL,
      metadata: JSON.stringify({ avatarColor: user.avatarColor }),
    });
    token.addGrant({
      room: voiceRoomName(channelId),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
      canPublishSources: [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    });
    return token.toJwt();
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
