import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendError, type AppContext } from '../context.js';
import type { CosmeticKind } from '../cosmetics.js';

/**
 * Kozmetik kataloğu ve resimleri (avatar dekorasyonları, profil çerçeveleri). Kimlik doğrulamasızdır:
 * profil fotoğrafları gibi <img> ve React Native <Image> jeton gönderemez, içerik de herkese açık tasarımdır.
 */
export function registerCosmeticRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { cosmetics } = ctx;

  app.get('/api/cosmetics', async (_req, reply) => {
    void reply.header('Cache-Control', 'public, max-age=300');
    return cosmetics.catalog;
  });

  const serve =
    (kind: CosmeticKind) =>
    async (req: FastifyRequest<{ Params: { file: string } }>, reply: FastifyReply) => {
      const id = req.params.file.endsWith('.webp') ? req.params.file.slice(0, -5) : '';
      const image = await cosmetics.image(kind, id);
      if (!image) return sendError(reply, 404, 'not_found', 'Bulunamadı.');
      const etag = `"${image.hash}"`;
      // Adres içeriğin özetini (?v=) taşır: süresiz önbelleklenebilir
      void reply
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('ETag', etag)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cross-Origin-Resource-Policy', 'cross-origin');
      if (req.headers['if-none-match'] === etag) return reply.code(304).send();
      return reply.header('Content-Type', 'image/webp').send(image.data);
    };
  app.get('/api/cosmetics/decorations/:file', serve('decorations'));
  app.get('/api/cosmetics/frames/:file', serve('frames'));
}
