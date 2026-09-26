import type { FastifyInstance } from 'fastify';
import { sendError, type AppContext } from '../context.js';
import { PLATFORMS, type Platform } from '../releases.js';

const ALIASES: Record<string, Platform> = {
  linux: 'linux-appimage',
  appimage: 'linux-appimage',
  deb: 'linux-deb',
  mac: 'mac-arm64',
  macos: 'mac-arm64',
  'mac-intel': 'mac-x64',
  apk: 'android',
};

export function registerDownloadRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { releases } = ctx;

  // İndirme sayfasının gösterdiği sürüm/boyut bilgisi
  app.get('/api/download/latest', async (_req, reply) => {
    const latest = await releases.latest();
    if (!latest) return sendError(reply, 503, 'unavailable', 'Sürüm bilgisi şu an alınamıyor.');
    const platforms = Object.fromEntries(
      Object.entries(latest.assets).map(([platform, asset]) => [
        platform,
        { name: asset.name, size: asset.size, href: `/download/${platform}` },
      ]),
    );
    void reply.header('Cache-Control', 'public, max-age=60');
    return { version: latest.version, publishedAt: latest.publishedAt, platforms };
  });

  // Kullanıcıyı GitHub sayfası göstermeden doğrudan dosyaya yönlendirir.
  app.get<{ Params: { platform: string } }>('/download/:platform', async (req, reply) => {
    const key = req.params.platform.toLowerCase();
    const platform = (ALIASES[key] ?? key) as Platform;
    const latest = PLATFORMS.includes(platform) ? await releases.latest() : null;
    const asset = latest?.assets[platform];
    void reply.header('Cache-Control', 'no-store');
    if (!asset) return reply.redirect('/download', 302);
    return reply.redirect(asset.url, 302);
  });
}
