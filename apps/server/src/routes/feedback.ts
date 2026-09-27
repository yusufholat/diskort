import fs from 'node:fs';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  FEEDBACK_BODY_MAX_LENGTH,
  FEEDBACK_MAX_ERRORS,
  FEEDBACK_MAX_SCREENSHOTS,
  FEEDBACK_NOTE_MAX_LENGTH,
  FEEDBACK_PER_HOUR,
  FEEDBACK_STATUSES,
  FEEDBACK_TITLE_MAX_LENGTH,
  FEEDBACK_TYPES,
  Permission,
  type Feedback,
  type FeedbackStatus,
  type FeedbackType,
  type GatewayServerMessage,
} from '@diskort/shared';
import { UploadError } from '../attachments.js';
import { parseBody, sendError, type AppContext } from '../context.js';
import { SCREENSHOT_ID, type FeedbackService } from '../feedback.js';
import { createRateLimiter } from './messages.js';

/** Metni en fazla `max` karaktere kırpar (teknik bilgilerde uzun değer reddedilmez, kısaltılır) */
const clip = (max: number) => z.string().transform((s) => s.slice(0, max));

const contextSchema = z.object({
  platform: z.enum(['desktop', 'android', 'ios']).optional(),
  appVersion: clip(32).optional(),
  nativeVersion: clip(32).optional(),
  os: clip(32).optional(),
  osVersion: clip(64).optional(),
  device: clip(64).optional(),
  screen: clip(64).optional(),
  window: clip(64).optional(),
  view: clip(64).optional(),
  inVoice: z.boolean().optional(),
  recentErrors: z
    .array(clip(300))
    .transform((list) => list.slice(-FEEDBACK_MAX_ERRORS))
    .optional(),
});

const createSchema = z.object({
  type: z.enum(FEEDBACK_TYPES as [FeedbackType, ...FeedbackType[]], { error: 'Geçersiz tür.' }),
  title: z
    .string()
    .trim()
    .max(FEEDBACK_TITLE_MAX_LENGTH, `Başlık en fazla ${FEEDBACK_TITLE_MAX_LENGTH} karakter olabilir.`)
    .nullish(),
  body: z
    .string({ error: 'Açıklama gerekli.' })
    .trim()
    .min(1, 'Açıklama boş olamaz.')
    .max(FEEDBACK_BODY_MAX_LENGTH, `Açıklama en fazla ${FEEDBACK_BODY_MAX_LENGTH} karakter olabilir.`),
  context: contextSchema.nullish(),
  screenshotIds: z
    .array(z.string().regex(SCREENSHOT_ID, 'Geçersiz ekran görüntüsü.'))
    .max(FEEDBACK_MAX_SCREENSHOTS, `En fazla ${FEEDBACK_MAX_SCREENSHOTS} ekran görüntüsü eklenebilir.`)
    .optional(),
});

const statusSchema = z.enum(FEEDBACK_STATUSES as [FeedbackStatus, ...FeedbackStatus[]], { error: 'Geçersiz durum.' });

const updateSchema = z
  .object({
    status: statusSchema.optional(),
    adminNote: z
      .string()
      .trim()
      .max(FEEDBACK_NOTE_MAX_LENGTH, `Not en fazla ${FEEDBACK_NOTE_MAX_LENGTH} karakter olabilir.`)
      .nullish(),
  })
  .refine((b) => b.status !== undefined || b.adminNote !== undefined, 'Değişiklik yok.');

const listQuery = z.object({
  status: statusSchema.optional(),
  type: z.enum(FEEDBACK_TYPES as [FeedbackType, ...FeedbackType[]], { error: 'Geçersiz tür.' }).optional(),
});

const HOUR_MS = 60 * 60_000;
/** Temizlik aralığı: gönderilmeyen ekran görüntüleri ve artık dosyalar */
const SWEEP_INTERVAL_MS = 10 * 60_000;

