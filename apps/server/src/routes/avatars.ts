import fs from 'node:fs';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { UploadError } from '../attachments.js';
import { AVATAR_HASH } from '../avatars.js';
import { sendError, type AppContext } from '../context.js';
import { createRateLimiter } from './messages.js';

type ImageKind = 'avatar' | 'banner';

const LIMIT_MESSAGE: Record<ImageKind, string> = {
  avatar: 'Profil fotoğrafını çok sık değiştiriyorsun, biraz bekle.',
  banner: 'Afişini çok sık değiştiriyorsun, biraz bekle.',
};

const NOT_FOUND: Record<ImageKind, string> = {
  avatar: 'Profil fotoğrafı bulunamadı.',
  banner: 'Afiş bulunamadı.',
};

/**
 * Profil fotoğrafları ve afişleri. Kullanıcı yalnızca kendininkini yükler ya da kaldırır; değişiklik
 * USER_UPDATE ile onu görebilenlere (ortak sunucu, DM) iletilir. Resimler, <img> ve React Native <Image>
 * jeton gönderemediği için kimlik doğrulamasız sunulur; adres içerik özetini taşıdığından süresiz
 * önbelleklenebilir.
 */
export function registerAvatarRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, gateway, avatars } = ctx;
  // Fotoğraf ve afiş ayrı sayılır
  const allowAvatar = createRateLimiter(10, 10 * 60_000);
  const allowBanner = createRateLimiter(10, 10 * 60_000);
  const allow = (kind: ImageKind, userId: string): boolean =>
    kind === 'avatar' ? allowAvatar(userId) : allowBanner(userId);

  // Gövde ham resimdir (dosya eklerindeki gibi); boyut sınırını AvatarService uygular.
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

    const upload = (kind: ImageKind) => async (req: FastifyRequest, reply: FastifyReply) => {
      if (!allow(kind, req.user.id)) return sendError(reply, 429, 'rate_limited', LIMIT_MESSAGE[kind]);
      const length = req.headers['content-length'];
      const body = (req.body as Readable | undefined) ?? req.raw;
      const size = length !== undefined && /^\d+$/.test(length) ? Number(length) : null;
      try {
        const user =
          kind === 'avatar'
            ? await avatars.upload(req.user.id, body, size)
            : await avatars.uploadBanner(req.user.id, body, size);
        gateway.sendUserUpdate(user);
        return user;
      } catch (err) {
        if (err instanceof UploadError) return sendError(reply, err.status, err.code, err.message);
        throw err;
      }
    };
    const options = {
      onRequest: auth.requireUser,
      // Hata yanıtında okunmamış gövde boşuna okunmasın: bağlantı yanıttan sonra kapanır
      onSend: async (_req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
        if (reply.statusCode !== 200) void reply.header('Connection', 'close');
        return payload;
      },
    };
    scope.post('/api/me/avatar', options, upload('avatar'));
    scope.post('/api/me/banner', options, upload('banner'));
  });

  const remove = (kind: ImageKind) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!allow(kind, req.user.id)) return sendError(reply, 429, 'rate_limited', LIMIT_MESSAGE[kind]);
    const user = kind === 'avatar' ? await avatars.remove(req.user.id) : await avatars.removeBanner(req.user.id);
    if (!user) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
    gateway.sendUserUpdate(user);
    return user;
  };
  app.delete('/api/me/avatar', { preHandler: auth.requireUser }, remove('avatar'));
  app.delete('/api/me/banner', { preHandler: auth.requireUser }, remove('banner'));

  // Yalnızca kullanıcının şu anki resmi sunulur; eskisinin adresi (dosya silindiği için) 404 döner.
  const serve =
    (kind: ImageKind) =>
    async (req: FastifyRequest<{ Params: { userId: string; file: string } }>, reply: FastifyReply) => {
      const hash = req.params.file.endsWith('.webp') ? req.params.file.slice(0, -5) : '';
      const current = kind === 'avatar' ? store.getAvatarHash(req.params.userId) : store.getBannerHash(req.params.userId);
      if (!AVATAR_HASH.test(hash) || current !== hash) return sendError(reply, 404, 'not_found', NOT_FOUND[kind]);
      const file = avatars.pathOf(hash);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat) return sendError(reply, 404, 'not_found', NOT_FOUND[kind]);

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
    };
  app.get('/api/avatars/:userId/:file', serve('avatar'));
  app.get('/api/banners/:userId/:file', serve('banner'));
}
