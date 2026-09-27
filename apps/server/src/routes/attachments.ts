import fs from 'node:fs';
import type { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { isImageAttachment, isVideoAttachment, Permission } from '@diskort/shared';
import { ATTACHMENT_ID, UploadError } from '../attachments.js';
import { forbidden, sendError, type AppContext } from '../context.js';
import { contentDisposition, parseRange, servedType } from '../fileInfo.js';
import { createRateLimiter } from './messages.js';

/**
 * Dosya ekleri. Yükleme iki adımlıdır (Discord gibi): önce dosya kanala yüklenir, dönen kimlikler
 * mesaj oluşturulurken verilir. Dosyalar, <img> ve React Native <Image> jeton gönderemediği için
 * kimlik doğrulamasız ama tahmin edilemeyen (128 bit) adreslerden sunulur.
 */
export function registerAttachmentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, attachments, permissions } = ctx;
  const allowUpload = createRateLimiter(60, 60_000);

  // Yükleme gövdesi ham dosyadır: ayrıştırılmadan diske akıtılır. Genel 64 KB gövde sınırı bu kapsamda
  // geçerli değildir; sınırı AttachmentService uygular (ATTACHMENT_MAX_MB).
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

    scope.post<{ Params: { id: string }; Querystring: { name?: string } }>(
      '/api/channels/:id/attachments',
      {
        onRequest: auth.requireUser,
        // Hata yanıtında okunmamış gövde boşuna okunmasın: bağlantı yanıttan sonra kapanır
        onSend: async (_req, reply, payload) => {
          if (reply.statusCode !== 201) void reply.header('Connection', 'close');
          return payload;
        },
      },
      async (req, reply) => {
        // Metin kanalı ya da katılımcısı olunan direkt mesaj konuşması
        const dm = permissions.isDm(req.params.id);
        const channel = dm ? null : store.getChannel(req.params.id);
        if (
          dm
            ? !permissions.canView(req.user.id, req.params.id)
            : !channel || channel.type !== 'text' || !permissions.canView(req.user.id, channel)
        ) {
          return sendError(reply, 404, 'not_found', 'Metin kanalı bulunamadı.');
        }
        if (!permissions.can(req.user.id, Permission.SEND_MESSAGES | Permission.ATTACH_FILES, channel ?? req.params.id)) {
          return forbidden(reply, dm ? 'Bu konuşmaya dosya gönderemezsin.' : 'Bu kanala dosya gönderme iznin yok.');
        }
        if (!allowUpload(req.user.id)) {
          return sendError(reply, 429, 'rate_limited', 'Çok hızlı dosya yüklüyorsun, biraz bekle.');
        }
        const length = req.headers['content-length'];
        try {
          const attachment = await attachments.upload({
            body: (req.body as Readable | undefined) ?? req.raw,
            declaredSize: length !== undefined && /^\d+$/.test(length) ? Number(length) : null,
            name: typeof req.query.name === 'string' ? req.query.name : '',
            contentType: req.headers['content-type'],
            channelId: req.params.id,
            uploaderId: req.user.id,
          });
          return reply.code(201).send(attachment);
        } catch (err) {
          if (err instanceof UploadError) return sendError(reply, err.status, err.code, err.message);
          throw err;
        }
      },
    );
  });

  // Yetenek adresi: kimlik yeterlidir, sondaki ad yalnızca indirilen dosyanın adı içindir (joker: uzun,
  // kodlanmış adlar yol parametresi uzunluk sınırına takılmasın).
  app.get<{ Params: { id: string } }>('/api/attachments/:id/*', async (req, reply) => {
    const { id } = req.params;
    const found = ATTACHMENT_ID.test(id) ? store.getAttachment(id) : null;
    // Henüz bir mesaja eklenmemiş dosyalar sunulmaz
    if (!found || found.messageId === null) return sendError(reply, 404, 'not_found', 'Dosya bulunamadı.');
    const file = attachments.pathOf(id);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat) return sendError(reply, 404, 'not_found', 'Dosya bulunamadı.');

    const { attachment } = found;
    // Yalnızca türü içerikten belirlenmiş resim ve videolar tarayıcıda gösterilir; gerisi indirilir
    const inline = isImageAttachment(attachment) || isVideoAttachment(attachment);
    const etag = `"${id}"`;
    void reply
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('ETag', etag)
      .header('Accept-Ranges', 'bytes')
      .header('X-Content-Type-Options', 'nosniff')
      // Tarayıcıda doğrudan açılsa bile betik çalışamaz (resim ve video kendi sayfasında gösterilebilir)
      .header(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      )
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Content-Type', servedType(attachment.contentType, inline))
      .header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', attachment.name));
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();

    // Parça parça okuma (video oynatıcıları ileri sarmak için ister). If-Range başka sürümü
    // gösteriyorsa tüm dosya gönderilir; dosyalar değişmediğinden ETag hep aynıdır.
    const ifRange = req.headers['if-range'];
    const range = ifRange === undefined || ifRange === etag ? parseRange(req.headers.range, stat.size) : null;
    if (range?.kind === 'invalid') {
      reply.removeHeader('Content-Disposition');
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
        .send(fs.createReadStream(file, { start: range.start, end: range.end }));
    }
    return reply.header('Content-Length', stat.size).send(fs.createReadStream(file));
  });
}
