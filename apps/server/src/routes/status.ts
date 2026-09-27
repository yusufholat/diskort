import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CUSTOM_STATUS_MAX_LENGTH, STATUS_DURATION_MAX_MS, STATUS_DURATION_MIN_MS } from '@diskort/shared';
import { parseBody, sendError, type AppContext } from '../context.js';
import { normalizeEmoji } from '../emoji.js';
import type { StatusChange } from '../presence.js';
import { createRateLimiter } from './messages.js';

const duration = z
  .number()
  .int()
  .min(STATUS_DURATION_MIN_MS, 'Süre çok kısa.')
  .max(STATUS_DURATION_MAX_MS, 'Süre çok uzun.')
  .nullish();

/** Satır sonları ve görünmez denetim karakterleri tek boşluğa iner */
const cleanText = (raw: string): string =>
  raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const statusSchema = z
  .object({
    status: z.enum(['online', 'idle', 'dnd', 'invisible'], { message: 'Geçersiz durum.' }).optional(),
    expiresInMs: duration,
    customStatus: z
      .object({
        text: z
          .string()
          .max(CUSTOM_STATUS_MAX_LENGTH * 2)
          .nullish()
          .transform((t) => (t ? cleanText(t) : null))
          .refine((t) => t === null || [...t].length <= CUSTOM_STATUS_MAX_LENGTH, {
            message: `Özel durum en fazla ${CUSTOM_STATUS_MAX_LENGTH} karakter olabilir.`,
          }),
        emoji: z.string().max(64).nullish(),
        expiresInMs: duration,
      })
      .nullable()
      .optional(),
  })
  .refine((b) => b.status !== undefined || b.customStatus !== undefined, { message: 'Değişiklik yok.' });

export function registerStatusRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { auth, gateway } = ctx;
  // Durum menüsünde art arda tıklamalar olağan; sel koruması yeterince gevşek
  const allowChange = createRateLimiter(20, 60_000);

  app.get('/api/me/status', { preHandler: auth.requireUser }, async (req) => gateway.statuses.get(req.user.id));

  app.patch('/api/me/status', { preHandler: auth.requireUser }, async (req, reply) => {
    if (!allowChange(req.user.id)) return sendError(reply, 429, 'rate_limited', 'Durumunu çok sık değiştirdin. Biraz bekle.');
    const body = parseBody(statusSchema, req.body, reply);
    if (!body) return reply;
    let customStatus: StatusChange['customStatus'];
    if (body.customStatus) {
      let emoji: string | null = null;
      if (body.customStatus.emoji) {
        emoji = normalizeEmoji(body.customStatus.emoji);
        if (!emoji) return sendError(reply, 400, 'invalid_emoji', 'Geçersiz emoji.');
      }
      customStatus = { text: body.customStatus.text, emoji, expiresInMs: body.customStatus.expiresInMs ?? null };
    } else if (body.customStatus === null) customStatus = null;
    const status = gateway.statuses.set(req.user.id, {
      ...(body.status !== undefined ? { status: body.status, expiresInMs: body.expiresInMs ?? null } : {}),
      ...(customStatus !== undefined ? { customStatus } : {}),
    });
    gateway.statusChanged(req.user.id);
    return status;
  });
}
