import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CHANNEL_NAME_MAX_LENGTH } from '@diskort/shared';
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

const updateChannelSchema = z.object({
  name: channelName.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, gateway, voice, livekit, guild } = ctx;

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
      if (!store.deleteChannel(id)) return sendError(reply, 404, 'not_found', 'Kanal bulunamadı.');
      voice.leaveChannel(id);
      await livekit.closeChannelRoom(id);
      gateway.broadcast({ t: 'CHANNEL_DELETE', d: { id } });
      return reply.code(204).send();
    },
  );
}
