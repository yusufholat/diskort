import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CHANNEL_NAME_MAX_LENGTH,
  hasPermission,
  Permission,
  TEXT_CHANNEL_PERMISSIONS,
  VOICE_CHANNEL_PERMISSIONS,
  type PermissionOverwrite,
} from '@diskort/shared';
import { removeAccount } from '../accounts.js';
import { afterPermissionChange, forbidden, parseBody, sendError, type AppContext } from '../context.js';
import { canAssignRole, setMemberRole } from './roles.js';

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

const overwriteSchema = z.object({
  roleId: z.string().min(1).max(64),
  allow: z.number().int().min(0),
  deny: z.number().int().min(0),
});

const updateChannelSchema = z.object({
  name: channelName.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  overwrites: z.array(overwriteSchema).max(100).optional(),
});

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, gateway, guild, attachments, permissions, moderation } = ctx;
  const manageInvites = auth.requirePermission(Permission.MANAGE_INVITES);

  // ---------- Davetler ----------

  app.get('/api/invites', { preHandler: manageInvites }, async () => store.listInvites());

  app.post('/api/invites', { preHandler: manageInvites }, async (req, reply) => {
    const body = parseBody(createInviteSchema, req.body, reply);
    if (!body) return reply;
    const invite = store.createInvite({
      createdBy: req.user.id,
      maxUses: body.maxUses ?? null,
      expiresAt: body.expiresInHours ? Date.now() + body.expiresInHours * 3_600_000 : null,
    });
    return reply.code(201).send(invite);
  });

  app.delete<{ Params: { code: string } }>('/api/invites/:code', { preHandler: manageInvites }, async (req, reply) => {
    if (!store.deleteInvite(req.params.code)) return sendError(reply, 404, 'not_found', 'Davet bulunamadı.');
    return reply.code(204).send();
  });

  // ---------- Üyeler ----------

  // Şifresini unutan üye için tek kullanımlık, 24 saat geçerli sıfırlama kodu. Kodu alan hesabı ele
  // geçirebileceğinden yalnızca yöneticiler, kendilerinden aşağıdaki üyeler için üretebilir.
  app.post<{ Params: { id: string } }>(
    '/api/users/:id/reset-code',
    { preHandler: auth.requireAdmin },
    async (req, reply) => {
      const target = store.getUser(req.params.id);
      if (!target || target.removed) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
      if (target.id !== req.user.id && !permissions.outranks(req.user.id, target.id)) {
        return forbidden(reply, 'Rolü seninkinden yukarıda olan birinin şifresini sıfırlayamazsın.');
      }
      return store.createResetCode(target.id, req.user.id, RESET_CODE_TTL_MS);
    },
  );

  // Rollerden önceki istemciler için: "Yönetici yap / yöneticiliği kaldır" yönetici rolünü verir/alır.
  app.patch<{ Params: { id: string } }>(
    '/api/users/:id',
    { preHandler: auth.requirePermission(Permission.MANAGE_ROLES) },
    async (req, reply) => {
      const body = parseBody(updateUserSchema, req.body, reply);
      if (!body) return reply;
      const target = store.getUser(req.params.id);
      if (!target || target.removed) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
      if (body.isAdmin === undefined || body.isAdmin === target.isAdmin) return target;
      if (target.id === req.user.id) {
        return sendError(reply, 400, 'self_demote', 'Kendi yöneticiliğini kaldıramazsın.');
      }
      const adminRoles = Object.values(store.permissionData().roles)
        .filter((r) => r.id !== guild.id && hasPermission(r.permissions, Permission.ADMINISTRATOR))
        .sort((a, b) => b.position - a.position);
      const assignable = adminRoles.filter((r) => canAssignRole(ctx, req.user.id, target.id, r) === null);
      if (body.isAdmin) {
        const role = assignable[0];
        if (!role) return forbidden(reply, 'Verebileceğin bir yönetici rolü yok.');
        await setMemberRole(ctx, target.id, role.id, true);
      } else {
        const held = adminRoles.filter((r) => target.roles.includes(r.id));
        if (held.length === 0 || held.some((r) => !assignable.includes(r))) {
          return forbidden(reply, 'Bu üyenin yöneticiliğini kaldıramazsın.');
        }
        for (const role of held) await setMemberRole(ctx, target.id, role.id, false);
      }
      return store.getUser(target.id);
    },
  );

  // Rollerden önceki istemciler için "Sesten At" (yenileri PATCH /api/users/:id/voice kullanır)
  app.post<{ Params: { id: string } }>(
    '/api/users/:id/voice-kick',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      const state = ctx.voice.get(req.params.id);
      if (!state) return sendError(reply, 404, 'not_in_voice', 'Kullanıcı bir ses kanalında değil.');
      if (!permissions.can(req.user.id, Permission.MOVE_MEMBERS, state.channelId)) return forbidden(reply);
      if (req.params.id !== req.user.id && !permissions.outranks(req.user.id, req.params.id)) {
        return forbidden(reply, 'Rolü seninkinden yukarıda olan birini sesten çıkaramazsın.');
      }
      await moderation.disconnect(req.params.id);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>('/api/users/:id', { preHandler: auth.requireAdmin }, async (req, reply) => {
    const id = req.params.id;
    if (id === req.user.id) return sendError(reply, 400, 'self_delete', 'Kendi hesabını buradan silemezsin.');
    if (!store.getUser(id)) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
    if (!permissions.outranks(req.user.id, id)) {
      return forbidden(reply, 'Rolü seninkinden yukarıda olan birinin hesabını silemezsin.');
    }
    await removeAccount(ctx, id, 'Hesabın bir yönetici tarafından silindi.');
    return reply.code(204).send();
  });

  // ---------- Kanallar ----------

  app.get('/api/channels', { preHandler: auth.requireUser }, async (req) => permissions.visibleChannels(req.user.id));

  app.post('/api/channels', { preHandler: auth.requirePermission(Permission.MANAGE_CHANNELS) }, async (req, reply) => {
    const body = parseBody(createChannelSchema, req.body, reply);
    if (!body) return reply;
    const channel = store.createChannel(guild.id, body.name, body.type);
    gateway.dispatchChannel(channel.id, { t: 'CHANNEL_CREATE', d: channel });
    return reply.code(201).send(channel);
  });

  app.patch<{ Params: { id: string } }>('/api/channels/:id', { preHandler: auth.requireUser }, async (req, reply) => {
    const body = parseBody(updateChannelSchema, req.body, reply);
    if (!body) return reply;
    const channel = store.getChannel(req.params.id);
    if (!channel || !permissions.canView(req.user.id, channel)) {
      return sendError(reply, 404, 'not_found', 'Kanal bulunamadı.');
    }
    const actorPerms = permissions.inChannel(req.user.id, channel);
    if ((body.name !== undefined || body.position !== undefined) && !hasPermission(actorPerms, Permission.MANAGE_CHANNELS)) {
      return forbidden(reply, 'Kanalları düzenleme yetkin yok.');
    }

    let overwrites: PermissionOverwrite[] | null = null;
    if (body.overwrites) {
      if (!hasPermission(actorPerms, Permission.MANAGE_ROLES)) return forbidden(reply, 'Kanal izinlerini düzenleme yetkin yok.');
      const allowed = channel.type === 'text' ? TEXT_CHANNEL_PERMISSIONS : VOICE_CHANNEL_PERMISSIONS;
      const roles = store.permissionData().roles;
      const next = new Map<string, PermissionOverwrite>();
      for (const o of body.overwrites) {
        if (!roles[o.roleId]) return sendError(reply, 400, 'invalid_role', 'Rol bulunamadı.');
        if (o.allow & o.deny) return sendError(reply, 400, 'invalid_body', 'Bir yetki aynı anda hem verilip hem engellenemez.');
        next.set(o.roleId, { roleId: o.roleId, allow: o.allow & allowed, deny: o.deny & allowed });
      }
      const isAdmin = permissions.can(req.user.id, Permission.ADMINISTRATOR);
      const current = new Map(channel.overwrites.map((o) => [o.roleId, o]));
      for (const roleId of new Set([...current.keys(), ...next.keys()])) {
        const a = current.get(roleId) ?? { allow: 0, deny: 0 };
        const b = next.get(roleId) ?? { allow: 0, deny: 0 };
        const changed = (a.allow ^ b.allow) | (a.deny ^ b.deny);
        if (changed === 0) continue;
        // Hiyerarşi: yalnızca kendi en üst rolünün altındaki rollerin (ve @everyone'ın) izinleri
        if (!permissions.roleIsBelow(req.user.id, roles[roleId]!)) {
          return forbidden(reply, `"${roles[roleId]!.name}" rolünün kanal izinlerini değiştiremezsin.`);
        }
        // Kendinde olmayan bir yetkiyi veremez/engelleyemez
        if (!isAdmin && (changed & ~actorPerms) !== 0) {
          return forbidden(reply, 'Kendinde olmayan bir yetkiyi verip engelleyemezsin.');
        }
      }
      overwrites = [...next.values()];
    }

    const before = gateway.visibility();
    if (body.name !== undefined || body.position !== undefined) {
      store.updateChannel(channel.id, { name: body.name, position: body.position });
    }
    if (overwrites) {
      store.setChannelOverwrites(channel.id, overwrites);
      await afterPermissionChange(ctx, before, [channel.id]);
    } else {
      gateway.dispatchChannel(channel.id, { t: 'CHANNEL_UPDATE', d: store.getChannel(channel.id)! });
    }
    return store.getChannel(channel.id);
  });

  app.delete<{ Params: { id: string } }>('/api/channels/:id', { preHandler: auth.requireUser }, async (req, reply) => {
    const id = req.params.id;
    const channel = store.getChannel(id);
    if (!channel || !permissions.canView(req.user.id, channel)) {
      return sendError(reply, 404, 'not_found', 'Kanal bulunamadı.');
    }
    if (!permissions.can(req.user.id, Permission.MANAGE_CHANNELS, channel)) return forbidden(reply, 'Kanalları silme yetkin yok.');
    // Silinmeden önce kanalı görebilenler haber alır (ses durumlarının silinmesi de)
    const viewers = permissions.viewersOf(channel, gateway.connectedUserIds());
    ctx.voice.leaveChannel(id);
    const files = store.channelAttachmentIds(id);
    store.deleteChannel(id);
    await attachments.remove(files);
    await ctx.livekit.closeChannelRoom(id);
    gateway.sendToUsers(viewers, { t: 'CHANNEL_DELETE', d: { id } });
    return reply.code(204).send();
  });
}
