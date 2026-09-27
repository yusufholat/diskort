import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  channelIdFromRoom,
  STREAM_PREVIEW_MAX_BYTES,
  voiceRoomName,
  type VoiceJoinResponse,
} from '@diskort/shared';
import { UploadError } from '../attachments.js';
import { TrackSource } from '../livekit.js';
import { forbidden, parseBody, sendError, type AppContext } from '../context.js';
import { sanitizeSourceName } from '../streamPreview.js';
import { createRateLimiter } from './messages.js';

const streamSourceSchema = z.object({
  name: z.string().max(512),
  kind: z.enum(['screen', 'window']),
});

/** Önizleme yükleme sıklığı: istemci ~25 sn'de bir yükler; yeniden başlatmalara pay bırakılır */
const PREVIEW_UPLOADS_PER_MINUTE = 8;

export function registerVoiceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, voice, livekit, permissions, moderation, streamPreviews } = ctx;
  const allowPreview = createRateLimiter(PREVIEW_UPLOADS_PER_MINUTE, 60_000);
  const allowSource = createRateLimiter(10, 60_000);

  // Jetonun yayın izinleri kanaldaki yetkilerden gelir (SPEAK → mikrofon, STREAM → ekran)
  app.post<{ Params: { channelId: string } }>(
    '/api/voice/:channelId/join',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      const channel = store.getChannel(req.params.channelId);
      if (!channel || channel.type !== 'voice' || !permissions.canView(req.user.id, channel)) {
        return sendError(reply, 404, 'not_found', 'Ses kanalı bulunamadı.');
      }
      if (!moderation.canConnect(req.user.id, channel.id)) return forbidden(reply, 'Bu ses kanalına bağlanma iznin yok.');
      const response: VoiceJoinResponse = {
        url: livekit.publicUrl,
        token: await moderation.joinToken(req.user, channel.id),
        roomName: voiceRoomName(channel.id),
      };
      return response;
    },
  );

  // ---------- Yayın önizlemesi ("Şimdi Yayın Yapıyor" kartı) ----------

  // Yayıncı paylaştığı pencerenin/ekranın adını bildirir (yayın başlamadan hemen önce ya da sonra)
  app.put('/api/voice/stream-source', { preHandler: auth.requireUser }, async (req, reply) => {
    if (!allowSource(req.user.id)) return sendError(reply, 429, 'rate_limited', 'Çok sık istek, biraz bekle.');
    const body = parseBody(streamSourceSchema, req.body, reply);
    if (!body) return reply;
    const name = sanitizeSourceName(body.name);
    const ok = voice.setStreamSource(req.user.id, name ? { name, kind: body.kind } : null);
    if (!ok) return sendError(reply, 409, 'not_in_voice', 'Bir ses kanalında değilsin.');
    return reply.code(204).send();
  });

  // Önizleme karesi: ham JPEG/WebP/PNG gövde, en çok 256 KB; yalnızca yayındayken, yalnızca bellekte tutulur
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      ['image/jpeg', 'image/webp', 'image/png'],
      { parseAs: 'buffer', bodyLimit: STREAM_PREVIEW_MAX_BYTES },
      (_req, body, done) => done(null, body),
    );

    scope.put('/api/voice/stream-preview', { onRequest: auth.requireUser }, async (req, reply) => {
      if (!allowPreview(req.user.id)) {
        return sendError(reply, 429, 'rate_limited', 'Önizleme çok sık yükleniyor, biraz bekle.');
      }
      if (!voice.get(req.user.id)?.streaming) return sendError(reply, 409, 'not_streaming', 'Yayında değilsin.');
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return sendError(reply, 400, 'invalid_image', 'Önizleme resmi boş.');
      }
      try {
        const at = await streamPreviews.put(req.user.id, req.body);
        if (at === null) return sendError(reply, 409, 'not_streaming', 'Yayında değilsin.');
        return { at };
      } catch (err) {
        if (err instanceof UploadError) return sendError(reply, err.status, err.code, err.message);
        throw err;
      }
    });
  });

  // Önizlemeyi yalnızca o ses kanalını görebilenler alır; yayın yoksa (ya da başka kanaldaysa) 404
  app.get<{ Params: { channelId: string; userId: string } }>(
    '/api/voice/:channelId/stream-preview/:userId',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      const channel = store.getChannel(req.params.channelId);
      const preview =
        channel && channel.type === 'voice' && permissions.canView(req.user.id, channel)
          ? streamPreviews.get(req.params.userId, channel.id)
          : null;
      if (!preview) return sendError(reply, 404, 'not_found', 'Yayın önizlemesi bulunamadı.');
      return reply
        .header('Content-Type', 'image/webp')
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('X-Preview-At', String(preview.at))
        .send(preview.data);
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
          // Jeton alındıktan sonra yetkisini kaybeden (ya da atılan) geri çıkarılır
          if (!moderation.canConnect(userId, channelId)) {
            void livekit.removeParticipant(channelId, userId);
            break;
          }
          const prev = voice.get(userId);
          voice.join(userId, channelId, false, event.participant?.sid);
          // Aynı hesap başka bir cihazdan farklı kanalda kaldıysa oradan çıkar.
          if (prev && prev.channelId !== channelId) void livekit.removeParticipant(prev.channelId, userId);
          void moderation.onJoined(userId, channelId);
          break;
        }
        case 'participant_left':
        case 'participant_connection_aborted':
          if (userId) voice.leave(userId, channelId, event.participant?.sid);
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
