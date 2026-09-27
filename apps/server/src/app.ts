import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { AttachmentService } from './attachments.js';
import { AvatarService } from './avatars.js';
import { AuthService } from './auth.js';
import { ClientVersionPolicy } from './clientVersion.js';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { Store } from './db.js';
import { Gateway } from './gateway.js';
import { LiveKitService } from './livekit.js';
import { OtaService } from './ota.js';
import { PermissionService } from './permissions.js';
import { PushService } from './push.js';
import { ReleaseService } from './releases.js';
import { VoiceModeration } from './voiceModeration.js';
import { VoiceStateStore } from './voiceState.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAttachmentRoutes } from './routes/attachments.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAvatarRoutes } from './routes/avatars.js';
import { registerDownloadRoutes } from './routes/download.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerRoleRoutes } from './routes/roles.js';
import { registerUpdateRoutes } from './routes/updates.js';
import { registerVoiceRoutes } from './routes/voice.js';

export interface BuildOptions {
  /** Testler için ':memory:' verilebilir. */
  dbFile?: string;
  logger?: boolean;
  livekit?: LiveKitService;
  releases?: ReleaseService;
  push?: PushService;
  /** Testler için sahte GitHub indirmesi */
  otaFetch?: typeof fetch;
  /** Dosya eklerinin klasörü (varsayılan: <DATA_DIR>/attachments) */
  attachmentsDir?: string;
  /** Profil fotoğraflarının klasörü (varsayılan: <DATA_DIR>/avatars) */
  avatarsDir?: string;
}

/** Süresi geçmiş yüklemelerin ve artık dosyaların temizlenme aralığı */
const ATTACHMENT_SWEEP_INTERVAL_MS = 10 * 60_000;

export async function buildApp(
  config: Config,
  opts: BuildOptions = {},
): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  const store = new Store(opts.dbFile ?? path.join(config.dataDir, 'diskort.db'));
  const guild = store.ensureGuild(config.guildName);
  const permissions = new PermissionService(store);
  const auth = new AuthService(config.jwtSecret, store, permissions);
  const voice = new VoiceStateStore();
  const livekit = opts.livekit ?? new LiveKitService(config);
  const releases = opts.releases ?? new ReleaseService(config.githubRepo);
  const clientVersions = new ClientVersionPolicy(releases, config.enforceClientVersion, config.minMobileVersions);
  const gateway = new Gateway(store, auth, voice, guild, permissions, clientVersions, config.attachmentMaxBytes);
  const moderation = new VoiceModeration(store, voice, livekit, permissions, gateway);
  const push = opts.push ?? new PushService(store, config.fcmServiceAccountFile, app.log);
  const ota = new OtaService(releases, app.log, opts.otaFetch);
  const attachments = new AttachmentService(
    store,
    opts.attachmentsDir ?? path.join(config.dataDir, 'attachments'),
    config.attachmentMaxBytes,
    app.log,
  );
  const avatars = new AvatarService(store, opts.avatarsDir ?? path.join(config.dataDir, 'avatars'), app.log);
  const ctx: AppContext = {
    config,
    store,
    auth,
    voice,
    livekit,
    gateway,
    releases,
    clientVersions,
    ota,
    push,
    attachments,
    avatars,
    permissions,
    moderation,
    guild,
  };

  const sweep = (): void => {
    attachments.sweep().catch((err: unknown) => app.log.warn({ err: String(err) }, 'dosya eki temizliği başarısız'));
    avatars.sweep().catch((err: unknown) => app.log.warn({ err: String(err) }, 'profil fotoğrafı temizliği başarısız'));
  };
  const sweepTimers = [setTimeout(sweep, 60_000), setInterval(sweep, ATTACHMENT_SWEEP_INTERVAL_MS)];
  for (const timer of sweepTimers) timer.unref();
  app.addHook('onClose', async () => sweepTimers.forEach((timer) => clearTimeout(timer)));

  // Yeni sürüm yayınlanınca bağlı istemciler arka planda indirmeye başlasın
  releases.onNewRelease((release) => gateway.broadcast({ t: 'UPDATE_AVAILABLE', d: { version: release.version } }));
  if (!config.isDev) releases.startPolling();
  app.addHook('onClose', async () => releases.stopPolling());

  app.decorateRequest('user', null as never);
  app.addHook('onClose', async () => store.close());

  // Masaüstü istemcisi file:// veya localhost kökeninden bağlanır; kimlik jetonla taşınır.
  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  app.get('/api/health', async () => ({ ok: true }));
  gateway.register(app);
  registerAuthRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerVoiceRoutes(app, ctx);
  registerDownloadRoutes(app, ctx);
  registerMessageRoutes(app, ctx);
  registerRoleRoutes(app, ctx);
  registerAttachmentRoutes(app, ctx);
  registerAvatarRoutes(app, ctx);
  registerUpdateRoutes(app, ctx);

  return { app, ctx };
}
