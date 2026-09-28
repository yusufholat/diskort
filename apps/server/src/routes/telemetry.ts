import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { VoiceTelemetryReport } from '@diskort/shared';
import { parseBody, sendError, type AppContext } from '../context.js';
import { createRateLimiter } from './messages.js';

const num = (max: number) => z.number().finite().min(0).max(max).nullable();
const text = (max: number) =>
  z
    .string()
    .max(200)
    .transform((s) => s.slice(0, max))
    .nullable();

const reportSchema = z.object({
  v: z.literal(1),
  platform: z.enum(['desktop', 'android', 'ios']),
  version: z.string().max(32),
  channelId: z.string().max(64),
  windowSec: z.number().int().min(1).max(600),
  samples: z.number().int().min(0).max(1_000),
  quality: z.enum(['good', 'fair', 'poor', 'unknown']),
  poorSec: z.number().int().min(0).max(600),
  serverQuality: text(16),
  rttMs: z.object({ avg: num(60_000), max: num(60_000) }),
  jitterInMs: num(60_000),
  jitterOutMs: num(60_000),
  lossOutPct: num(100),
  lossInPct: num(100),
  concealedPct: num(100),
  bitrateOut: num(1e10),
  bitrateIn: num(1e10),
  availableOut: num(1e11),
  candidate: text(16),
  protocol: text(16),
  reconnects: z.number().int().min(0).max(1_000),
  mic: z
    .object({
      noise: z.string().max(32),
      model: text(48),
      load: num(100),
      avgFrameMs: num(10_000),
      p99FrameMs: num(10_000),
      maxFrameMs: num(10_000),
      underruns: num(1e9),
      droppedSamples: num(1e12),
      muted: z.boolean(),
    })
    .nullable(),
  screen: z
    .object({
      width: num(20_000),
      height: num(20_000),
      fps: num(1_000),
      bitrate: num(1e10),
      encoder: text(80),
      codec: text(32),
      limitation: z.enum(['none', 'cpu', 'bandwidth', 'other']),
      limitedRatio: num(1),
    })
    .nullable(),
});

/** Kullanıcı başına dakikada en fazla özet (normalde 2; kalite düşünce birkaç erken özet) */
const REPORTS_PER_MINUTE = 8;

/**
 * Ses kalitesi özetleri (bkz. telemetry.ts ve client-core voiceTelemetry.ts). Yalnızca giriş yapmış
 * kullanıcılar, kullanıcı başına sınırlı; kaydedilen kanal sunucunun bildiği ses durumundan alınır.
 */
export function registerTelemetryRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { telemetry } = ctx;
  const allow = createRateLimiter(REPORTS_PER_MINUTE, 60_000);

  app.post('/api/telemetry/voice', { preHandler: ctx.auth.requireUser, bodyLimit: 8 * 1024 }, async (req, reply) => {
    if (!allow(req.user.id)) return sendError(reply, 429, 'rate_limited', 'Çok sık ölçüm gönderiliyor.');
    const body = parseBody(reportSchema, req.body, reply);
    if (!body) return reply;
    const state = ctx.voice.get(req.user.id);
    const channelId = state?.channelId ?? null;
    telemetry.ingest(req.user.id, body as VoiceTelemetryReport, {
      channelId,
      guildId: channelId ? (ctx.store.getChannel(channelId)?.guildId ?? null) : null,
    });
    ctx.counters.inc('telemetry.reports');
    return reply.code(204).send();
  });
}
