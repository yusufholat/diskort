import fs from 'node:fs';
import type { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { UploadError } from '../attachments.js';
import { AVATAR_HASH } from '../avatars.js';
import { sendError, type AppContext } from '../context.js';
import { createRateLimiter } from './messages.js';

/**
 * Profil fotoğrafları. Kullanıcı yalnızca kendi fotoğrafını yükler ya da kaldırır; değişiklik USER_UPDATE
 * ile onu görebilenlere (ortak sunucu, DM) iletilir. Fotoğraflar, <img> ve React Native <Image> jeton gönderemediği için kimlik
 * doğrulamasız sunulur; adres içerik özetini taşıdığından süresiz önbelleklenebilir.
 */
export function registerAvatarRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, gateway, avatars } = ctx;
  const allowChange = createRateLimiter(10, 10 * 60_000);

  // Gövde ham resimdir (dosya eklerindeki gibi); boyut sınırını AvatarService uygular.
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

    scope.post(
      '/api/me/avatar',
      {
        onRequest: auth.requireUser,
        // Hata yanıtında okunmamış gövde boşuna okunmasın: bağlantı yanıttan sonra kapanır
        onSend: async (_req, reply, payload) => {
          if (reply.statusCode !== 200) void reply.header('Connection', 'close');
          return payload;
        },
      },
      async (req, reply) => {
        if (!allowChange(req.user.id)) {
          return sendError(reply, 429, 'rate_limited', 'Profil fotoğrafını çok sık değiştiriyorsun, biraz bekle.');
        }
        const length = req.headers['content-length'];
        try {
          const user = await avatars.upload(
            req.user.id,
            (req.body as Readable | undefined) ?? req.raw,
            length !== undefined && /^\d+$/.test(length) ? Number(length) : null,
          );
          gateway.sendUserUpdate(user);
          return user;
        } catch (err) {
          if (err instanceof UploadError) return sendError(reply, err.status, err.code, err.message);
          throw err;
        }
      },
    );
  });

  app.delete('/api/me/avatar', { preHandler: auth.requireUser }, async (req, reply) => {
    if (!allowChange(req.user.id)) {
      return sendError(reply, 429, 'rate_limited', 'Profil fotoğrafını çok sık değiştiriyorsun, biraz bekle.');
    }
    const user = await avatars.remove(req.user.id);
    if (!user) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
    gateway.sendUserUpdate(user);
    return user;
  });

  // Yalnızca kullanıcının şu anki fotoğrafı sunulur; eskisinin adresi (dosya silindiği için) 404 döner.
  app.get<{ Params: { userId: string; file: string } }>('/api/avatars/:userId/:file', async (req, reply) => {
    const hash = req.params.file.endsWith('.webp') ? req.params.file.slice(0, -5) : '';
    if (!AVATAR_HASH.test(hash) || store.getAvatarHash(req.params.userId) !== hash) {
      return sendError(reply, 404, 'not_found', 'Profil fotoğrafı bulunamadı.');
    }
    const file = avatars.pathOf(hash);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat) return sendError(reply, 404, 'not_found', 'Profil fotoğrafı bulunamadı.');

    const etag = `"${hash}"`;
    void reply
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('ETag', etag)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply
      .header('Content-Type', 'image/webp')
      .header('Content-Length', stat.size)
      .send(fs.createReadStream(file));
  });
}
