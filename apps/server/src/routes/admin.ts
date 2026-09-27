import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CHANNEL_NAME_MAX_LENGTH } from '@diskort/shared';
import { removeAccount } from '../accounts.js';
import { parseBody, sendError, type AppContext } from '../context.js';

const createInviteSchema = z.object({
  maxUses: z.number().int().min(1).max(1000).nullable().optional(),
  expiresInHours: z.number().min(1).max(24 * 365).nullable().optional(),
});

const channelName = z
  .string()
  .trim()
  .min(1, 'Kanal adı boş olamaz.')
  .max(CHANNEL_NAME_MAX_LENGTH, `Kanal adı en fazla ${CHANNEL_NAME_MAX_LENGTH} karakter olabilir.`);

const createChannelSchema = z.object({
  name: channelName,
  type: z.enum(['voice', 'text']),
});

const updateUserSchema = z.object({
  isAdmin: z.boolean().optional(),
});

const RESET_CODE_TTL_MS = 24 * 3_600_000;

const updateChannelSchema = z.object({
  name: channelName.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, gateway, voice, livekit, guild, attachments } = ctx;

  // ---------- Davetler ----------

  app.get('/api/invites', { preHandler: auth.requireAdmin }, async () => store.listInvites());

  app.post('/api/invites', { preHandler: auth.requireAdmin }, async (req, reply) => {
    const body = parseBody(createInviteSchema, req.body, reply);
    if (!body) return reply;
    const invite = store.createInvite({
      createdBy: req.user.id,
      maxUses: body.maxUses ?? null,
      expiresAt: body.expiresInHours ? Date.now() + body.expiresInHours * 3_600_000 : null,
    });
    return reply.code(201).send(invite);
  });

  app.delete<{ Params: { code: string } }>(
    '/api/invites/:code',
    { preHandler: auth.requireAdmin },
    async (req, reply) => {
      if (!store.deleteInvite(req.params.code)) return sendError(reply, 404, 'not_found', 'Davet bulunamadı.');
      return reply.code(204).send();
    },
  );

  // ---------- Üyeler ----------

  // Şifresini unutan üye için tek kullanımlık, 24 saat geçerli sıfırlama kodu
  app.post<{ Params: { id: string } }>(
    '/api/users/:id/reset-code',
    { preHandler: auth.requireAdmin },
    async (req, reply) => {
      if (!store.getUser(req.params.id)) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
      return store.createResetCode(req.params.id, req.user.id, RESET_CODE_TTL_MS);
    },
  );

  app.patch<{ Params: { id: string } }>('/api/users/:id', { preHandler: auth.requireAdmin }, async (req, reply) => {
    const body = parseBody(updateUserSchema, req.body, reply);
    if (!body) return reply;
    const target = store.getUser(req.params.id);
    if (!target) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
    if (body.isAdmin === false && target.id === req.user.id) {
      return sendError(reply, 400, 'self_demote', 'Kendi yöneticiliğini kaldıramazsın.');
    }
    const user = body.isAdmin === undefined ? target : store.setAdmin(target.id, body.isAdmin)!;
    gateway.broadcast({ t: 'USER_UPDATE', d: user });
    return user;
  });

  app.post<{ Params: { id: string } }>(
    '/api/users/:id/voice-kick',
    { preHandler: auth.requireAdmin },
    async (req, reply) => {
      const state = voice.get(req.params.id);
      if (!state) return sendError(reply, 404, 'not_in_voice', 'Kullanıcı bir ses kanalında değil.');
      await livekit.removeParticipant(state.channelId, req.params.id);
      voice.leave(req.params.id, state.channelId);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>('/api/users/:id', { preHandler: auth.requireAdmin }, async (req, reply) => {
    const id = req.params.id;
    if (id === req.user.id) return sendError(reply, 400, 'self_delete', 'Kendi hesabını buradan silemezsin.');
    if (!(await removeAccount(ctx, id, 'Hesabın bir yönetici tarafından silindi.'))) {
      return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
    }
    return reply.code(204).send();
  });

  // ---------- Kanallar ----------

  app.get('/api/channels', { preHandler: auth.requireUser }, async () => store.listChannels(guild.id));

  app.post('/api/channels', { preHandler: auth.requireAdmin }, async (req, reply) => {
    const body = parseBody(createChannelSchema, req.body, reply);
    if (!body) return reply;
    const channel = store.createChannel(guild.id, body.name, body.type);
    gateway.broadcast({ t: 'CHANNEL_CREATE', d: channel });
    return reply.code(201).send(channel);
  });

  app.patch<{ Params: { id: string } }>(
    '/api/channels/:id',
    { preHandler: auth.requireAdmin },
    async (req, reply) => {
      const body = parseBody(updateChannelSchema, req.body, reply);
      if (!body) return reply;
      const channel = store.updateChannel(req.params.id, body);
      if (!channel) return sendError(reply, 404, 'not_found', 'Kanal bulunamadı.');
      gateway.broadcast({ t: 'CHANNEL_UPDATE', d: channel });
      return channel;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/channels/:id',
    { preHandler: auth.requireAdmin },
    async (req, reply) => {
      const id = req.params.id;
      const files = store.channelAttachmentIds(id);
      if (!store.deleteChannel(id)) return sendError(reply, 404, 'not_found', 'Kanal bulunamadı.');
      await attachments.remove(files);
      voice.leaveChannel(id);
      await livekit.closeChannelRoom(id);
      gateway.broadcast({ t: 'CHANNEL_DELETE', d: { id } });
      return reply.code(204).send();
    },
  );
}
