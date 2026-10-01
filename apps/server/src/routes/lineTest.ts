import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { User } from '@diskort/shared';
import { parseBody, sendError, type AppContext } from '../context.js';
import { groupSuites, syncGroups, type ClientContext, type LineRun } from '../lineTest/service.js';
import { ADMIN_PROFILES, LINE_MODES, LINE_PROFILES, USER_PROFILES, type LineProfile } from '../lineTest/plan.js';
import { stepStats } from '../lineTest/verdict.js';
import type { SecondStat } from '../lineTest/protocol.js';
import { createRateLimiter } from './messages.js';

// Hat testi uçları (bkz. lineTest/). Oturumu açmak kimlik ister (hesap jetonu ya da yönetici kodu); sonrasındaki
// her çağrı yalnızca oturum jetonuyla (X-Line-Token) yapılır.
// Kim neyi açabilir:
//  - Sıradan hesap: yalnızca kısa test (quick), 10 dakikada birkaç kez. (Tam paket 12-16 Mbps yük bindirir; bunu
//    her giriş yapmış kullanıcının yayın sırasında başlatabilmesi, incelenen donmanın kendisine yol açabilir.)
//  - Test kodu (yöneticinin verdiği): tam paket (ramp/pps/steady/quick), olağan bant sınırıyla.
//  - Hesap yöneticisi ve "yönetici kodu": ayrıca patlama profili (burst), yönetici bant sınırıyla. Patlama testi
//    canlı yayın varken açıkça zorlanmadıkça (force) başlamaz.

const DAY = 86_400_000;
const TOKEN_HEADER = 'x-line-token';

const openSchema = z.object({
  profile: z.enum(LINE_PROFILES as [string, ...string[]]),
  mode: z.enum(LINE_MODES as [string, ...string[]]).default('both'),
  transport: z.enum(['udp', 'tcp']).default('udp'),
  code: z.string().max(32).optional(),
  name: z.string().trim().min(1).max(32).optional(),
  /** Canlı yayın varken patlama testini yine de başlat */
  force: z.boolean().optional(),
});

const secSchema = z.object({
  recv: z.number().int().min(0).max(100_000),
  reord: z.number().int().min(0).max(100_000),
  dup: z.number().int().min(0).max(100_000).default(0),
  bytes: z.number().min(0).max(1e9),
  jit: z.number().min(0).max(1e6),
});
const str = (n: number) => z.string().max(n).optional();
const finishSchema = z.object({
  suite: z
    .string()
    .regex(/^[A-Za-z0-9_-]{4,40}$/)
    .optional(),
  down: z.array(secSchema).max(60).nullable().optional(),
  /** İstemci UDP el sıkışmasını tamamlayamadı: sunucunun yukarı yön sayımı yok sayılır */
  udpFailed: z.boolean().optional(),
  tcpDown: z.array(z.number().min(0).max(1e9)).max(60).nullable().optional(),
  client: z
    .object({
      os: str(80),
      arch: str(16),
      node: str(24),
      app: str(24),
      tool: str(24),
      localIp: str(16),
      tracert: str(8_000),
      note: str(300),
      clockOffsetMs: z.number().finite().min(-1e9).max(1e9).optional(),
      rttMs: z.number().finite().min(0).max(1e6).optional(),
    })
    .optional(),
});

const adminCodeSchema = z.object({
  label: z.string().trim().max(40).default(''),
  hours: z.number().min(0.5).max(72).default(12),
  maxUses: z.number().int().min(1).max(200).default(30),
  /** Yönetici kodu: patlama profilini (olağan bant sınırının üstü) de açabilir */
  admin: z.boolean().default(false),
});

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(30).optional().default(7) });

const PAD = randomBytes(64 * 1024);

