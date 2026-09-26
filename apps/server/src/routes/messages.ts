import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MESSAGE_MAX_LENGTH, MESSAGE_PAGE_SIZE, type Channel } from '@diskort/shared';
import { parseBody, sendError, type AppContext } from '../context.js';

// Kontrol karakterlerini (satır sonu ve sekme hariç) temizler.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const content = z
  .string()
  .transform((s) => s.replace(CONTROL_CHARS, '').trim())
  .pipe(
    z
      .string()
      .min(1, 'Mesaj boş olamaz.')
      .max(MESSAGE_MAX_LENGTH, `Mesaj en fazla ${MESSAGE_MAX_LENGTH} karakter olabilir.`),
  );

const messageSchema = z.object({ content });
const ackSchema = z.object({ messageId: z.string().regex(/^\d+$/) });
const listQuery = z.object({
  before: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Kullanıcı başına mesaj sınırı: 10 saniyede en fazla 10 mesaj. */
function createMessageLimiter(max = 10, windowMs = 10_000) {
  const hits = new Map<string, number[]>();
  return (userId: string): boolean => {
    const now = Date.now();
    const recent = (hits.get(userId) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(userId, recent);
      return false;
    }
    recent.push(now);
    hits.set(userId, recent);
    return true;
  };
}

export function registerMessageRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, gateway } = ctx;
  const allowMessage = createMessageLimiter();

  const textChannel = (id: string, reply: FastifyReply): Channel | null => {
    const channel = store.getChannel(id);
    if (!channel || channel.type !== 'text') {
      void sendError(reply, 404, 'not_found', 'Metin kanalı bulunamadı.');
      return null;
    }
    return channel;
  };

  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/channels/:id/messages',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      if (!textChannel(req.params.id, reply)) return reply;
      const query = listQuery.safeParse(req.query);
      if (!query.success) return sendError(reply, 400, 'invalid_query', 'Geçersiz sorgu.');
      const before = query.data.before ? Number(query.data.before) : null;
      return store.listMessages(req.params.id, before, query.data.limit ?? MESSAGE_PAGE_SIZE);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/channels/:id/messages',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      if (!textChannel(req.params.id, reply)) return reply;
      if (!allowMessage(req.user.id)) {
        return sendError(reply, 429, 'rate_limited', 'Çok hızlı mesaj gönderiyorsun, biraz yavaşla.');
      }
      const body = parseBody(messageSchema, req.body, reply);
      if (!body) return reply;
      const message = store.createMessage(req.params.id, req.user.id, body.content);
      // Yazar kendi mesajını okumuş sayılır.
      store.ack(req.user.id, req.params.id, Number(message.id));
      gateway.broadcast({ t: 'MESSAGE_CREATE', d: message });
      return reply.code(201).send(message);
    },
  );

  app.patch<{ Params: { id: string } }>('/api/messages/:id', { preHandler: auth.requireUser }, async (req, reply) => {
    const existing = /^\d+$/.test(req.params.id) ? store.getMessage(Number(req.params.id)) : null;
    if (!existing) return sendError(reply, 404, 'not_found', 'Mesaj bulunamadı.');
    if (existing.authorId !== req.user.id) {
      return sendError(reply, 403, 'forbidden', 'Yalnızca kendi mesajını düzenleyebilirsin.');
    }
    const body = parseBody(messageSchema, req.body, reply);
    if (!body) return reply;
    if (body.content === existing.content) return existing;
    const message = store.updateMessage(Number(existing.id), body.content)!;
    gateway.broadcast({ t: 'MESSAGE_UPDATE', d: message });
    return message;
  });

  app.delete<{ Params: { id: string } }>('/api/messages/:id', { preHandler: auth.requireUser }, async (req, reply) => {
    const existing = /^\d+$/.test(req.params.id) ? store.getMessage(Number(req.params.id)) : null;
    if (!existing) return sendError(reply, 404, 'not_found', 'Mesaj bulunamadı.');
    if (existing.authorId !== req.user.id && !req.user.isAdmin) {
      return sendError(reply, 403, 'forbidden', 'Bu mesajı silemezsin.');
    }
    store.deleteMessage(Number(existing.id));
    gateway.broadcast({ t: 'MESSAGE_DELETE', d: { id: existing.id, channelId: existing.channelId } });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>(
    '/api/channels/:id/ack',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      if (!textChannel(req.params.id, reply)) return reply;
      const body = parseBody(ackSchema, req.body, reply);
      if (!body) return reply;
      store.ack(req.user.id, req.params.id, Number(body.messageId));
      return reply.code(204).send();
    },
  );
}
