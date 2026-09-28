import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../context.js';

/**
 * Eski kozmetik kataloğu (avatar dekorasyonları, profil çerçeveleri): kaldırıldı, yalnızca 0.8.x
 * istemciler için duruyor. Katalog her zaman boştur (iki anahtar da bulunmalı: eski istemciler
 * `catalog.frames.find` gibi doğrudan okur); eski resim adresleri 404 döner. Kimlik doğrulamasızdır.
 */
export function registerCosmeticRoutes(app: FastifyInstance): void {
  app.get('/api/cosmetics', async (_req, reply) => {
    void reply.header('Cache-Control', 'public, max-age=300');
    return { decorations: [], frames: [] };
  });

  const gone = async (_req: FastifyRequest, reply: FastifyReply) => sendError(reply, 404, 'not_found', 'Bulunamadı.');
  app.get('/api/cosmetics/decorations/:file', gone);
  app.get('/api/cosmetics/frames/:file', gone);
}
