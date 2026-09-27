import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const RECONCILE_INTERVAL_MS = 30_000;

const config = loadConfig();
const { app, ctx } = await buildApp(config);

// LiveKit ile ses durumunu periyodik eşitle (sunucu yeniden başlarsa / webhook kaçarsa).
async function reconcile(): Promise<void> {
  try {
    ctx.voice.reconcile(await ctx.livekit.snapshot());
    // Eşitlemeyle eklenenlerin (ör. kaçan katılma bildirimi) izinleri de güncel olsun
    await ctx.moderation.enforceAll();
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'LiveKit eşitlemesi başarısız (LiveKit çalışıyor mu?)');
  }
}
const reconcileTimer = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
app.addHook('onClose', async () => clearInterval(reconcileTimer));

await app.listen({ host: config.host, port: config.port });
await reconcile();

const bootstrap = ctx.store.ensureBootstrapInvite();
if (bootstrap) {
  app.log.info('──────────────────────────────────────────────');
  app.log.info(`İlk yönetici davet kodu: ${bootstrap.code}`);
  app.log.info('Uygulamada "Kayıt ol" ekranında bu kodu kullan.');
  app.log.info('──────────────────────────────────────────────');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
