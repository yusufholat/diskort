// Kablosuz (OTA) güncelleme paketini hazırlar: `expo export` çıktısından Expo Updates protokolünün
// (https://docs.expo.dev/technical-specs/expo-updates-1/) bildirimini (manifest) üretir ve imzalar.
//
//   node scripts/ota-manifest.mjs --dist <expo export klasörü> --out <çıktı klasörü>
//     --version 0.2.1 --runtime native-… --config <expo config --json çıktısı> --base-url https://…/updates
//     [--platform android|ios]   (varsayılan android)
//   İmza anahtarı: OTA_SIGNING_KEY ortam değişkeni (PEM ya da PEM'in base64'ü)
//
// Çıktı: sürüme yüklenecek dosyalar
//   Diskort-<sürüm>-ota-<platform>.json   bildirim + imzası (sunucu bunu okuyup telefona iletir)
//   Diskort-<sürüm>-ota-<md5><uzantı>     JavaScript paketi ve resim/yazı tipi dosyaları
// Dosya adlarındaki sürüm, sunucunun /updates/<dosya> yönlendirmesinin doğru sürümü bulmasını sağlar.
import { createHash, createSign, createVerify } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    dist: { type: 'string' },
    out: { type: 'string' },
    version: { type: 'string' },
    runtime: { type: 'string' },
    config: { type: 'string' },
    'base-url': { type: 'string' },
    platform: { type: 'string', default: 'android' },
  },
});
for (const name of ['dist', 'out', 'version', 'runtime', 'config', 'base-url']) {
  if (!args[name]) throw new Error(`--${name} gerekli`);
}

const PLATFORM = args.platform;
if (PLATFORM !== 'android' && PLATFORM !== 'ios') throw new Error(`Geçersiz --platform: ${PLATFORM}`);
const prefix = `Diskort-${args.version}-ota`;
const baseUrl = args['base-url'].replace(/\/+$/, '');

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  xml: 'application/xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  json: 'application/json',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

const hash = (data, algorithm, encoding) => createHash(algorithm).update(data).digest(encoding);

mkdirSync(args.out, { recursive: true });

/** Dosyayı yükleme adıyla kopyalar, bildirimdeki kaydını döner. */
function asset(relativePath, ext, isLaunchAsset) {
  const data = readFileSync(join(args.dist, ...relativePath.split(/[\\/]/)));
  const key = hash(data, 'md5', 'hex');
  const fileExtension = isLaunchAsset ? '.bundle' : `.${ext}`;
  const fileName = `${prefix}-${key}${fileExtension}`;
  copyFileSync(join(args.dist, ...relativePath.split(/[\\/]/)), join(args.out, fileName));
  return {
    // İstemci indirdiği dosyanın SHA-256'sını bununla karşılaştırır
    hash: hash(data, 'sha256', 'base64url'),
    key,
    fileExtension,
    contentType: isLaunchAsset ? 'application/javascript' : (CONTENT_TYPES[ext] ?? 'application/octet-stream'),
    url: `${baseUrl}/${fileName}`,
  };
}

const metadataRaw = readFileSync(join(args.dist, 'metadata.json'));
const files = JSON.parse(metadataRaw).fileMetadata[PLATFORM];
if (!files) throw new Error(`${args.dist}/metadata.json içinde ${PLATFORM} yok`);

const expoClient = JSON.parse(readFileSync(args.config, 'utf8'));
if (expoClient.version !== args.version) {
  throw new Error(`Uygulama yapılandırmasındaki sürüm (${expoClient.version}) ile --version (${args.version}) farklı`);
}
if (expoClient.runtimeVersion !== args.runtime) {
  throw new Error(`Uygulama yapılandırmasındaki runtimeVersion (${expoClient.runtimeVersion}) ile --runtime farklı`);
}

// Aynı içerik her zaman aynı kimliği alır (derleme yeniden çalışırsa telefonlar aynı güncellemeyi tekrar indirmez)
const idHash = createHash('sha256')
  .update(metadataRaw)
  .update(JSON.stringify(expoClient))
  .update(args.runtime)
  .digest('hex');
const id = `${idHash.slice(0, 8)}-${idHash.slice(8, 12)}-4${idHash.slice(13, 16)}-${((parseInt(idHash[16], 16) & 0x3) | 0x8).toString(16)}${idHash.slice(17, 20)}-${idHash.slice(20, 32)}`;

const manifest = {
  id,
  createdAt: new Date().toISOString(),
  runtimeVersion: args.runtime,
  launchAsset: asset(files.bundle, null, true),
  assets: files.assets.map((a) => asset(a.path, a.ext, false)),
  metadata: {},
  extra: { expoClient },
};
const manifestString = JSON.stringify(manifest);

// Telefon, bildirimi uygulamanın içindeki sertifikayla (certs/certificate.pem) doğrular:
// imzası tutmayan bildirim reddedilir, böylece sunucuya sızan biri kod gönderemez.
const rawKey = process.env.OTA_SIGNING_KEY?.trim();
if (!rawKey) throw new Error('OTA_SIGNING_KEY yok');
const privateKey = rawKey.startsWith('-----BEGIN') ? rawKey : Buffer.from(rawKey, 'base64').toString('utf8');
const signature = createSign('RSA-SHA256').update(manifestString, 'utf8').sign(privateKey, 'base64');

const certificate = readFileSync(new URL('../certs/certificate.pem', import.meta.url), 'utf8');
if (!createVerify('RSA-SHA256').update(manifestString, 'utf8').verify(certificate, signature, 'base64')) {
  throw new Error('İmza, uygulamadaki sertifikayla doğrulanamadı: OTA_SIGNING_KEY yanlış anahtar');
}

writeFileSync(
  join(args.out, `${prefix}-${PLATFORM}.json`),
  JSON.stringify({ platform: PLATFORM, version: args.version, runtimeVersion: args.runtime, manifest: manifestString, signature }),
);

const size = [manifest.launchAsset, ...manifest.assets].length;
console.log(`${prefix}: ${size} dosya, güncelleme kimliği ${id}, runtime ${args.runtime}`);