export function registerLineTestRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { lineTest } = ctx;
  const allowTime = createRateLimiter(30, 10_000);
  const allowOpenByIp = createRateLimiter(40, 600_000);
  // Sıradan hesap: 10 dakikada 6 kısa test; yöneticiler tam paketi art arda çalıştırabilsin diye daha geniş
  const allowOpenByUser = createRateLimiter(6, 600_000);
  const allowOpenByAdmin = createRateLimiter(40, 600_000);
  // Yanlış kod denemeleri: sınır önce denetlenir, aşılınca doğru kod da reddedilir (kod tahmini yavaşlar)
  const codeFails = new Map<string, { n: number; at: number }>();
  const codeBlocked = (ip: string): boolean => {
    const f = codeFails.get(ip);
    if (!f) return false;
    if (Date.now() - f.at > 600_000) {
      codeFails.delete(ip);
      return false;
    }
    return f.n >= 10;
  };
  const codeFailed = (ip: string): void => {
    const now = Date.now();
    if (codeFails.size > 5_000) codeFails.delete(codeFails.keys().next().value!);
    const f = codeFails.get(ip);
    if (f && now - f.at <= 600_000) f.n++;
    else codeFails.set(ip, { n: 1, at: now });
  };
  const admin = { preHandler: ctx.auth.requireInstanceAdmin };

  const tokenOf = (req: FastifyRequest): string | undefined => {
    const v = req.headers[TOKEN_HEADER];
    return typeof v === 'string' ? v : undefined;
  };
  const noStore = (reply: FastifyReply): void => void reply.header('Cache-Control', 'no-store');

  // Saat farkını ölçmek için (zamanlanmış ortak test): kimlik gerekmez, yanıt küçük
  app.get('/api/line-test/time', async (req, reply) => {
    if (!allowTime(req.ip)) return sendError(reply, 429, 'rate_limited', 'Çok sık istek.');
    noStore(reply);
    return { now: Date.now() };
  });

  // ---------- Oturum açma ----------
  app.post('/api/line-test/session', async (req, reply) => {
    const body = parseBody(openSchema, req.body, reply);
    if (!body) return reply;
    if (!allowOpenByIp(req.ip)) return sendError(reply, 429, 'rate_limited', 'Çok sık test başlattın, birkaç dakika bekle.');
    if (lineTest.port === null) return sendError(reply, 503, 'disabled', 'Hat testi bu sunucuda kapalı.');

    let user: User | null = null;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      user = await ctx.auth.userFromToken(header.slice(7));
      if (!user) return sendError(reply, 401, 'unauthorized', 'Oturum geçersiz, tekrar giriş yap.');
    }
    let code = null;
    if (!user) {
      if (!body.code) return sendError(reply, 401, 'unauthorized', 'Giriş ya da test kodu gerekli.');
      if (codeBlocked(req.ip)) return sendError(reply, 429, 'rate_limited', 'Çok fazla kod denemesi, 10 dakika sonra tekrar dene.');
      code = lineTest.checkCode(body.code);
      if (!code) {
        codeFailed(req.ip);
        return sendError(reply, 401, 'bad_code', 'Test kodu geçersiz ya da süresi dolmuş.');
      }
      if (!body.name) return sendError(reply, 400, 'invalid_body', 'Adını yaz (--ad).');
    } else if (!(user.isAdmin ? allowOpenByAdmin : allowOpenByUser)(user.id)) {
      return sendError(reply, 429, 'rate_limited', 'Çok sık test başlattın, birkaç dakika bekle.');
    }
    const profile = body.profile as LineProfile;
    const privileged = user ? user.isAdmin : code?.admin === true;
    if (user && !user.isAdmin && !USER_PROFILES.includes(profile)) {
      return sendError(reply, 403, 'forbidden_profile', 'Hesabınla yalnızca kısa hat testi çalıştırılabilir; tam test için yöneticiden test kodu iste.');
    }
    if (ADMIN_PROFILES.includes(profile) && !privileged) {
      return sendError(reply, 403, 'forbidden_profile', 'Patlama testi yalnızca yönetici koduyla ya da yönetici hesabıyla çalıştırılabilir.');
    }
    // Patlama testi 40 Mbps'e kadar yük bindirir: yayın varken yayını dondurabilir (ve teşhisi bulandırır)
    if (ADMIN_PROFILES.includes(profile) && lineTest.streamLive() && body.force !== true) {
      return sendError(reply, 409, 'stream_live', 'Şu an canlı yayın var: patlama testi yayını dondurabilir. Yayın bitince dene ya da bilerek çalıştırmak için --zorla ekle.');
    }
    const who = user
      ? { kind: 'user' as const, userId: user.id, name: user.displayName }
      : { kind: 'code' as const, userId: null, name: body.name! };
    const r = lineTest.mint(who, code, profile, body.mode as never, body.transport, req.ip, privileged);
    if (!r.ok) {
      const map: Record<string, [number, string]> = {
        busy_user: [409, 'Devam eden bir testin var, bitmesini bekle.'],
        busy_ip: [429, 'Bu bağlantıdan çok fazla test çalışıyor.'],
        capacity: [503, 'Sunucu şu an başka testlerle meşgul (bant sınırı); biraz sonra tekrar dene.'],
        disabled: [503, 'Hat testi bu sunucuda kapalı.'],
        bad_profile: [400, 'Geçersiz profil (patlama testi tek yönlüdür: yukarı ya da aşağı).'],
      };
      const [status, message] = map[r.error] ?? [400, 'Test başlatılamadı.'];
      return sendError(reply, status, r.error, message);
    }
    noStore(reply);
    return {
      token: r.token,
      sid: r.session.sid,
      port: r.port,
      now: Date.now(),
      expiresAt: r.expiresAt,
      transport: body.transport,
      plan: { profile: r.plan.profile, mode: r.plan.mode, seconds: r.plan.seconds, steps: r.plan.steps, durationMs: r.plan.durationMs, totalPackets: r.plan.totalPackets },
      streamLive: lineTest.streamLive(),
    };
  });

  // ---------- TCP karşılaştırması ----------
  app.get('/api/line-test/tcp/down', async (req, reply) => {
    const s = lineTest.sessionOf(tokenOf(req));
    if (!s || s.token.t !== 'tcp' || s.plan.mode === 'up') return sendError(reply, 401, 'unauthorized', 'Oturum jetonu geçersiz.');
    const st = lineTest.tcpState(s.sid);
    if (!st) return sendError(reply, 404, 'not_found', 'Oturum yok.');
    // Her yön oturum başına bir kez: aynı jetonla paralel bağlantı açıp bant sınırını aşmak engellenir
    if (st.downStarted) return sendError(reply, 409, 'busy', 'Bu yön zaten başlatıldı.');
    st.downStarted = true;
    const raw = reply.raw;
    reply.hijack();
    raw.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store, no-transform' });
    const t0 = Date.now();
    let written = 0;
    const cum: number[] = [0];
    for (const p of s.plan.seconds) cum.push((cum[cum.length - 1] ?? 0) + p.pps * p.size);
    const timer = setInterval(() => {
      const t = Date.now() - t0;
      const sec = Math.floor(t / 1000);
      const target =
        sec >= s.plan.seconds.length
          ? (cum[s.plan.seconds.length] ?? 0)
          : (cum[sec] ?? 0) + Math.floor(((s.plan.seconds[sec]!.pps * s.plan.seconds[sec]!.size) * (t - sec * 1000)) / 1000);
      if (!lineTest.server.get(s.sid)) {
        clearInterval(timer);
        raw.destroy();
        return;
      }
      let need = target - written;
      // Yavaş istemcide bellekte birikme olmasın
      while (need > 0 && raw.writableLength < 512 * 1024) {
        const n = Math.min(need, PAD.length);
        raw.write(PAD.subarray(0, n));
        written += n;
        need -= n;
      }
      if (t >= s.plan.durationMs) {
        clearInterval(timer);
        raw.end();
      }
    }, 20);
    raw.on('close', () => clearInterval(timer));
    return reply;
  });

  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_req, payload, done) => done(null, payload));
    scope.post('/api/line-test/tcp/up', async (req, reply) => {
      const s = lineTest.sessionOf(tokenOf(req));
      if (!s || s.token.t !== 'tcp' || s.plan.mode === 'down') return sendError(reply, 401, 'unauthorized', 'Oturum jetonu geçersiz.');
      const st = lineTest.tcpState(s.sid);
      if (!st) return sendError(reply, 404, 'not_found', 'Oturum yok.');
      if (st.upStarted) return sendError(reply, 409, 'busy', 'Bu yön zaten başlatıldı.');
      st.upStarted = true;
      const stream = (req.body as Readable | undefined) ?? req.raw;
      const t0 = Date.now();
      const limit = s.plan.durationMs + 3000;
      st.up = new Array<number>(s.plan.seconds.length).fill(0);
      // Plan hızını aşan gönderim duraklatılır (TCP geri basıncı): istemci daha hızlı yollasa da sunucu o hızda okur
      const cum: number[] = [0];
      for (const p of s.plan.seconds) cum.push((cum[cum.length - 1] ?? 0) + p.pps * p.size);
      const allowedAt = (t: number): number => {
        const sec = Math.floor(t / 1000);
        if (sec >= s.plan.seconds.length) return cum[s.plan.seconds.length] ?? 0;
        const p = s.plan.seconds[sec]!;
        return (cum[sec] ?? 0) + Math.floor((p.pps * p.size * (t - sec * 1000)) / 1000);
      };
      let total = 0;
      await new Promise<void>((resolve) => {
        const stop = setTimeout(() => {
          stream.destroy();
          resolve();
        }, limit);
        stream.on('data', (chunk: Buffer) => {
          if (!lineTest.server.get(s.sid)) {
            stream.destroy();
            return;
          }
          const sec = Math.floor((Date.now() - t0) / 1000);
          if (sec < st.up.length) st.up[sec] = (st.up[sec] ?? 0) + chunk.length;
          total += chunk.length;
          if (total > allowedAt(Date.now() - t0) + 256 * 1024) {
            stream.pause();
            const wake = (): void => {
              if (stream.destroyed) return;
              if (total <= allowedAt(Date.now() - t0) + 128 * 1024) stream.resume();
              else setTimeout(wake, 40);
            };
            setTimeout(wake, 40);
          }
        });
        const done = (): void => {
          clearTimeout(stop);
          resolve();
        };
        stream.on('end', done);
        stream.on('close', done);
        stream.on('error', done);
      });
      return { ok: true };
    });
  });

  // ---------- Bitiş: istemcinin aşağı yön sayımı + sunucunun yukarı yön sayımı ----------
  app.post('/api/line-test/finish', async (req, reply) => {
    const s = lineTest.sessionOf(tokenOf(req));
    if (!s) return sendError(reply, 401, 'unauthorized', 'Oturum jetonu geçersiz ya da süresi dolmuş.');
    const body = parseBody(finishSchema, req.body, reply);
    if (!body) return reply;
    const plan = s.plan;
    // Planlanan ve kayıp değerleri istemciye bırakılmaz: planla birlikte sunucuda hesaplanır
    let down: SecondStat[] | null = null;
    if (body.down && plan.mode !== 'up' && s.token.t === 'udp') {
      down = plan.seconds.map((p, i) => {
        const x = body.down![i];
        const recv = Math.min(x?.recv ?? 0, p.pps);
        return { planned: p.pps, recv, lost: Math.max(0, p.pps - recv), reord: x?.reord ?? 0, dup: x?.dup ?? 0, bytes: x?.bytes ?? 0, jit: x?.jit ?? 0 };
      });
    }
    const run = lineTest.finish(s, down, { up: null, down: body.tcpDown ?? null }, (body.client as ClientContext | undefined) ?? null, body.suite ?? null, body.udpFailed === true);
    if (!run) return sendError(reply, 404, 'not_found', 'Test oturumu bulunamadı.');
    lineTest.markStreamingEnd(run);
    const suite = groupSuites(lineTest.runsOfSuite(run.suite))[0];
    noStore(reply);
    const stats = {
      up: run.up ? stepStats(run.steps, run.up) : null,
      down: run.down ? stepStats(run.steps, run.down, run.downSent) : null,
    };
    return {
      runId: run.id,
      suite: run.suite,
      stats,
      tcpUp: run.tcpUp?.map((x) => x.bytes) ?? null,
      tcpDown: run.tcpDown?.map((x) => x.bytes) ?? null,
      unreachable: run.unreachable ?? false,
      findings: suite?.findings ?? [],
      streaming: run.streaming.start || run.streaming.end,
      // Test sürerken sunucunun gördüğü kesintiler ve API olay döngüsü gecikmesi
      outages: run.outages ?? [],
      loopLag: run.loopLag ?? null,
    };
  });

  // ---------- Yönetim paneli ----------
  app.post('/api/admin/line-test/codes', admin, async (req, reply) => {
    const body = parseBody(adminCodeSchema, req.body, reply);
    if (!body) return reply;
    noStore(reply);
    return lineTest.createCode(body.label, body.hours, body.maxUses, body.admin);
  });

  app.get('/api/admin/line-tests', admin, async (req, reply) => {
    const q = daysQuery.safeParse(req.query);
    if (!q.success) return sendError(reply, 400, 'invalid_query', 'Geçersiz istek.');
    noStore(reply);
    const now = Date.now();
    const since = now - q.data.days * DAY;
    const freezes = ctx.freeze.list(since).map((e) => ({ id: e.id, start: e.start, end: e.end, label: e.label }));
    // Kesinti ilişkisi kesinti kaydından tazelenir (testin bitişinden sonra kayda geçenler de görünsün)
    const suites = groupSuites(lineTest.list(since).map((r) => lineTest.refreshOutages(r)), freezes).slice(0, 80);
    const userIds = [...new Set(suites.map((s) => s.who.userId).filter((id): id is string => !!id))];
    const users: Record<string, { id: string; displayName: string }> = {};
    for (const u of ctx.store.usersByIds(userIds)) users[u.id] = { id: u.id, displayName: u.displayName };
    const channelIds = [...new Set(suites.flatMap((s) => s.runs.flatMap((r: LineRun) => r.streaming.channels)))];
    const channels: Record<string, string> = {};
    for (const id of channelIds) {
      const c = ctx.store.getChannel(id);
      if (c) channels[id] = c.name;
    }
    const s = lineTest.server;
    return {
      now,
      days: q.data.days,
      enabled: lineTest.port !== null,
      port: lineTest.port,
      maxMbps: Math.round(ctx.config.lineTestMaxBps / 1e6),
      adminMaxMbps: Math.round(ctx.config.lineTestAdminMaxBps / 1e6),
      active: s.active,
      reservedMbps: Math.round(s.reservedTotal / 1e5) / 10,
      stats: s.stats,
      streamLive: lineTest.streamLive(),
      // Ayrıntı için her aşamanın adım adım özeti de eklenir (panel hesaplamasın)
      suites: suites.map((su) => ({
        ...su,
        runs: su.runs.map((r) => ({
          ...r,
          stats: {
            up: r.up ? stepStats(r.steps, r.up) : null,
            down: r.down ? stepStats(r.steps, r.down, r.downSent) : null,
          },
        })),
      })),
      groups: syncGroups(suites),
      freezes,
      codes: lineTest.listCodes(),
      users,
      channels,
    };
  });
}
