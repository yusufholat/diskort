import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  MESSAGE_MAX_ATTACHMENTS,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MAX_REACTIONS,
  MESSAGE_PAGE_SIZE,
  type Channel,
  type Message,
  type MessageUpdate,
} from '@diskort/shared';
import { ATTACHMENT_ID } from '../attachments.js';
import { parseBody, sendError, type AppContext } from '../context.js';
import { normalizeEmoji } from '../emoji.js';

// Kontrol karakterlerini (satır sonu ve sekme hariç) temizler.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// Boş metin ancak mesajda dosya varsa kabul edilir (aşağıda denetlenir)
const content = z
  .string()
  .transform((s) => s.replace(CONTROL_CHARS, '').trim())
  .pipe(z.string().max(MESSAGE_MAX_LENGTH, `Mesaj en fazla ${MESSAGE_MAX_LENGTH} karakter olabilir.`));

const EMPTY_MESSAGE = 'Mesaj boş olamaz.';

const createSchema = z
  .object({
    content: content.optional(),
    attachmentIds: z
      .array(z.string().regex(ATTACHMENT_ID, 'Geçersiz dosya.'))
      .max(MESSAGE_MAX_ATTACHMENTS, `Bir mesaja en fazla ${MESSAGE_MAX_ATTACHMENTS} dosya eklenebilir.`)
      .refine((ids) => new Set(ids).size === ids.length, 'Aynı dosya iki kez eklenemez.')
      .optional(),
  })
  .refine((b) => Boolean(b.content) || Boolean(b.attachmentIds?.length), EMPTY_MESSAGE);
