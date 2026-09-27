import path from 'node:path';
import { GIF_RATINGS } from './gifs.js';

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  jwtSecret: string;
  /** İstemcilere verilen, dışarıdan erişilebilir LiveKit adresi (ws:// veya wss://) */
  livekitPublicUrl: string;
  /** Sunucunun LiveKit API'sine eriştiği iç adres (http://) */
  livekitApiUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  guildName: string;
  /** İndirme sayfasının sürüm okuduğu GitHub deposu (sahip/ad) */
  githubRepo: string;
  /** En son sürümden eski masaüstü istemcileri reddedilsin mi (üretimde varsayılan: evet) */
  enforceClientVersion: boolean;
  /** Mobil uygulamaların bağlanabilmesi için gereken en düşük sürüm (yoksa kural uygulanmaz) */
  minMobileVersions: { android: string | null; ios: string | null };
  /** Telefon bildirimleri: Firebase hizmet hesabı anahtarının (JSON) yolu; yoksa bildirim gönderilmez */
  fcmServiceAccountFile: string | null;
  /** Tek bir dosya ekinin en büyük boyutu (bayt; ATTACHMENT_MAX_MB, varsayılan 25) */
  attachmentMaxBytes: number;
  /** GIF araması: GIPHY API anahtarı (GIPHY_API_KEY); yoksa GIF düğmesi gösterilmez */
  giphyApiKey: string | null;
  /** GIPHY içerik sınırı (GIPHY_RATING: g, pg, pg-13, r; varsayılan pg-13) */
  giphyRating: string;
  /** GIPHY arama dili (GIPHY_LANG, varsayılan tr) */
  giphyLang: string;
  /** Mesajlardaki bağlantıların önizlemesi (LINK_PREVIEWS=0 kapatır; testlerde varsayılan kapalı) */
  linkPreviews: boolean;
  isDev: boolean;
}

const DEV_JWT_SECRET = 'diskort-dev-jwt-secret-degistir-beni-0123456789';
// infra/livekit.dev.yaml içindeki anahtarla aynı olmalı
const DEV_LIVEKIT_KEY = 'devkey';
const DEV_LIVEKIT_SECRET = 'diskort-dev-livekit-secret-0123456789abcdef';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isDev = env.NODE_ENV !== 'production';

  const required = (name: string, devDefault: string): string => {
    const value = env[name];
    if (value) return value;
    if (isDev) return devDefault;
    throw new Error(`Ortam değişkeni eksik: ${name}`);
  };

  const livekitPublicUrl = required('LIVEKIT_URL', 'ws://localhost:7880');

  const attachmentMaxMb = Number(env.ATTACHMENT_MAX_MB || 25);
  if (!Number.isFinite(attachmentMaxMb) || attachmentMaxMb <= 0) {
    throw new Error(`Geçersiz ATTACHMENT_MAX_MB: ${env.ATTACHMENT_MAX_MB}`);
  }

  const giphyRating = (env.GIPHY_RATING || 'pg-13').toLowerCase();
  if (!(GIF_RATINGS as readonly string[]).includes(giphyRating)) {
    throw new Error(`Geçersiz GIPHY_RATING: ${env.GIPHY_RATING} (g, pg, pg-13 ya da r)`);
  }
  const giphyLang = (env.GIPHY_LANG || 'tr').toLowerCase();
  if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(giphyLang)) throw new Error(`Geçersiz GIPHY_LANG: ${env.GIPHY_LANG}`);

  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 3000),
    dataDir: path.resolve(env.DATA_DIR ?? 'data'),
    jwtSecret: required('JWT_SECRET', DEV_JWT_SECRET),
    livekitPublicUrl,
    livekitApiUrl: env.LIVEKIT_API_URL ?? livekitPublicUrl.replace(/^ws/, 'http'),
    livekitApiKey: required('LIVEKIT_API_KEY', DEV_LIVEKIT_KEY),
    livekitApiSecret: required('LIVEKIT_API_SECRET', DEV_LIVEKIT_SECRET),
    guildName: env.GUILD_NAME ?? 'Diskort',
    githubRepo: env.GITHUB_REPO ?? 'yusufholat/diskort',
    enforceClientVersion: env.CLIENT_UPDATE_ENFORCE ? env.CLIENT_UPDATE_ENFORCE !== '0' : !isDev,
    minMobileVersions: { android: env.MIN_ANDROID_VERSION || null, ios: env.MIN_IOS_VERSION || null },
    fcmServiceAccountFile: env.FCM_SERVICE_ACCOUNT_FILE || null,
    attachmentMaxBytes: Math.floor(attachmentMaxMb * 1024 * 1024),
    giphyApiKey: env.GIPHY_API_KEY?.trim() || null,
    giphyRating,
    giphyLang,
    linkPreviews: env.LINK_PREVIEWS ? env.LINK_PREVIEWS !== '0' : env.NODE_ENV !== 'test',
    isDev,
  };
}
