import type { FastifyInstance } from 'fastify';
import { parsePlatform } from '../clientVersion.js';
import { sendError, type AppContext } from '../context.js';

const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** electron-updater'ın kanal dosyaları: latest.yml (Windows), latest-linux.yml, latest-mac.yml */
const CHANNEL_FILE = /^latest(?:-linux(?:-arm64)?|-mac)?\.yml$/;
/** Kurulum dosyaları ve blockmap'ler adlarında sürümü taşır: Diskort-Setup-1.2.3.exe(.blockmap) */
const VERSIONED_FILE = /(?:^|[-_])v?(\d+\.\d+\.\d+)(?=[-_.])/;

/**
 * Masaüstü uygulamasının güncelleme kaynağı: https://<alan-adı>/updates/
 * Uygulama yalnızca bu adresi bilir; dosyalar şimdilik GitHub Releases'te durur ve buradan oraya
 * yönlendirilir. Dağıtım yeri değişirse yalnızca bu dosya değişir, kurulu uygulamalar etkilenmez.
 */
export function registerUpdateRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, releases, clientVersions } = ctx;
  const base = `https://github.com/${config.githubRepo}/releases`;

  app.get<{ Params: { file: string } }>('/updates/:file', async (req, reply) => {
    const { file } = req.params;
    if (!SAFE_FILE.test(file)) return sendError(reply, 404, 'not_found', 'Dosya bulunamadı.');

    if (CHANNEL_FILE.test(file)) {
      // Her zaman en son yayınlanan sürümün kanal dosyası (taslak sürümler görünmez)
      void reply.header('Cache-Control', 'no-store');
      return reply.redirect(`${base}/latest/download/${file}`, 302);
    }

    const version = VERSIONED_FILE.exec(file)?.[1];
    if (!version) return sendError(reply, 404, 'not_found', 'Dosya bulunamadı.');
    // Sürümlü dosyalar değişmez; eski sürümün blockmap'i de (fark indirme) buradan bulunur
    void reply.header('Cache-Control', 'public, max-age=3600');
    return reply.redirect(`${base}/download/v${version}/${file}`, 302);
  });

  // İstemcinin "güncel miyim?" sorusu (?platform=desktop|android|ios; varsayılan masaüstü)
  app.get<{ Querystring: { platform?: string } }>('/api/client/version', async (req, reply) => {
    const platform = parsePlatform(req.query.platform);
    const [release, required] = await Promise.all([releases.latest(), clientVersions.required(platform)]);
    // Mobil için "en son" yalnızca o sürümde bu platformun paketi varsa geçerlidir
    const hasPackage = platform === 'desktop' || (platform === 'android' && Boolean(release?.assets.android));
    void reply.header('Cache-Control', 'no-store');
    return { platform, latest: (hasPackage ? release?.version : null) ?? required, required };
  });
}
