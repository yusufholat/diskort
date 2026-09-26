import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { AuthService } from './auth.js';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { Store } from './db.js';
import { Gateway } from './gateway.js';
import { LiveKitService } from './livekit.js';
import { VoiceStateStore } from './voiceState.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerVoiceRoutes } from './routes/voice.js';

export interface BuildOptions {
  /** Testler için ':memory:' verilebilir. */
  dbFile?: string;
  logger?: boolean;
  livekit?: LiveKitService;
}

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
  const auth = new AuthService(config.jwtSecret, store);
  const voice = new VoiceStateStore();
  const livekit = opts.livekit ?? new LiveKitService(config);
  const gateway = new Gateway(store, auth, voice, guild);
  const ctx: AppContext = { config, store, auth, voice, livekit, gateway, guild };

  app.decorateRequest('user', null as never);
  app.addHook('onClose', async () => store.close());

  // Masaüstü istemcisi file:// veya localhost kökeninden bağlanır; kimlik jetonla taşınır.
  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  app.get('/api/health', async () => ({ ok: true }));
  gateway.register(app);
  registerAuthRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerVoiceRoutes(app, ctx);

  return { app, ctx };
}
