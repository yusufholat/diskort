import os from 'node:os';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sendError, type AppContext } from '../context.js';
import { dayKey } from '../counters.js';
import { lkRow, type LiveKitMetrics } from '../infraStats.js';

// Bağlantı teşhisi uçları (yönetim paneli "Bağlantı teşhisi" sekmesi). Hepsi yalnızca hesap yöneticilerine;
// yanıtlar saklanmaz (no-store) ve boyutları sınırlıdır.
//  - /net/live: canlı durum (son saniyeler, sondalar, süren kesinti, son kesintiler, LiveKit hızları). Panel
//    2 sn'de bir, yalnızca en son gördüğü saniyeden sonrasını (since) ister.
//  - /net/seconds: bir aralığın saniyelik satırları (halkadan ya da diskteki anormal-saniye kaydından)
//  - /net/outages: kesinti kaydı
//  - /net/minutes: bir günün dakikalık özeti (14 gün saklanır)

export interface AdminNetServices {
  livekitMetrics: LiveKitMetrics;
}

const DAY = 86_400_000;
const LIVE_MAX_SECONDS = 600;
const SECONDS_MAX_SPAN_MS = 15 * 60_000;

const liveQuery = z.object({
  seconds: z.coerce.number().int().min(10).max(LIVE_MAX_SECONDS).optional().default(300),
  since: z.coerce.number().int().min(0).optional(),
});
const secondsQuery = z.object({ from: z.coerce.number().int().min(0), to: z.coerce.number().int().min(0) });
const outagesQuery = z.object({ days: z.coerce.number().int().min(1).max(14).optional().default(7) });
const minutesQuery = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export function registerAdminNetRoutes(app: FastifyInstance, ctx: AppContext, services: AdminNetServices): void {
  const { livekitMetrics } = services;
  const sampler = ctx.netSampler;
  const guard = { preHandler: ctx.auth.requireInstanceAdmin };
  const bad = (reply: FastifyReply): FastifyReply => sendError(reply, 400, 'invalid_query', 'Geçersiz istek.');
  const noStore = (reply: FastifyReply): void => void reply.header('Cache-Control', 'no-store');

  app.get('/api/admin/net/live', guard, async (req, reply) => {
    const q = liveQuery.safeParse(req.query);
    if (!q.success) return bad(reply);
    noStore(reply);
    const now = Date.now();
    const from = Math.max(now - q.data.seconds * 1000, q.data.since !== undefined ? q.data.since + 1 : 0);
    const lk = await livekitMetrics.status(now);
    const voice = ctx.voice.list();
    const day = sampler.outages.list(now - DAY);
    return {
      now,
      /** Düzenli ölçüm açık mı (SYSTEM_STATS) ve dış sondalar çalışıyor mu (geliştirme makinesinde kapalı) */
      enabled: ctx.config.systemStats,
      sampler: {
        readable: sampler.readable,
        iface: sampler.iface,
        gateway: sampler.gateway,
        serverIp: sampler.serverIp(),
        ring: sampler.size,
        persistedRows: sampler.persistedRows,
        dropped: sampler.dropped,
      },
      cores: os.availableParallelism?.() ?? 1,
      rows: sampler.window(from, now).slice(-LIVE_MAX_SECONDS),
      probes: ctx.netProbes.status(now),
      open: { probe: ctx.netProbes.status(now).open, nic: sampler.openSilence() },
      outages: sampler.outages.list(now - 14 * DAY).slice(0, 20),
      outageCounts: { day: day.length, week: sampler.outages.list(now - 7 * DAY).length },
      livekit: {
        configured: lk.configured,
        ok: lk.ok,
        error: lk.error,
        lastOkAt: lk.lastOkAt,
        latest: lk.latest ? lkRow(lk.latest) : null,
        history: livekitMetrics.window(from, now),
      },
      voice: {
        participants: voice.length,
        streams: voice.filter((v) => v.streaming).length,
        channels: new Set(voice.map((v) => v.channelId)).size,
      },
    };
  });

  app.get('/api/admin/net/seconds', guard, async (req, reply) => {
    const q = secondsQuery.safeParse(req.query);
    if (!q.success || q.data.to < q.data.from || q.data.to - q.data.from > SECONDS_MAX_SPAN_MS) return bad(reply);
    noStore(reply);
    const { from, to } = q.data;
    return {
      from,
      to,
      // Halkanın dışında kalan aralık için yalnızca anormal saniyelerin çevresi (±30 sn) bulunur
      rows: await sampler.seconds(from, to),
      outages: sampler.outages.between(from, to),
      livekit: livekitMetrics.window(from, to),
    };
  });

  app.get('/api/admin/net/outages', guard, async (req, reply) => {
    const q = outagesQuery.safeParse(req.query);
    if (!q.success) return bad(reply);
    noStore(reply);
    const now = Date.now();
    return {
      now,
      days: q.data.days,
      serverIp: sampler.serverIp(),
      iface: sampler.iface,
      outages: sampler.outages.list(now - q.data.days * DAY).slice(0, 500),
    };
  });

  app.get('/api/admin/net/minutes', guard, async (req, reply) => {
    const q = minutesQuery.safeParse(req.query);
    if (!q.success) return bad(reply);
    noStore(reply);
    const now = Date.now();
    const day = q.data.day ?? dayKey(now, ctx.config.statsUtcOffsetMin);
    return { now, day, offsetMin: ctx.config.statsUtcOffsetMin, days: await sampler.minuteDays(), rows: await sampler.minutes(day) };
  });
}
