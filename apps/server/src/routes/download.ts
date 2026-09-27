import type { FastifyInstance } from 'fastify';
import { sendError, type AppContext } from '../context.js';
import { PLATFORMS, versionInName, type Platform } from '../releases.js';

const ALIASES: Record<string, Platform> = {
  linux: 'linux-appimage',
  appimage: 'linux-appimage',
  deb: 'linux-deb',
  mac: 'mac-arm64',
  macos: 'mac-arm64',
  'mac-intel': 'mac-x64',
  apk: 'android',
  iphone: 'ios',
  ipa: 'ios',
};

const xml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * iOS'un "itms-services" kurulumunun okuduğu bildirim: IPA'nın adresi, paket kimliği ve sürümü.
 * Yalnızca UDID'si Ad Hoc profilinde kayıtlı cihazlara kurulur (bkz. docs/ios.md).
 */
export function iosInstallManifest(ipaUrl: string, bundleId: string, version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${xml(ipaUrl)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${xml(bundleId)}</string>
        <key>bundle-version</key>
        <string>${xml(version)}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>Diskort</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

export function registerDownloadRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { releases, config } = ctx;

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

  // Uygulama içi "Yenilikler" sayfası: son sürümlerin notları (giriş gerekmez, herkese açık bilgi)
  app.get('/api/releases', async (_req, reply) => {
    void reply.header('Cache-Control', 'public, max-age=300');
    return { releases: await releases.recentNotes() };
  });

  // iOS kurulum bildirimi (itms-services://?action=download-manifest&url=<bu adres>). IPA yoksa 404.
  app.get('/download/ios/manifest.plist', async (_req, reply) => {
    const asset = (await releases.latest())?.assets.ios;
    void reply.header('Cache-Control', 'no-store');
    if (!asset) return sendError(reply, 404, 'not_found', 'iOS sürümü henüz yok.');
    const version = versionInName(asset.name) ?? '0.0.0';
    return reply.type('application/xml').send(iosInstallManifest(asset.url, config.iosBundleId, version));
  });

  // Kullanıcıyı GitHub sayfası göstermeden doğrudan dosyaya yönlendirir.
  // iOS'ta dosyanın kendisi işe yaramaz: iPhone'un kurulum penceresini açan bağlantıya yönlendirilir.
  app.get<{ Params: { platform: string } }>('/download/:platform', async (req, reply) => {
    const key = req.params.platform.toLowerCase();
    const platform = (ALIASES[key] ?? key) as Platform;
    const latest = PLATFORMS.includes(platform) ? await releases.latest() : null;
    const asset = latest?.assets[platform];
    void reply.header('Cache-Control', 'no-store');
    if (!asset) return reply.redirect('/download', 302);
    if (platform === 'ios') {
      const manifest = `${req.protocol}://${req.host}/download/ios/manifest.plist`;
      return reply.redirect(`itms-services://?action=download-manifest&url=${encodeURIComponent(manifest)}`, 302);
    }
    return reply.redirect(asset.url, 302);
  });
}
