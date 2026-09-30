import fs from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { COSMETIC_KIND_CONTENT_TYPE } from '@diskort/shared';
import { sendError, type AppContext } from '../context.js';
import { parseRange } from '../fileInfo.js';

type PackFileRoute = { Params: { id: string; version: string; name: string } };

/** Bildirim kısa süre önbelleklenir: yeni paket birkaç dakika içinde herkese ulaşır (ETag ile gövde inmez) */
const MANIFEST_MAX_AGE_S = 60;

/**
 * Kozmetikler.
 *
 * Paketler (sunucudan dağıtılan hazır setler): bildirim ve dosyalar kimlik doğrulamasız sunulur (<img>,
 * <video> ve React Native <Image> jeton gönderemez; içerik herkese açıktır). Yükleme ucu yoktur: paketler
 * yalnızca sunucudaki komut satırı aracıyla yayınlanır (bkz. cosmetics-cli.ts).
 *
 * Eski kozmetik kataloğu (avatar dekorasyonları, profil çerçeveleri): kaldırıldı, yalnızca 0.8.x
 * istemciler için duruyor. Katalog her zaman boştur (iki anahtar da bulunmalı: eski istemciler
 * `catalog.frames.find` gibi doğrudan okur); eski resim adresleri 404 döner.
 */
export function registerCosmeticRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { cosmeticPacks } = ctx;

  app.get('/api/cosmetics', async (_req, reply) => {
    void reply.header('Cache-Control', 'public, max-age=300');
    return { decorations: [], frames: [] };
  });

  const gone = async (_req: FastifyRequest, reply: FastifyReply) => sendError(reply, 404, 'not_found', 'Bulunamadı.');
  app.get('/api/cosmetics/decorations/:file', gone);
  app.get('/api/cosmetics/frames/:file', gone);

  // Yayınlanmış paketlerin bildirimi, gösterim sırasıyla. ETag bildirimin sürümüdür (gövdedeki `version`).
  app.get('/api/cosmetics/packs', async (req, reply) => {
    const { json, etag } = cosmeticPacks.served();
    void reply.header('Cache-Control', `public, max-age=${MANIFEST_MAX_AGE_S}`).header('ETag', etag);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.header('Content-Type', 'application/json; charset=utf-8').send(json);
  });

  // Paket dosyası. Adres paketin sürümünü (içerik özeti) taşır: içerik hiç değişmez, süresiz önbelleklenir.
  app.get<PackFileRoute>('/api/cosmetics/packs/:id/:version/:name', async (req, reply) => {
    const { id, version, name } = req.params;
    // Yol yalnızca biçimi doğrulanmış ve bildirimde kayıtlı dosya için kurulur (bkz. CosmeticPackStore.fileOf)
    const found = cosmeticPacks.fileOf(id, version, name);
    const stat = found ? await fs.promises.stat(found.path).catch(() => null) : null;
    if (!found || !stat?.isFile()) return sendError(reply, 404, 'not_found', 'Dosya bulunamadı.');

    const etag = `"${version}-${name}"`;
    void reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('ETag', etag)
      .header('Accept-Ranges', 'bytes')
      .header('X-Content-Type-Options', 'nosniff')
      // Tarayıcıda doğrudan açılsa bile betik çalışamaz (resim ve video kendi sayfasında gösterilebilir)
      .header(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      )
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Content-Type', COSMETIC_KIND_CONTENT_TYPE[found.kind]);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();

    // Parça parça okuma (video oynatıcıları ister; iOS'ta zorunlu). If-Range başka sürümü gösteriyorsa tüm
    // dosya gönderilir; dosyalar değişmediğinden ETag hep aynıdır.
    const ifRange = req.headers['if-range'];
    const range = ifRange === undefined || ifRange === etag ? parseRange(req.headers.range, stat.size) : null;
    if (range?.kind === 'invalid') {
      return reply
        .code(416)
        .header('Content-Range', `bytes */${stat.size}`)
        .header('Content-Type', 'application/json; charset=utf-8')
        .send({ error: 'range_not_satisfiable', message: 'İstenen aralık dosyada yok.' });
    }
    if (range?.kind === 'range') {
      return reply
        .code(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`)
        .header('Content-Length', range.end - range.start + 1)
        .send(fs.createReadStream(found.path, { start: range.start, end: range.end }));
    }
    return reply.header('Content-Length', stat.size).send(fs.createReadStream(found.path));
  });
}