/**
 * Geri bildirimler. Her üye gönderebilir ve kendi gönderdiklerini (durum ve yönetici notuyla) görür;
 * listeyi, durumu, notu ve silmeyi Sunucuyu Yönet (ya da Yönetici) yetkisi olanlar yönetir.
 *
 * Ekran görüntüleri iki adımda gelir (dosya ekleri gibi): önce POST /api/feedback/screenshots ile ham
 * resim yüklenir, dönen kimlikler geri bildirim oluşturulurken verilir. Resimler herkese açık adreslerden
 * DEĞİL, Authorization başlığıyla ve yalnızca yetkililere ve gönderene sunulur.
 */
export function registerFeedbackRoutes(app: FastifyInstance, ctx: AppContext, feedback: FeedbackService): void {
  const { auth, gateway, permissions } = ctx;
  const store = feedback.store;
  const allowUpload = createRateLimiter(15, HOUR_MS);

  const isManager = (userId: string): boolean => permissions.can(userId, Permission.MANAGE_GUILD);
  const managersOnline = (): string[] => gateway.connectedUserIds().filter(isManager);
  const notify = (msg: GatewayServerMessage, ownerId: string | null): void => {
    const to = managersOnline();
    if (ownerId) to.push(ownerId);
    gateway.sendToUsers(to, msg);
  };

  /** Yol parametresindeki geri bildirim; yoksa (ya da görme hakkı yoksa) 404 */
  const load = (rawId: string, userId: string, reply: FastifyReply): Feedback | null => {
    const item = /^\d{1,12}$/.test(rawId) ? store.get(Number(rawId)) : null;
    if (!item || (item.userId !== userId && !isManager(userId))) {
      void sendError(reply, 404, 'not_found', 'Geri bildirim bulunamadı.');
      return null;
    }
    return item;
  };

  const sweep = (): void => {
    feedback.sweep().catch((err: unknown) => app.log.warn({ err: String(err) }, 'geri bildirim temizliği başarısız'));
  };
  const timers = [setTimeout(sweep, 90_000), setInterval(sweep, SWEEP_INTERVAL_MS)];
  for (const timer of timers) timer.unref();
  app.addHook('onClose', async () => timers.forEach((timer) => clearTimeout(timer)));

  // ---------- Ekran görüntüsü yükleme (ham gövde) ----------

  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

    scope.post(
      '/api/feedback/screenshots',
      {
        onRequest: auth.requireUser,
        // Hata yanıtında okunmamış gövde boşuna okunmasın: bağlantı yanıttan sonra kapanır
        onSend: async (_req, reply, payload) => {
          if (reply.statusCode !== 201) void reply.header('Connection', 'close');
          return payload;
        },
      },
      async (req, reply) => {
        if (!allowUpload(req.user.id)) {
          return sendError(reply, 429, 'rate_limited', 'Çok fazla ekran görüntüsü yükledin, biraz bekle.');
        }
        const length = req.headers['content-length'];
        try {
          const shot = await feedback.upload(
            req.user.id,
            (req.body as Readable | undefined) ?? req.raw,
            length !== undefined && /^\d+$/.test(length) ? Number(length) : null,
          );
          return reply.code(201).send(shot);
        } catch (err) {
          if (err instanceof UploadError) return sendError(reply, err.status, err.code, err.message);
          throw err;
        }
      },
    );
  });

  // ---------- Gönderme ve kendi listesi ----------

  app.post('/api/feedback', { preHandler: auth.requireUser }, async (req, reply) => {
    const body = parseBody(createSchema, req.body, reply);
    if (!body) return reply;
    if (store.countSince(req.user.id, Date.now() - HOUR_MS) >= FEEDBACK_PER_HOUR) {
      return sendError(
        reply,
        429,
        'rate_limited',
        `Bir saatte en fazla ${FEEDBACK_PER_HOUR} geri bildirim gönderebilirsin. Biraz sonra tekrar dene.`,
      );
    }
    const screenshotIds = [...new Set(body.screenshotIds ?? [])];
    const owned = store.pendingOwned(req.user.id, screenshotIds);
    if (owned.size !== screenshotIds.length) {
      return sendError(reply, 400, 'invalid_screenshot', 'Ekran görüntüsü bulunamadı; yeniden eklemeyi dene.');
    }
    const created = store.create({
      userId: req.user.id,
      type: body.type,
      title: body.title || null,
      body: body.body,
      context: body.context ?? null,
      screenshotIds,
    });
    req.log.info(
      { feedback: { id: created.id, type: created.type, user: req.user.username, screenshots: screenshotIds.length } },
      'yeni geri bildirim',
    );
    gateway.sendToUsers(
      managersOnline().filter((id) => id !== req.user.id),
      { t: 'FEEDBACK_CREATE', d: created },
    );
    return reply.code(201).send(created);
  });

  app.get('/api/feedback/mine', { preHandler: auth.requireUser }, async (req) =>
    store.list({ userId: req.user.id, limit: 100 }),
  );

  // ---------- Yönetim (Sunucuyu Yönet) ----------

  const requireManager = auth.requirePermission(Permission.MANAGE_GUILD);

  app.get('/api/feedback', { preHandler: requireManager }, async (req, reply) => {
    const query = listQuery.safeParse(req.query ?? {});
    if (!query.success) return sendError(reply, 400, 'invalid_query', query.error.issues[0]?.message ?? 'Geçersiz istek.');
    return store.list(query.data);
  });

  app.get('/api/feedback/stats', { preHandler: requireManager }, async () => ({ counts: store.countByStatus() }));

  app.get<{ Params: { id: string } }>('/api/feedback/:id', { preHandler: auth.requireUser }, async (req, reply) => {
    return load(req.params.id, req.user.id, reply) ?? reply;
  });

  app.patch<{ Params: { id: string } }>('/api/feedback/:id', { preHandler: requireManager }, async (req, reply) => {
    const body = parseBody(updateSchema, req.body, reply);
    if (!body) return reply;
    const item = load(req.params.id, req.user.id, reply);
    if (!item) return reply;
    const updated = store.update(item.id, {
      status: body.status,
      adminNote: body.adminNote === undefined ? undefined : body.adminNote || null,
    });
    if (!updated) return sendError(reply, 404, 'not_found', 'Geri bildirim bulunamadı.');
    notify({ t: 'FEEDBACK_UPDATE', d: updated }, updated.userId);
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/feedback/:id', { preHandler: requireManager }, async (req, reply) => {
    const item = load(req.params.id, req.user.id, reply);
    if (!item) return reply;
    const removed = store.delete(item.id);
    if (removed === null) return sendError(reply, 404, 'not_found', 'Geri bildirim bulunamadı.');
    await feedback.remove(removed);
    notify({ t: 'FEEDBACK_DELETE', d: { id: item.id } }, item.userId);
    return reply.code(204).send();
  });

  // ---------- Ekran görüntüsünü alma (yalnızca yetkililer ve gönderen) ----------

  app.get<{ Params: { id: string } }>(
    '/api/feedback/screenshots/:id',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      const { id } = req.params;
      const found = SCREENSHOT_ID.test(id) ? store.getScreenshot(id) : null;
      const userId = req.user.id;
      const allowed =
        found !== null &&
        (isManager(userId) ||
          (found.feedbackId === null
            ? found.uploaderId === userId
            : store.get(found.feedbackId)?.userId === userId));
      if (!found || !allowed) return sendError(reply, 404, 'not_found', 'Ekran görüntüsü bulunamadı.');
      const file = feedback.pathOf(id);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat) return sendError(reply, 404, 'not_found', 'Ekran görüntüsü bulunamadı.');
      return reply
        // Yalnızca istemcinin kendi önbelleği; ortak önbellekler (vekil sunucular) saklamaz
        .header('Cache-Control', 'private, max-age=3600')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Content-Type', 'image/webp')
        .header('Content-Length', stat.size)
        .send(fs.createReadStream(file));
    },
  );
}
