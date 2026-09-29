import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CLIENT_ERROR_STACK_MAX, NATIVE_CRASH_STACK_MAX, NATIVE_CRASH_WHERE } from '@diskort/shared';
import { parseBody, sendError, type AppContext } from '../context.js';
import { createRateLimiter } from './messages.js';

const clientErrorSchema = z
  .object({
    platform: z.enum(['desktop', 'android', 'ios']),
    version: z.string().max(32),
    where: z.string().max(64),
    message: z.string().max(500),
    stack: z.string().max(NATIVE_CRASH_STACK_MAX).optional(),
  })
  // Yığın yalnızca telefonun yerel çökmelerinde uzun olabilir
  .refine(
    (b) => (b.stack?.length ?? 0) <= (b.where === NATIVE_CRASH_WHERE ? NATIVE_CRASH_STACK_MAX : CLIENT_ERROR_STACK_MAX),
    { message: 'Yığın çok uzun.', path: ['stack'] },
  );

/**
 * Beklenen, zararsız gürültü: eski istemcilerden gelenler de kaydedilmez (yeniler zaten göndermez).
 * - DUPLICATE_IDENTITY: kullanıcı aynı ses kanalına başka cihazdan girdi
 * - createOffer uyarısı: bağlantı kapandıktan sonraki LiveKit yan gürültüsü
 * - unpublish uyarısı: ekran paylaşımı kendiliğinden bitince çift yayın kaldırma
 */
const IGNORED_MESSAGES = [
  'ses bağlantısı kapandı: DUPLICATE_IDENTITY',
  'could not createOffer with closed peer connection',
  'track was not unpublished because no publication was found',
];

/**
 * İstemcilerin beklenmedik hataları (özellikle telefonda hata ayıklama aracı yok). Veritabanına yazılmaz:
 * sunucu kayıtlarına düşer (`docker compose logs api | grep "istemci hatası"`) ve son 200'ü bellekte
 * yönetim panelinde görünür. Giriş yapmadan önceki hatalar da gelebilsin diye oturum zorunlu değildir;
 * adres başına sınırlıdır.
 */
export function registerClientErrorRoutes(app: FastifyInstance, ctx: AppContext): void {
  const allow = createRateLimiter(20, 60_000);

  app.post('/api/client-errors', async (req, reply) => {
    if (!allow(req.ip)) return sendError(reply, 429, 'rate_limited', 'Çok fazla hata bildirimi.');
    const body = parseBody(clientErrorSchema, req.body, reply);
    if (!body) return reply;
    if (IGNORED_MESSAGES.some((m) => body.message.includes(m))) return reply.code(204).send();
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const user = token ? await ctx.auth.userFromToken(token).catch(() => null) : null;
    req.log.warn({ clientError: { ...body, user: user?.username ?? null } }, 'istemci hatası');
    ctx.errors.client.push({ at: Date.now(), ...body, user: user?.username ?? null });
    return reply.code(204).send();
  });
}
