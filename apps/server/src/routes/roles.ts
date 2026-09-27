import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ALL_PERMISSIONS,
  BAN_REASON_MAX_LENGTH,
  GUILD_NAME_MAX_LENGTH,
  MAX_ROLES,
  Permission,
  ROLE_COLOR_PATTERN,
  ROLE_NAME_MAX_LENGTH,
  sortRoles,
  type Ban,
  type Role,
} from '@diskort/shared';
import { afterPermissionChange, forbidden, parseBody, sendError, type AppContext } from '../context.js';

const roleName = z
  .string()
  .trim()
  .min(1, 'Rol adı boş olamaz.')
  .max(ROLE_NAME_MAX_LENGTH, `Rol adı en fazla ${ROLE_NAME_MAX_LENGTH} karakter olabilir.`);
const roleColor = z
  .string()
  .regex(ROLE_COLOR_PATTERN, 'Geçersiz renk.')
  .transform((c) => c.toLowerCase())
  .nullable();
const permissionBits = z.number().int().min(0).max(ALL_PERMISSIONS);

const createRoleSchema = z.object({
  name: roleName,
  color: roleColor.optional(),
  hoist: z.boolean().optional(),
  permissions: permissionBits.optional(),
});
const updateRoleSchema = z.object({
  name: roleName.optional(),
  color: roleColor.optional(),
  hoist: z.boolean().optional(),
  permissions: permissionBits.optional(),
});
const reorderSchema = z.object({ roleIds: z.array(z.string().min(1).max(64)).max(MAX_ROLES) });
const guildSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Sunucu adı boş olamaz.')
    .max(GUILD_NAME_MAX_LENGTH, `Sunucu adı en fazla ${GUILD_NAME_MAX_LENGTH} karakter olabilir.`)
    .optional(),
  ownerId: z.string().min(1).max(64).optional(),
});
const banSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(BAN_REASON_MAX_LENGTH, `Sebep en fazla ${BAN_REASON_MAX_LENGTH} karakter olabilir.`)
    .optional(),
});
const voiceSchema = z.object({
  mute: z.boolean().optional(),
  deaf: z.boolean().optional(),
  channelId: z.string().min(1).max(64).nullable().optional(),
});

/** Kullanıcının sahip olmadığı yetkiler (yöneticide hiç yok) */
function lackingBits(ctx: AppContext, userId: string, bits: number): number {
  return bits & ~ctx.permissions.base(userId);
}

/**
 * `actor`, `target` üyeye bu rolü verip alabilir mi; veremiyorsa nedeni. Kurallar: MANAGE_ROLES,
 * rol actor'ün en üst rolünün altında, hedef kendisi ya da kendisinden aşağıda, rolde actor'ün
 * sahip olmadığı yetki yok (yetkisini aşan birini yaratamasın).
 */
export function canAssignRole(ctx: AppContext, actorId: string, targetId: string, role: Role): string | null {
  const { permissions } = ctx;
  if (!permissions.can(actorId, Permission.MANAGE_ROLES)) return 'Rolleri yönetme yetkin yok.';
  if (role.id === ctx.guild.id) return '@everyone rolü verilip alınamaz.';
  if (!permissions.roleIsBelow(actorId, role)) return `"${role.name}" rolü senin en üst rolünden aşağıda değil.`;
  if (targetId !== actorId && !permissions.outranks(actorId, targetId)) {
    return 'En üst rolü seninkinden aşağıda olmayan birinin rollerini değiştiremezsin.';
  }
  if (lackingBits(ctx, actorId, role.permissions) !== 0) return 'Kendinde olmayan yetkileri içeren bir rolü veremezsin.';
  return null;
}

/** Üyeye rol verir/alır ve sonuçlarını yayar (kullanıcı bilgisi, kanal görünümü, ses izinleri). */
export async function setMemberRole(ctx: AppContext, userId: string, roleId: string, add: boolean): Promise<void> {
  const before = ctx.gateway.visibility();
  const changed = add ? ctx.store.addMemberRole(userId, roleId) : ctx.store.removeMemberRole(userId, roleId);
  if (!changed) return;
  ctx.gateway.broadcast({ t: 'USER_UPDATE', d: ctx.store.getUser(userId)! });
  await afterPermissionChange(ctx, before);
}

