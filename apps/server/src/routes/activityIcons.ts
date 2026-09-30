import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { ACTIVITY_ICON_KEY_PATTERN, ACTIVITY_ICON_MAX_BYTES } from '@diskort/shared';
import { tooLarge } from '../activityIcons.js';
import { UploadError } from '../attachments.js';
import { sendError, type AppContext } from '../context.js';
import { createRateLimiter } from './messages.js';

type KeyRoute = { Params: { key: string } };

/**
 * Etkinlik (oyun) ikonları. İstemci oynanan oyunun ikonunu bir kez yükler (anahtar dosyanın SHA-256'sı;
 * sunucuda varsa yeniden yazılmaz), sonra ACTIVITY_SET'te anahtarını bildirir. İkonlar, <img> ve React
 * Native <Image> jeton gönderemediği için kimlik doğrulamasız sunulur; anahtar içeriğin özeti olduğundan
 * süresiz önbelleklenebilir.
 */
export function registerActivityIconRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { auth, activityIcons } = ctx;
  // Yalnızca sunucuda olmayan (yeni) ikonlar sayılır: bir oyuncu saatte bu kadar farklı oyun açmaz
  const allowUpload = createRateLimiter(30, 60 * 60_000);

  // Gövde ham PNG'dir; boyut sınırını Fastify (bodyLimit) uygular.
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('image/png', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scope.setErrorHandler((err: { code?: string }, _req, reply) => {
      if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        const e = tooLarge();
        return sendError(reply, e.status, e.code, e.message);
      }
      if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
        return sendError(reply, 415, 'unsupported_type', 'Yalnızca PNG ikon yüklenebilir.');
      }
      throw err;
    });

    scope.put<KeyRoute>(
      '/api/activity-icons/:key',
      { onRequest: auth.requireUser, bodyLimit: ACTIVITY_ICON_MAX_BYTES },
      async (req, reply) => {
        const { key } = req.params;
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        try {
          const created = await activityIcons.save(key, body, () => allowUpload(req.user.id));
          return await reply.code(created ? 201 : 200).send({ key });
        } catch (err) {
          if (err instanceof UploadError) return sendError(reply, err.status, err.code, err.message);
          throw err;
        }
      },
    );
  });

  // HEAD de buradan yanıtlanır (Fastify GET yolları için kendisi ekler): istemci yüklemeden önce var mı diye bakar
  app.get<KeyRoute>('/api/activity-icons/:key', async (req, reply) => {
    const { key } = req.params;
    // Yol yalnızca doğrulanmış ve depoda olan anahtardan kurulur
    const file = ACTIVITY_ICON_KEY_PATTERN.test(key) ? activityIcons.pathOf(key) : null;
    const stat = file ? await fs.promises.stat(file).catch(() => null) : null;
    if (!file || !stat) return sendError(reply, 404, 'not_found', 'İkon bulunamadı.');

    const etag = `"${key}"`;
    void reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('ETag', etag)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply
      .header('Content-Type', 'image/png')
      .header('Content-Length', stat.size)
      .send(fs.createReadStream(file));
  });
}
