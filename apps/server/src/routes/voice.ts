import type { FastifyInstance } from 'fastify';
import { channelIdFromRoom, voiceRoomName, type VoiceJoinResponse } from '@diskurt/shared';
import { TrackSource } from '../livekit.js';
import { sendError, type AppContext } from '../context.js';

export function registerVoiceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, voice, livekit } = ctx;

  app.post<{ Params: { channelId: string } }>(
    '/api/voice/:channelId/join',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      const channel = store.getChannel(req.params.channelId);
      if (!channel || channel.type !== 'voice') {
        return sendError(reply, 404, 'not_found', 'Ses kanalı bulunamadı.');
      }
      const response: VoiceJoinResponse = {
        url: livekit.publicUrl,
        token: await livekit.createJoinToken(req.user, channel.id),
        roomName: voiceRoomName(channel.id),
      };
      return response;
    },
  );

  // LiveKit webhook'ları ham gövde ile imza doğrulaması ister.
  app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/webhook+json',
      { parseAs: 'string' },
      (_req, body, done) => done(null, body),
    );

    scope.post('/api/livekit/webhook', async (req, reply) => {
      let event;
      try {
        event = await livekit.receiveWebhook(req.body as string, req.headers.authorization);
      } catch (err) {
        req.log.warn({ err }, 'geçersiz LiveKit webhook');
        return sendError(reply, 401, 'invalid_signature', 'Webhook doğrulanamadı.');
      }

      const channelId = event.room ? channelIdFromRoom(event.room.name) : null;
      const userId = event.participant?.identity;
      if (!channelId) return { ok: true };

      switch (event.event) {
        case 'participant_joined': {
          if (!userId || !store.getUser(userId)) break;
          const prev = voice.get(userId);
          voice.join(userId, channelId);
          // Aynı hesap başka bir cihazdan farklı kanalda kaldıysa oradan çıkar.
          if (prev && prev.channelId !== channelId) void livekit.removeParticipant(prev.channelId, userId);
          break;
        }
        case 'participant_left':
        case 'participant_connection_aborted':
          if (userId) voice.leave(userId, channelId);
          break;
        case 'track_published':
        case 'track_unpublished':
          if (userId && event.track?.source === TrackSource.SCREEN_SHARE) {
            voice.setStreaming(userId, channelId, event.event === 'track_published');
          }
          break;
        case 'room_finished':
          voice.leaveChannel(channelId);
          break;
      }
      return { ok: true };
    });
  });
}
