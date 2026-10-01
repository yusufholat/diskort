import type { FastifyInstance } from 'fastify';
import { VOICE_TRACE_MAX_BYTES, type VoiceTraceUpload } from '@diskort/shared';
import { traceUploadSchema } from '../clientTrace.js';
import { parseBody, sendError, type AppContext } from '../context.js';
import { createRateLimiter } from './messages.js';

/** Kullanıcı başına dakikada en fazla olay kaydı (normalde en çok 1 + sunucu istekleri; yeniden denemeler dahil) */
const TRACES_PER_MINUTE = 8;
/** Saat sorgusu (istemci ~10 dakikada bir sorar) */
const TIME_PER_MINUTE = 20;

/**
 * Olay kayıtları (bkz. clientTrace.ts ve client-core voiceTrace.ts) ve saat farkı ölçümü. Yalnızca giriş
 * yapmış kullanıcılar, kullanıcı başına sınırlı. Kayıt sesten çıkıldıktan sonra da ulaşabilir (kesintide
 * alınan kayıt yeniden denenir): kanal önce sunucunun bildiği ses durumundan, yoksa istemcinin bildirdiği
 * ve kullanıcının görebildiği kanaldan alınır.
 */
export function registerVoiceTraceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const allowTrace = createRateLimiter(TRACES_PER_MINUTE, 60_000);
  const allowTime = createRateLimiter(TIME_PER_MINUTE, 60_000);

  // İstemci, kendi saatiyle sunucununki arasındaki farkı bundan ölçer (gidiş-dönüşün ortası)
  app.get('/api/time', { preHandler: ctx.auth.requireUser }, async (req, reply) => {
    if (!allowTime(req.user.id)) return sendError(reply, 429, 'rate_limited', 'Çok sık saat sorgusu.');
    return reply.header('cache-control', 'no-store').send({ now: Date.now() });
  });

  app.post(
    '/api/telemetry/voice-trace',
    { preHandler: ctx.auth.requireUser, bodyLimit: VOICE_TRACE_MAX_BYTES },
    async (req, reply) => {
      if (!allowTrace(req.user.id)) return sendError(reply, 429, 'rate_limited', 'Çok sık olay kaydı gönderiliyor.');
      const body = parseBody(traceUploadSchema, req.body, reply);
      if (!body) return reply;
      const state = ctx.voice.get(req.user.id);
      const claimed = ctx.store.getChannel(body.channelId);
      const channelId =
        state?.channelId ?? (claimed && ctx.permissions.canView(req.user.id, claimed.id) ? claimed.id : null);
      const meta = ctx.traces.ingest(req.user.id, body as VoiceTraceUpload, {
        channelId,
        guildId: channelId ? (ctx.store.getChannel(channelId)?.guildId ?? null) : null,
      });
      ctx.counters.inc(meta ? 'trace.uploads' : 'trace.duplicates');
      return reply.code(204).send();
    },
  );
}
