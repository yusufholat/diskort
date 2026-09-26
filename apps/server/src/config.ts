import path from 'node:path';

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
    isDev,
  };
}