const editSchema = z.object({ content });
const ackSchema = z.object({ messageId: z.string().regex(/^\d+$/) });
const listQuery = z.object({
  before: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Gateway'e giden güncelleme: tepkilerin `me` alanı kişiye özel olduğundan çıkarılır. */
const toUpdate = ({ reactions: _reactions, ...message }: Message): MessageUpdate => message;

/** Kullanıcı başına istek sınırı (varsayılan: 10 saniyede en fazla 10). */
export function createRateLimiter(max = 10, windowMs = 10_000) {
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
  const { store, auth, gateway, push, attachments } = ctx;
  const allowMessage = createRateLimiter();
  const allowReaction = createRateLimiter(30);

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
      return store.listMessages(req.params.id, before, query.data.limit ?? MESSAGE_PAGE_SIZE, req.user.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/channels/:id/messages',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      const channel = textChannel(req.params.id, reply);
      if (!channel) return reply;
      if (!allowMessage(req.user.id)) {
        return sendError(reply, 429, 'rate_limited', 'Çok hızlı mesaj gönderiyorsun, biraz yavaşla.');
      }
      const body = parseBody(createSchema, req.body, reply);
      if (!body) return reply;
      const message = store.createMessage(req.params.id, req.user.id, body.content ?? '', body.attachmentIds);
      if (!message) {
        return sendError(reply, 400, 'invalid_attachment', 'Dosya bulunamadı ya da süresi doldu; yeniden eklemeyi dene.');
      }
      // Yazar kendi mesajını okumuş sayılır.
      store.ack(req.user.id, req.params.id, Number(message.id));
      gateway.broadcast({ t: 'MESSAGE_CREATE', d: message });
      // Telefonlara bildirim yanıtı bekletmez
      void push.notifyMention(message, store.resolveMentions(message.content, req.user.id), channel.name);
      return reply.code(201).send(message);
    },
  );

  app.patch<{ Params: { id: string } }>('/api/messages/:id', { preHandler: auth.requireUser }, async (req, reply) => {
    const existing = /^\d+$/.test(req.params.id) ? store.getMessage(Number(req.params.id)) : null;
    if (!existing) return sendError(reply, 404, 'not_found', 'Mesaj bulunamadı.');
    if (existing.authorId !== req.user.id) {
      return sendError(reply, 403, 'forbidden', 'Yalnızca kendi mesajını düzenleyebilirsin.');
    }
    const body = parseBody(editSchema, req.body, reply);
    if (!body) return reply;
    if (!body.content && existing.attachments.length === 0) return sendError(reply, 400, 'invalid_body', EMPTY_MESSAGE);
    if (body.content === existing.content) return store.getMessage(Number(existing.id), req.user.id);
    const message = store.updateMessage(Number(existing.id), body.content, req.user.id)!;
    gateway.broadcast({ t: 'MESSAGE_UPDATE', d: toUpdate(message) });
    return message;
  });

  app.delete<{ Params: { id: string } }>('/api/messages/:id', { preHandler: auth.requireUser }, async (req, reply) => {
    const existing = /^\d+$/.test(req.params.id) ? store.getMessage(Number(req.params.id)) : null;
    if (!existing) return sendError(reply, 404, 'not_found', 'Mesaj bulunamadı.');
    if (existing.authorId !== req.user.id && !req.user.isAdmin) {
      return sendError(reply, 403, 'forbidden', 'Bu mesajı silemezsin.');
    }
    const files = store.deleteMessage(Number(existing.id));
    await attachments.remove(files);
    gateway.broadcast({ t: 'MESSAGE_DELETE', d: { id: existing.id, channelId: existing.channelId } });
    return reply.code(204).send();
  });

  // ---------- Tepkiler ----------
  // Kullanıcı yalnızca kendi tepkisini ekler/kaldırır. İkisi de tekrarlanabilir (aynı istek ikinci
  // kez bir şey değiştirmez); yalnızca gerçek değişiklik tüm istemcilere duyurulur.

  const reactionTarget = (
    params: { id: string; emoji: string },
    userId: string,
    reply: FastifyReply,
  ): { messageId: number; channelId: string; emoji: string } | null => {
    const message = /^\d+$/.test(params.id) ? store.getMessage(Number(params.id)) : null;
    if (!message) {
      void sendError(reply, 404, 'not_found', 'Mesaj bulunamadı.');
      return null;
    }
    const emoji = normalizeEmoji(params.emoji);
    if (!emoji) {
      void sendError(reply, 400, 'invalid_emoji', 'Tepki olarak yalnızca tek bir emoji kullanılabilir.');
      return null;
    }
    if (!allowReaction(userId)) {
      void sendError(reply, 429, 'rate_limited', 'Çok hızlı tepki veriyorsun, biraz yavaşla.');
      return null;
    }
    return { messageId: Number(message.id), channelId: message.channelId, emoji };
  };

  app.put<{ Params: { id: string; emoji: string } }>(
    '/api/messages/:id/reactions/:emoji',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      const target = reactionTarget(req.params, req.user.id, reply);
      if (!target) return reply;
      const result = store.addReaction(target.messageId, req.user.id, target.emoji);
      if (result === 'limit') {
        return sendError(
          reply,
          400,
          'too_many_reactions',
          `Bir mesaja en fazla ${MESSAGE_MAX_REACTIONS} farklı tepki verilebilir.`,
        );
      }
      if (result === 'added') {
        gateway.broadcast({
          t: 'MESSAGE_REACTION_ADD',
          d: { messageId: String(target.messageId), channelId: target.channelId, userId: req.user.id, emoji: target.emoji },
        });
      }
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string; emoji: string } }>(
    '/api/messages/:id/reactions/:emoji',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      const target = reactionTarget(req.params, req.user.id, reply);
      if (!target) return reply;
      if (store.removeReaction(target.messageId, req.user.id, target.emoji)) {
        gateway.broadcast({
          t: 'MESSAGE_REACTION_REMOVE',
          d: { messageId: String(target.messageId), channelId: target.channelId, userId: req.user.id, emoji: target.emoji },
        });
      }
      return reply.code(204).send();
    },
  );

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
