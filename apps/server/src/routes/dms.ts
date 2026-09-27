import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  DM_GROUP_MAX_PARTICIPANTS,
  DM_NAME_MAX_LENGTH,
  hasPermission,
  Permission,
  type DmChannel,
} from '@diskort/shared';
import { forbidden, parseBody, sendError, type AppContext } from '../context.js';
import { createRateLimiter } from './messages.js';

const dmName = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().max(DM_NAME_MAX_LENGTH, `Grup adı en fazla ${DM_NAME_MAX_LENGTH} karakter olabilir.`))
  .nullable();

const createSchema = z.object({
  userIds: z
    .array(z.string().min(1).max(64))
    .min(1, 'En az bir kişi seçmelisin.')
    .max(DM_GROUP_MAX_PARTICIPANTS - 1, `Bir grupta en fazla ${DM_GROUP_MAX_PARTICIPANTS} kişi olabilir.`),
  name: dmName.optional(),
});
const updateSchema = z.object({ name: dmName });

/**
 * Direkt mesajlar: bire bir ve küçük grup konuşmaları. Mesajlar metin kanallarıyla aynı uçlardan
 * gider (/api/channels/:id/messages); burada konuşmaların kendisi yönetilir. Yalnızca katılımcılar
 * erişir; yönetici ya da sahip de başkasının konuşmasını göremez (yokmuş gibi 404). Konuşma yalnızca
 * ortak bir sunucusu olan kişilerle başlatılır, gruba da yalnızca onlar eklenir; başkası yokmuş gibi 404.
 */
export function registerDmRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, gateway, permissions, attachments } = ctx;
  const allowCreate = createRateLimiter(10, 60_000);

  /** Kullanıcının katıldığı konuşma; değilse yokmuş gibi 404 */
  const ownDm = (id: string, userId: string, reply: FastifyReply): DmChannel | null => {
    const dm = permissions.isDm(id) && permissions.canView(userId, id) ? store.getDm(id) : null;
    if (!dm) void sendError(reply, 404, 'not_found', 'Konuşma bulunamadı.');
    return dm;
  };

  /** Konuşmayı katılımcılarına güncel hâliyle duyurur */
  const announce = (dm: DmChannel, except?: string): void => {
    gateway.sendDm(
      dm.participantIds.filter((id) => id !== except),
      { t: 'DM_CHANNEL_UPDATE', d: dm },
    );
  };

  app.get('/api/dms', { preHandler: auth.requireUser }, async (req) => store.listDms(req.user.id));

  // Tek kişi: bire bir konuşma (varsa aynısı); birden çok kişi: yeni grup
  app.post('/api/dms', { preHandler: auth.requireUser }, async (req, reply) => {
    const body = parseBody(createSchema, req.body, reply);
    if (!body) return reply;
    const others = [...new Set(body.userIds)].filter((id) => id !== req.user.id);
    if (others.length === 0) return sendError(reply, 400, 'invalid_body', 'Kendine mesaj gönderemezsin.');
    for (const id of others) {
      if (!permissions.sharesGuild(req.user.id, id) || !store.getUser(id)) {
        return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
      }
    }
    // Sınır yalnızca yeni konuşmaya: var olan bire bir konuşmayı açmak serbest
    const existing = others.length === 1 ? store.directDmId(req.user.id, others[0]!) : null;
    if (!existing && !allowCreate(req.user.id)) {
      return sendError(reply, 429, 'rate_limited', 'Çok hızlı konuşma başlatıyorsun, biraz bekle.');
    }
    if (others.length === 1) {
      const { dm, created, opened } = store.openDirectDm(req.user.id, others[0]!);
      if (opened) gateway.sendDm([req.user.id], { t: 'DM_CHANNEL_CREATE', d: dm });
      return reply.code(created ? 201 : 200).send(dm);
    }
    const dm = store.createGroupDm(req.user.id, others, body.name || null);
    gateway.sendDm(dm.participantIds, { t: 'DM_CHANNEL_CREATE', d: dm });
    return reply.code(201).send(dm);
  });

  // Grubun adı (her katılımcı değiştirebilir)
  app.patch<{ Params: { id: string } }>('/api/dms/:id', { preHandler: auth.requireUser }, async (req, reply) => {
    const dm = ownDm(req.params.id, req.user.id, reply);
    if (!dm) return reply;
    if (!dm.group) return sendError(reply, 400, 'not_group', 'Yalnızca grupların adı olur.');
    const body = parseBody(updateSchema, req.body, reply);
    if (!body) return reply;
    const updated = store.renameDm(dm.id, body.name || null)!;
    announce(updated);
    return updated;
  });

  // Bire bir konuşma listeden kaldırılır (yeni mesaj gelince yeniden görünür); gruptan ayrılınır
  app.delete<{ Params: { id: string } }>('/api/dms/:id', { preHandler: auth.requireUser }, async (req, reply) => {
    const dm = ownDm(req.params.id, req.user.id, reply);
    if (!dm) return reply;
    if (!dm.group) {
      if (store.closeDm(dm.id, req.user.id)) gateway.sendDm([req.user.id], { t: 'DM_CHANNEL_DELETE', d: { id: dm.id } });
      return reply.code(204).send();
    }
    const { deleted, files } = store.leaveDm(dm.id, req.user.id);
    gateway.sendDm([req.user.id], { t: 'DM_CHANNEL_DELETE', d: { id: dm.id } });
    if (!deleted) announce(store.getDm(dm.id)!);
    await attachments.remove(files);
    return reply.code(204).send();
  });

  // Gruba kişi eklemek (her katılımcı); eklenen, geçmişin tamamını görür
  app.put<{ Params: { id: string; userId: string } }>(
    '/api/dms/:id/participants/:userId',
    { preHandler: auth.requireUser },
    async (req, reply) => {
      const dm = ownDm(req.params.id, req.user.id, reply);
      if (!dm) return reply;
      if (!dm.group) {
        return sendError(reply, 400, 'not_group', 'Bire bir konuşmaya kişi eklenemez; yeni bir grup başlat.');
      }
      if (!hasPermission(permissions.inChannel(req.user.id, dm.id), Permission.SEND_MESSAGES)) return forbidden(reply);
      const target = store.getUser(req.params.userId);
      if (!target || !permissions.sharesGuild(req.user.id, target.id)) {
        return sendError(reply, 404, 'not_found', 'Kullanıcı bulunamadı.');
      }
      if (dm.participantIds.includes(target.id)) return dm;
      if (dm.participantIds.length >= DM_GROUP_MAX_PARTICIPANTS) {
        return sendError(reply, 400, 'group_full', `Bir grupta en fazla ${DM_GROUP_MAX_PARTICIPANTS} kişi olabilir.`);
      }
      store.addDmParticipant(dm.id, target.id);
      const updated = store.getDm(dm.id)!;
      gateway.sendDm([target.id], { t: 'DM_CHANNEL_CREATE', d: updated });
      announce(updated, target.id);
      return updated;
    },
  );
}
