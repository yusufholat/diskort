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
import { createInviteSchema } from './guilds.js';

const channelName = z
  .string()
  .trim()
  .min(1, 'Kanal adı boş olamaz.')
  .max(CHANNEL_NAME_MAX_LENGTH, `Kanal adı en fazla ${CHANNEL_NAME_MAX_LENGTH} karakter olabilir.`);

const createChannelSchema = z.object({
  name: channelName,
  type: z.enum(['voice', 'text']),
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

/**
 * Hesap yönetimi (hesap yöneticilerine: ana sunucunun sahibi ve yöneticileri) ve kanallar. Hesaplar tüm
 * sunuculardan bağımsızdır: hesap daveti yalnızca hesap açtırır, şifre sıfırlama ve hesap silme hesabın
 * kendisine dokunur.
 */
export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, gateway, attachments, permissions } = ctx;
  const primaryOutranks = (actorId: string, targetId: string): boolean => {
    const primary = permissions.primaryGuildId;
    // Ana sunucuda olmayan hesabı her hesap yöneticisi yönetebilir; ana sunucudaysa hiyerarşi geçerli
    if (!primary || !permissions.isMember(primary, targetId)) return !permissions.isInstanceAdmin(targetId);
    return permissions.outranks(primary, actorId, targetId);
  };

  // ---------- Hesap davetleri (sunucuya katılmadan yalnızca hesap açtırır) ----------

  app.get('/api/invites', { preHandler: auth.requireInstanceAdmin }, async () => store.listAccountInvites());

  app.post('/api/invites', { preHandler: auth.requireInstanceAdmin }, async (req, reply) => {
    const body = parseBody(createInviteSchema, req.body, reply);
    if (!body) return reply;
    const invite = store.createInvite({
      guildId: null,
      createdBy: req.user.id,
      maxUses: body.maxUses ?? null,
      expiresAt: body.expiresInHours ? Date.now() + body.expiresInHours * 3_600_000 : null,
    });
    return reply.code(201).send(invite);
  });

  app.delete<{ Params: { code: string } }>('/api/invites/:code', { preHandler: auth.requireInstanceAdmin }, async (req, reply) => {
    const invite = store.getInvite(req.params.code);
    if (!invite || invite.guildId !== null) return sendError(reply, 404, 'not_found', 'Davet bulunamadı.');
    store.deleteInvite(invite.code);
    return reply.code(204).send();
  });

  // ---------- Hesaplar ----------

  // Şifresini unutan kişi için tek kullanımlık, 24 saat geçerli sıfırlama kodu. Kodu alan hesabı ele
  // geçirebileceğinden yalnızca hesap yöneticileri, kendilerinden aşağıdakiler için üretebilir.
  app.post<{ Params: { id: string } }>(
    '/api/users/:id/reset-code',
    { preHandler: auth.requireInstanceAdmin },
    async (req, reply) => {
      const target = store.getUser(req.params.id);
      if (!target) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
      if (target.id !== req.user.id && !primaryOutranks(req.user.id, target.id)) {
        return forbidden(reply, 'En üst rolü seninkinden aşağıda olmayan birinin şifresini sıfırlayamazsın.');
      }
      return store.createResetCode(target.id, req.user.id, RESET_CODE_TTL_MS);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/users/:id', { preHandler: auth.requireInstanceAdmin }, async (req, reply) => {
    const id = req.params.id;
    if (id === req.user.id) return sendError(reply, 400, 'self_delete', 'Kendi hesabını buradan silemezsin.');
    if (!store.getUser(id)) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
    if (!primaryOutranks(req.user.id, id)) {
      return forbidden(reply, 'En üst rolü seninkinden aşağıda olmayan birinin hesabını silemezsin.');
    }
    if (store.ownedGuildIds(id).length > 0) {
      return sendError(reply, 400, 'owner', 'Bu kişi bir sunucunun sahibi; önce sahipliği devretmeli ya da sunucuyu silmeli.');
    }
    await removeAccount(ctx, id, 'Hesabın bir yönetici tarafından silindi.');
    return reply.code(204).send();
  });

  // ---------- Kanallar ----------

  /** Kullanıcının tüm sunucularda görebildiği kanallar */
  app.get('/api/channels', { preHandler: auth.requireUser }, async (req) =>
    [...permissions.guildsOf(req.user.id)].flatMap((guildId) => permissions.visibleChannels(guildId, req.user.id)),
  );

  app.get<{ Params: { guildId: string } }>(
    '/api/guilds/:guildId/channels',
    { preHandler: auth.requireMember },
    async (req) => permissions.visibleChannels(req.params.guildId, req.user.id),
  );

  app.post<{ Params: { guildId: string } }>(
    '/api/guilds/:guildId/channels',
    { preHandler: auth.requireGuildPermission(Permission.MANAGE_CHANNELS) },
    async (req, reply) => {
      const body = parseBody(createChannelSchema, req.body, reply);
      if (!body) return reply;
      const channel = store.createChannel(req.params.guildId, body.name, body.type);
      gateway.dispatchChannel(channel.id, { t: 'CHANNEL_CREATE', d: channel });
      return reply.code(201).send(channel);
    },
  );

  app.patch<{ Params: { id: string } }>('/api/channels/:id', { preHandler: auth.requireUser }, async (req, reply) => {
    const body = parseBody(updateChannelSchema, req.body, reply);
    if (!body) return reply;
    const channel = store.getChannel(req.params.id);
    if (!channel || !permissions.canView(req.user.id, channel)) {
      return sendError(reply, 404, 'not_found', 'Kanal bulunamadı.');
    }
    const guildId = channel.guildId;
    const actorPerms = permissions.inChannel(req.user.id, channel);
    if ((body.name !== undefined || body.position !== undefined) && !hasPermission(actorPerms, Permission.MANAGE_CHANNELS)) {
      return forbidden(reply, 'Kanalları düzenleme yetkin yok.');
    }

    let overwrites: PermissionOverwrite[] | null = null;
    if (body.overwrites) {
      if (!hasPermission(actorPerms, Permission.MANAGE_ROLES)) return forbidden(reply, 'Kanal izinlerini düzenleme yetkin yok.');
      const allowed = channel.type === 'text' ? TEXT_CHANNEL_PERMISSIONS : VOICE_CHANNEL_PERMISSIONS;
      // Yalnızca bu sunucunun rolleri
      const roles = Object.fromEntries(store.guildRoles(guildId).map((r) => [r.id, r]));
      const next = new Map<string, PermissionOverwrite>();
      for (const o of body.overwrites) {
        if (!roles[o.roleId]) return sendError(reply, 400, 'invalid_role', 'Rol bulunamadı.');
        if (o.allow & o.deny) return sendError(reply, 400, 'invalid_body', 'Bir yetki aynı anda hem verilip hem engellenemez.');
        next.set(o.roleId, { roleId: o.roleId, allow: o.allow & allowed, deny: o.deny & allowed });
      }
      const isAdmin = permissions.canInGuild(guildId, req.user.id, Permission.ADMINISTRATOR);
      const current = new Map(channel.overwrites.map((o) => [o.roleId, o]));
      for (const roleId of new Set([...current.keys(), ...next.keys()])) {
        const a = current.get(roleId) ?? { allow: 0, deny: 0 };
        const b = next.get(roleId) ?? { allow: 0, deny: 0 };
        const changed = (a.allow ^ b.allow) | (a.deny ^ b.deny);
        if (changed === 0) continue;
        const role = roles[roleId];
        // Hiyerarşi: yalnızca kendi en üst rolünün altındaki rollerin (ve @everyone'ın) izinleri
        if (!role || !permissions.roleIsBelow(guildId, req.user.id, role)) {
          return forbidden(reply, `"${role?.name ?? 'Silinmiş rol'}" rolünün kanal izinlerini değiştiremezsin.`);
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
    gateway.sendToUsers(viewers, { t: 'CHANNEL_DELETE', d: { id, guildId: channel.guildId } });
    return reply.code(204).send();
  });
}
