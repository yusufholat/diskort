import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { TRACE_TIME_MAX, type TraceMeta } from '../clientTrace.js';
import { parseBody, sendError, type AppContext } from '../context.js';
import { isPrivateId, PRIVATE_CALL_NAME, PRIVATE_PARTICIPANT_NAME } from '../privateCalls.js';

// Yönetim paneli: olay kayıtları (istemcilerin sorun anındaki saniyelik bağlantı ölçümleri; bkz. clientTrace.ts).
// Yalnızca hesap yöneticileri. Zamanlar SUNUCU saatiyledir (istemci saati + saat farkı).

const DAY = 86_400_000;
/** Liste aralığı en çok saklama süresi kadar; tam kayıt penceresi en çok bu kadar */
const WINDOW_MAX_MS = 15 * 60_000;

const id = z.string().min(1).max(64);
/** Unix ms; aralık dışı sayı (tarih hesabını bozar) reddedilir */
const time = z.coerce.number().finite().min(0).max(TRACE_TIME_MAX);
const listQuery = z.object({
  from: time.optional(),
  to: time.optional(),
  channelId: id.optional(),
  userId: id.optional(),
  eventId: id.optional(),
  limit: z.coerce.number().int().min(1).max(1_000).optional(),
});
const windowQuery = z.object({
  from: time,
  to: time,
  channelId: id.optional(),
  userId: id.optional(),
  eventId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const requestBody = z.object({
  channelId: id,
  reason: z.string().max(48).optional(),
});

export function registerAdminTraceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, traces } = ctx;
  const guard = { preHandler: ctx.auth.requireInstanceAdmin };
  const bad = (reply: FastifyReply): FastifyReply => sendError(reply, 400, 'invalid_query', 'Geçersiz istek.');
  const noStore = (reply: FastifyReply): void => void reply.header('Cache-Control', 'no-store');

  /** Kayıtlardaki kullanıcı ve kanalların adları */
  const names = (
    metas: readonly TraceMeta[],
  ): { users: Record<string, { username: string; displayName: string }>; channels: Record<string, { name: string; guildId: string | null }> } => {
    const users: Record<string, { username: string; displayName: string }> = {};
    for (const u of store.usersByIds([...new Set(metas.map((m) => m.userId))])) {
      users[u.id] = { username: u.username, displayName: u.displayName };
    }
    // DM aramalarının kayıtları takma kimliklidir: adsız (bkz. privateCalls.ts)
    for (const m of metas) if (isPrivateId(m.userId)) users[m.userId] = { username: '', displayName: PRIVATE_PARTICIPANT_NAME };
    const channels: Record<string, { name: string; guildId: string | null }> = {};
    for (const channelId of new Set(metas.map((m) => m.channelId))) {
      if (isPrivateId(channelId)) {
        channels[channelId!] = { name: PRIVATE_CALL_NAME, guildId: null };
        continue;
      }
      const c = channelId ? store.getChannel(channelId) : null;
      if (c) channels[c.id] = { name: c.name, guildId: c.guildId };
    }
    return { users, channels };
  };

  // ---------- Kayıtların listesi (yalnızca özetler; varsayılan son 24 saat) ----------
  app.get('/api/admin/voice/traces', guard, async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) return bad(reply);
    noStore(reply);
    const now = Date.now();
    const to = q.data.to ?? now;
    const from = Math.max(q.data.from ?? to - DAY, to - traces.retentionDays * DAY);
    if (from > to) return bad(reply);
    const { traces: list, truncated } = await traces.list({ ...q.data, from, to });
    return {
      from,
      to,
      retentionDays: traces.retentionDays,
      stats: { received: traces.received, duplicates: traces.duplicates, dropped: traces.dropped, overBudget: traces.overBudget },
      traces: list,
      truncated,
      ...names(list),
    };
  });

  // ---------- Bir zaman penceresindeki kayıtların tamamı (herkesin aynı saniyeleri) ----------
  app.get('/api/admin/voice/traces/window', guard, async (req, reply) => {
    const q = windowQuery.safeParse(req.query);
    if (!q.success || q.data.from > q.data.to || q.data.to - q.data.from > WINDOW_MAX_MS) return bad(reply);
    noStore(reply);
    const { traces: list, truncated } = await traces.window(q.data);
    return { from: q.data.from, to: q.data.to, traces: list, truncated, ...names(list) };
  });

  // ---------- Tek kayıt (ölçümleriyle) ----------
  app.get<{ Params: { id: string } }>('/api/admin/voice/traces/:id', guard, async (req, reply) => {
    if (!/^[a-z0-9-]{1,64}$/.test(req.params.id)) return bad(reply);
    noStore(reply);
    const trace = await traces.get(req.params.id);
    if (!trace) return sendError(reply, 404, 'not_found', 'Olay kaydı bulunamadı.');
    return { trace, ...names([trace]) };
  });

  // ---------- Ses kanalındaki herkesten olay kaydı iste ----------
  app.post('/api/admin/voice/traces/request', guard, async (req, reply) => {
    const body = parseBody(requestBody, req.body, reply);
    if (!body) return reply;
    const channel = store.getChannel(body.channelId);
    if (!channel || channel.type !== 'voice') return sendError(reply, 404, 'not_found', 'Ses kanalı bulunamadı.');
    const result = ctx.requestVoiceTraces(channel.id, body.reason ?? 'yönetici isteği');
    if (result.throttled) return sendError(reply, 429, 'rate_limited', 'Bu kanaldan az önce olay kaydı istendi.');
    return result;
  });
}