export function registerRoleRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, gateway, guild, permissions, moderation, voice } = ctx;
  const manageRoles = auth.requirePermission(Permission.MANAGE_ROLES);

  const allRoles = (): Role[] => sortRoles(Object.values(store.permissionData().roles));
  const broadcastRoles = (): void => gateway.broadcast({ t: 'ROLES_UPDATE', d: { roles: allRoles() } });
  /** Yönetici olup olmadığı değişen üyelere USER_UPDATE (rollerden önceki istemciler isAdmin'e bakar) */
  const adminFlags = (): Map<string, boolean> => new Map(store.listUsers().map((u) => [u.id, u.isAdmin]));
  const announceAdminChanges = (before: Map<string, boolean>): void => {
    for (const user of store.listUsers()) {
      if (before.get(user.id) !== user.isAdmin) gateway.broadcast({ t: 'USER_UPDATE', d: user });
    }
  };

  // ---------- Roller ----------

  app.get('/api/roles', { preHandler: auth.requireUser }, async () => allRoles());

  app.post('/api/roles', { preHandler: manageRoles }, async (req, reply) => {
    const body = parseBody(createRoleSchema, req.body, reply);
    if (!body) return reply;
    if (Object.keys(store.permissionData().roles).length > MAX_ROLES) {
      return sendError(reply, 400, 'too_many_roles', `En fazla ${MAX_ROLES} rol oluşturulabilir.`);
    }
    const bits = body.permissions ?? 0;
    if (lackingBits(ctx, req.user.id, bits) !== 0) return forbidden(reply, 'Kendinde olmayan bir yetkiyi veremezsin.');
    const role = store.createRole(guild.id, {
      name: body.name,
      color: body.color ?? null,
      hoist: body.hoist ?? false,
      permissions: bits,
    });
    broadcastRoles();
    return reply.code(201).send(role);
  });

  app.patch<{ Params: { id: string } }>('/api/roles/:id', { preHandler: manageRoles }, async (req, reply) => {
    const body = parseBody(updateRoleSchema, req.body, reply);
    if (!body) return reply;
    const role = store.getRole(req.params.id);
    if (!role) return sendError(reply, 404, 'not_found', 'Rol bulunamadı.');
    if (!permissions.roleIsBelow(req.user.id, role)) {
      return forbidden(reply, 'Yalnızca senin en üst rolünden aşağıdaki rolleri düzenleyebilirsin.');
    }
    const everyone = role.id === guild.id;
    if (everyone && (body.name !== undefined || body.color !== undefined || body.hoist !== undefined)) {
      return sendError(reply, 400, 'invalid_body', '@everyone rolünün yalnızca yetkileri değiştirilebilir.');
    }
    const permissionsChanged = body.permissions !== undefined && body.permissions !== role.permissions;
    if (permissionsChanged && lackingBits(ctx, req.user.id, role.permissions ^ body.permissions!) !== 0) {
      return forbidden(reply, 'Kendinde olmayan bir yetkiyi verip alamazsın.');
    }
    const before = gateway.visibility();
    const admins = adminFlags();
    const updated = store.updateRole(role.id, body)!;
    broadcastRoles();
    if (permissionsChanged) {
      announceAdminChanges(admins);
      await afterPermissionChange(ctx, before);
    }
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/roles/:id', { preHandler: manageRoles }, async (req, reply) => {
    const role = store.getRole(req.params.id);
    if (!role) return sendError(reply, 404, 'not_found', 'Rol bulunamadı.');
    if (role.id === guild.id) return sendError(reply, 400, 'invalid_role', '@everyone rolü silinemez.');
    if (!permissions.roleIsBelow(req.user.id, role)) {
      return forbidden(reply, 'Yalnızca senin en üst rolünden aşağıdaki rolleri silebilirsin.');
    }
    const members = store.listUsers().filter((u) => u.roles.includes(role.id));
    // Rolün kanal izinleri de silinir: o kanalları görmeye devam edenler güncel hâlini almalı
    const channels = [...store.permissionData().channels.values()]
      .filter((c) => c.overwrites.some((o) => o.roleId === role.id))
      .map((c) => c.id);
    const before = gateway.visibility();
    store.deleteRole(guild.id, role.id);
    broadcastRoles();
    for (const member of members) gateway.broadcast({ t: 'USER_UPDATE', d: store.getUser(member.id)! });
    await afterPermissionChange(ctx, before, channels);
    return reply.code(204).send();
  });

  // Rollerin sırası (yukarıdan aşağı). Yalnızca kendi en üst rolünün altındaki roller yer değiştirebilir
  // ve hiçbiri onun üstüne çıkamaz.
  app.put('/api/roles/order', { preHandler: manageRoles }, async (req, reply) => {
    const body = parseBody(reorderSchema, req.body, reply);
    if (!body) return reply;
    const roles = store.permissionData().roles;
    const current = Object.values(roles).filter((r) => r.id !== guild.id);
    const ids = new Set(body.roleIds);
    if (ids.size !== body.roleIds.length || ids.size !== current.length || current.some((r) => !ids.has(r.id))) {
      return sendError(reply, 400, 'invalid_body', 'Sıralamada tüm roller birer kez bulunmalı.');
    }
    const highest = permissions.highest(req.user.id);
    for (const [i, id] of body.roleIds.entries()) {
      const role = roles[id]!;
      const position = body.roleIds.length - i;
      if (position !== role.position && (role.position >= highest || position >= highest)) {
        return forbidden(reply, 'Yalnızca senin en üst rolünden aşağıdaki rollerin sırası değişebilir.');
      }
    }
    store.setRoleOrder(body.roleIds);
    broadcastRoles();
    return allRoles();
  });

  // ---------- Üyelerin rolleri ----------

  const memberRole = async (
    params: { id: string; roleId: string },
    actorId: string,
    add: boolean,
    reply: import('fastify').FastifyReply,
  ) => {
    const target = store.getUser(params.id);
    if (!target || target.removed) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
    const role = store.getRole(params.roleId);
    if (!role) return sendError(reply, 404, 'not_found', 'Rol bulunamadı.');
    const denied = canAssignRole(ctx, actorId, target.id, role);
    if (denied) return forbidden(reply, denied);
    await setMemberRole(ctx, target.id, role.id, add);
    return store.getUser(target.id);
  };

  app.put<{ Params: { id: string; roleId: string } }>(
    '/api/users/:id/roles/:roleId',
    { preHandler: manageRoles },
    async (req, reply) => memberRole(req.params, req.user.id, true, reply),
  );

  app.delete<{ Params: { id: string; roleId: string } }>(
    '/api/users/:id/roles/:roleId',
    { preHandler: manageRoles },
    async (req, reply) => memberRole(req.params, req.user.id, false, reply),
  );

  // ---------- Sunucu ----------

  app.patch('/api/guild', { preHandler: auth.requireUser }, async (req, reply) => {
    const body = parseBody(guildSchema, req.body, reply);
    if (!body) return reply;
    if (body.name !== undefined && !permissions.can(req.user.id, Permission.MANAGE_GUILD)) {
      return forbidden(reply, 'Sunucuyu yönetme yetkin yok.');
    }
    const previousOwner = store.getGuild()!.ownerId;
    if (body.ownerId !== undefined && body.ownerId !== previousOwner) {
      if (req.user.id !== previousOwner) return forbidden(reply, 'Sahipliği yalnızca sunucunun sahibi devredebilir.');
      const next = store.getUser(body.ownerId);
      if (!next || next.removed) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
    }
    const before = gateway.visibility();
    const admins = adminFlags();
    Object.assign(guild, store.updateGuild(body));
    gateway.broadcast({ t: 'GUILD_UPDATE', d: guild });
    if (guild.ownerId !== previousOwner) {
      announceAdminChanges(admins);
      await afterPermissionChange(ctx, before);
    }
    return guild;
  });

  // ---------- Atma ve yasaklama ----------
  // Tek topluluklu uygulamada hesap = üyelik. Atılan hesabın oturumları kapanır, rolleri silinir; hesap ve
  // mesajları kalır. Yeni bir davet koduyla "Kayıt ol" ekranında kendi kullanıcı adı ve şifresiyle geri
  // dönebilir. Yasaklanan hesap ayrıca geri dönemez (yasak kaldırılana kadar giriş de yapamaz).

  const removeMember = async (
    actorId: string,
    targetId: string,
    ban: { reason: string | null } | null,
    reply: import('fastify').FastifyReply,
  ) => {
    const target = store.getUser(targetId);
    if (!target) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
    if (target.id === actorId) return sendError(reply, 400, 'self', 'Kendini atamaz ya da yasaklayamazsın.');
    if (!ban && target.removed) return sendError(reply, 400, 'not_member', 'Bu kullanıcı zaten üye değil.');
    if (store.membership(target.id) === 'banned') return sendError(reply, 400, 'already_banned', 'Bu kullanıcı zaten yasaklı.');
    if (!permissions.outranks(actorId, target.id)) {
      return forbidden(reply, 'En üst rolü seninkinden aşağıda olmayan birini atamaz ya da yasaklayamazsın.');
    }
    const user = store.removeMember(target.id, ban)!;
    gateway.broadcast({ t: 'USER_UPDATE', d: user });
    gateway.disconnectUser(target.id, ban ? 'Bu sunucudan yasaklandın.' : 'Sunucudan çıkarıldın.');
    await moderation.disconnect(target.id);
    return reply.code(204).send();
  };

  app.post<{ Params: { id: string } }>(
    '/api/users/:id/kick',
    { preHandler: auth.requirePermission(Permission.KICK_MEMBERS) },
    async (req, reply) => removeMember(req.user.id, req.params.id, null, reply),
  );

  app.post<{ Params: { id: string } }>(
    '/api/users/:id/ban',
    { preHandler: auth.requirePermission(Permission.BAN_MEMBERS) },
    async (req, reply) => {
      const body = parseBody(banSchema, req.body, reply);
      if (!body) return reply;
      return removeMember(req.user.id, req.params.id, { reason: body.reason || null }, reply);
    },
  );

  app.get('/api/bans', { preHandler: auth.requirePermission(Permission.BAN_MEMBERS) }, async (): Promise<Ban[]> =>
    store.listBans(),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/bans/:id',
    { preHandler: auth.requirePermission(Permission.BAN_MEMBERS) },
    async (req, reply) => {
      if (!store.unban(req.params.id)) return sendError(reply, 404, 'not_found', 'Yasaklı kullanıcı bulunamadı.');
      return reply.code(204).send();
    },
  );

  // ---------- Sesli sohbette yönetim ----------
  // Sunucuda susturma/sağırlaştırma (kalıcı), başka kanala taşıma, sesten çıkarma. Yetkiler üyenin
  // bulunduğu kanalda aranır (seste değilse sunucu genelinde); kendinden yukarıdakilere yapılamaz.

  app.patch<{ Params: { id: string } }>('/api/users/:id/voice', { preHandler: auth.requireUser }, async (req, reply) => {
    const body = parseBody(voiceSchema, req.body, reply);
    if (!body) return reply;
    const actorId = req.user.id;
    const target = store.getUser(req.params.id);
    if (!target || target.removed) return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
    if (target.id !== actorId && !permissions.outranks(actorId, target.id)) {
      return forbidden(reply, 'En üst rolü seninkinden aşağıda olmayan birini yönetemezsin.');
    }
    const state = voice.get(target.id);
    const can = (flag: number, channelId = state?.channelId): boolean =>
      channelId ? permissions.can(actorId, flag, channelId) : permissions.can(actorId, flag);
    if (body.mute !== undefined && !can(Permission.MUTE_MEMBERS)) return forbidden(reply, 'Üyeleri susturma yetkin yok.');
    if (body.deaf !== undefined && !can(Permission.DEAFEN_MEMBERS)) {
      return forbidden(reply, 'Üyeleri sağırlaştırma yetkin yok.');
    }
    if (body.channelId !== undefined) {
      if (!state) return sendError(reply, 400, 'not_in_voice', 'Kullanıcı bir ses kanalında değil.');
      if (!can(Permission.MOVE_MEMBERS)) return forbidden(reply, 'Üyeleri taşıma yetkin yok.');
      if (body.channelId !== null) {
        const dest = store.getChannel(body.channelId);
        if (!dest || dest.type !== 'voice' || !permissions.canView(actorId, dest)) {
          return sendError(reply, 404, 'not_found', 'Ses kanalı bulunamadı.');
        }
        if (!can(Permission.MOVE_MEMBERS, dest.id)) return forbidden(reply, 'O kanala üye taşıma yetkin yok.');
        if (!moderation.canConnect(target.id, dest.id)) return forbidden(reply, 'Bu üye o kanala bağlanamaz.');
      }
    }

    if (body.mute !== undefined || body.deaf !== undefined) {
      const current = voice.getServerFlags(target.id);
      await moderation.setServerFlags(target.id, {
        serverMute: body.mute ?? current.serverMute,
        serverDeaf: body.deaf ?? current.serverDeaf,
      });
    }
    if (body.channelId === null) await moderation.disconnect(target.id);
    else if (body.channelId !== undefined) moderation.move(target.id, body.channelId);
    return reply.code(204).send();
  });
}
