import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { GifPage } from '@diskort/shared';
import { sendError, type AppContext } from '../context.js';
import { GIF_MAX_OFFSET, GifError, normalizeQuery } from '../gifs.js';
import { createRateLimiter } from './messages.js';

const pageQuery = z.object({
  q: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).max(GIF_MAX_OFFSET).optional(),
});

/**
 * GIF seçici: popüler GIF'ler ve arama (GIPHY'ye sunucu üzerinden). Anahtar tanımlı değilse 404
 * (gifs_disabled); istemciler bunu READY'deki `features.gifs` ile zaten bilir ve düğmeyi göstermez.
 */
export function registerGifRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { auth, gifs } = ctx;
  // Yazarken arama (gecikmeli) ve kaydırdıkça sonraki sayfalar: dakikada 30 istek yeter
  const allow = createRateLimiter(30, 60_000);

  const respond = async (reply: FastifyReply, load: () => Promise<GifPage>): Promise<FastifyReply> => {
    try {
      const page = await load();
      return reply.header('Cache-Control', 'private, max-age=300').send(page);
    } catch (err) {
      if (err instanceof GifError) return sendError(reply, err.status, err.code, err.message);
      throw err;
    }
  };

  /** Ortak denetimler; geçemezse yanıtı gönderip null döner */
  const guard = (userId: string, rawQuery: unknown, reply: FastifyReply): z.infer<typeof pageQuery> | null => {
    if (!gifs.enabled) {
      void sendError(reply, 404, 'gifs_disabled', 'GIF araması bu sunucuda kapalı.');
      return null;
    }
    const query = pageQuery.safeParse(rawQuery);
    if (!query.success) {
      void sendError(reply, 400, 'invalid_query', 'Geçersiz sorgu.');
      return null;
    }
    if (!allow(userId)) {
      void sendError(reply, 429, 'rate_limited', 'Çok hızlı GIF arıyorsun, biraz bekle.');
      return null;
    }
    return query.data;
  };

  app.get('/api/gifs/trending', { preHandler: auth.requireUser }, async (req, reply) => {
    const query = guard(req.user.id, req.query, reply);
    if (!query) return reply;
    return respond(reply, () => gifs.trending(query.offset ?? 0));
  });

  app.get('/api/gifs/search', { preHandler: auth.requireUser }, async (req, reply) => {
    const query = guard(req.user.id, req.query, reply);
    if (!query) return reply;
    const q = normalizeQuery(query.q ?? '');
    if (!q) return sendError(reply, 400, 'invalid_query', 'Aranacak bir şey yaz.');
    return respond(reply, () => gifs.search(q, query.offset ?? 0));
  });
}
