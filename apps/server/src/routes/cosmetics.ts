import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
  // Yeniden yayında yerini bırakan sürümün dosyaları da bir süre sunulur (bkz. CosmeticPackStore.fileOf):
  // bağlı istemciler bildirimi tazeleyene dek eski adresleri kullanır.
  //
  // Hata yanıtı (başlıklar ayarlandıktan sonra bir şey ters giderse; ör. dosya akışı ilk bayttan önce hata
  // verirse) dosyanın önbellek ve aralık başlıklarını taşımamalı: yoksa hata "süresiz" önbelleklenirdi.
  // Fastify'ın kendi hata işleyicisi yalnızca Content-Type/Length'i düşürür; akış gönderilirken başlıklar ham
  // yanıta da yazılmış olur, ikisinden de silinir. Hatanın iletisi (dosya yolu içerebilir) yanıta konmaz.
  const fileError = (err: unknown, req: FastifyRequest, reply: FastifyReply): FastifyReply => {
    req.log.error({ err }, 'kozmetik paketi dosyası sunulamadı');
    for (const header of ['Cache-Control', 'ETag', 'Content-Range', 'Accept-Ranges', 'Content-Length']) {
      reply.removeHeader(header);
      if (!reply.raw.headersSent) reply.raw.removeHeader(header);
    }
    return reply
      .code(500)
      .header('Content-Type', 'application/json; charset=utf-8')
      .send({ error: 'internal_error', message: 'Dosya sunulamadı.' });
  };

  app.get<PackFileRoute>('/api/cosmetics/packs/:id/:version/:name', { errorHandler: fileError }, async (req, reply) => {
    const { id, version, name } = req.params;
    // Önce dosya açılır; boyut açık dosyadan okunur. Açılamayan (yok, silinmiş, okunamıyor) her şey 404'tür:
    // önbellek başlıkları yalnızca başarıyla açılan dosyaya verilir, yanıtta dosya yolu hiç geçmez.
    const file = await cosmeticPacks.openFile(id, version, name);
    if (!file) return sendError(reply, 404, 'not_found', 'Dosya bulunamadı.');
    const { handle, size } = file;
    // Gövdesi dosyadan okunmayan yanıtlarda (304, 416, HEAD, hata) tutamaç burada kapanır; dosya akışı
    // gönderilirse akış bitince, koparsa ya da hata verirse kendisi kapatır (autoClose).
    const close = (): Promise<void> => handle.close().catch(() => undefined);
    try {
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
        .header('Content-Type', file.contentType);
      if (req.headers['if-none-match'] === etag) {
        await close();
        return reply.code(304).send();
      }

      // Parça parça okuma (video oynatıcıları ister; iOS'ta zorunlu). If-Range başka sürümü gösteriyorsa tüm
      // dosya gönderilir; dosyalar değişmediğinden ETag hep aynıdır.
      const ifRange = req.headers['if-range'];
      const range = ifRange === undefined || ifRange === etag ? parseRange(req.headers.range, size) : null;
      if (range?.kind === 'invalid') {
        await close();
        reply.removeHeader('Cache-Control');
        return reply
          .code(416)
          .header('Content-Range', `bytes */${size}`)
          .header('Content-Type', 'application/json; charset=utf-8')
          .send({ error: 'range_not_satisfiable', message: 'İstenen aralık dosyada yok.' });
      }
      const part = range?.kind === 'range' ? { start: range.start, end: range.end } : null;
      if (part) void reply.code(206).header('Content-Range', `bytes ${part.start}-${part.end}/${size}`);
      void reply.header('Content-Length', part ? part.end - part.start + 1 : size);
      // HEAD: yalnızca başlıklar; dosya okunmaz
      if (req.method === 'HEAD') {
        await close();
        return reply.send(Readable.from([]));
      }
      return reply.send(handle.createReadStream(part ?? {}));
    } catch (err) {
      await close();
      throw err;
    }
  });
}
