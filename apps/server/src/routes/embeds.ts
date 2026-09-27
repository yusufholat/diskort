import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { sendError, type AppContext } from '../context.js';

/**
 * Bağlantı önizlemelerinin resimleri: /api/embed-media/<imza>/<adres (base64url)>. Kimlik doğrulaması
 * istemez (<img> jeton gönderemez) ama yalnızca sunucunun imzaladığı adresler çalışır; resim sunucumuzdan
 * yeniden kodlanmış olarak gelir, kullanıcının IP'si asıl siteye gitmez.
 */
export function registerEmbedRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { embedMedia } = ctx;

  // Joker: uzun adresler yol parametresi uzunluk sınırına takılmasın
  app.get<{ Params: { sig: string; '*': string } }>('/api/embed-media/:sig/*', async (req, reply) => {
    const url = embedMedia.verify(req.params.sig, req.params['*']);
    if (!url) return sendError(reply, 404, 'not_found', 'Resim bulunamadı.');
    const file = await embedMedia.get(url);
    const stat = file ? await fs.promises.stat(file.path).catch(() => null) : null;
    if (!file || !stat) return sendError(reply, 404, 'not_found', 'Resim bulunamadı.');
    const etag = `"${file.key}"`;
    void reply
      .header('Cache-Control', 'public, max-age=604800')
      .header('ETag', etag)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Referrer-Policy', 'no-referrer')
      .header('Content-Type', file.contentType);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.header('Content-Length', stat.size).send(fs.createReadStream(file.path));
  });
}
