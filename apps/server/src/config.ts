import path from 'node:path';
import { GIF_RATINGS } from './gifs.js';
import { parseDevicesKey } from './iosDevicesCrypto.js';

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
  /** En son sürümden eski istemciler (masaüstü ve telefon) reddedilsin mi (üretimde varsayılan: evet) */
  enforceClientVersion: boolean;
  /** Mobil uygulamaların bağlanabilmesi için gereken en düşük sürüm (yoksa kural uygulanmaz) */
  minMobileVersions: { android: string | null; ios: string | null };
  /** Telefon bildirimleri: Firebase hizmet hesabı anahtarının (JSON) yolu; yoksa bildirim gönderilmez */
  fcmServiceAccountFile: string | null;
  /** iOS paket kimliği (IOS_BUNDLE_ID, varsayılan com.diskort.app) */
  iosBundleId: string;
  /** iOS bildirimleri: Apple'ın APNs anahtarı (APNS_KEY_FILE .p8, APNS_KEY_ID, APNS_TEAM_ID); yoksa kapalı */
  apns: { keyFile: string; keyId: string; teamId: string; sandbox: boolean } | null;
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
  /**
   * Yönetim paneli için düzenli sistem ölçümü (CPU, bellek, ağ; 5 sn) ve kalıcı sayaçlar (<DATA_DIR>/traffic.json,
   * activity.json). SYSTEM_STATS=0 kapatır; testlerde varsayılan kapalı (panel yine istek anında ölçer).
   */
  systemStats: boolean;
  /** Makine bilgilerinin okunduğu /proc kökü (PROC_ROOT, varsayılan /proc) */
  procRoot: string;
  /** Aylık trafik kotası, bayt (TRAFFIC_QUOTA_GB, varsayılan 5000 GB = 5 TB; gelen + giden) */
  trafficQuotaBytes: number;
  /**
   * LiveKit'in Prometheus ölçüm adresi (LIVEKIT_METRICS_URL; üretimde varsayılan http://127.0.0.1:6789/metrics,
   * livekit.yaml'daki `prometheus.port` ile). "0" kapatır. Uç kapalıysa panel "metrikler kapalı" gösterir.
   */
  livekitMetricsUrl: string | null;
  /** Caddy yönetim ucunun ölçümleri (CADDY_METRICS_URL; üretimde varsayılan http://127.0.0.1:2019/metrics) */
  caddyMetricsUrl: string | null;
  /** Veritabanı yedeklerinin salt okunur bağlandığı klasör (BACKUP_DIR, ör. /backups); yoksa panelde görünmez */
  backupDir: string | null;
  /** Sertifika bitiş tarihi denetlenecek alan adları (TLS_CHECK_DOMAINS, virgülle) ve bağlanılacak adres */
  tlsCheckDomains: string[];
  tlsCheckHost: string;
  /** API kapsayıcısının cgroup kökü (CGROUP_ROOT, varsayılan /sys/fs/cgroup; kapsayıcının kendi görünümü) */
  cgroupRoot: string;
  /**
   * iPhone cihaz onayında Ad Hoc IPA'yı otomatik derletmek için GitHub ince taneli erişim belirteci
   * (GITHUB_DISPATCH_TOKEN; yalnızca bu depoda Actions: write). Yoksa panel elle çalıştırılacak komutu gösterir.
   */
  githubDispatchToken: string | null;
  /** Onaylar toplanıp tek derleme başlatılmadan önce beklenen süre (IOS_DISPATCH_DELAY_SEC, varsayılan 180) */
  iosDispatchDelayMs: number;
  /** Cihaz listesini iş akışına şifreli göndermek için AES-256-GCM anahtarı (IOS_DEVICES_KEY, 32 bayt base64) */
  iosDevicesKey: Buffer | null;
  /** Günlük sayaçların ve ses kalitesi dosyalarının günü: UTC'ye göre dakika (STATS_UTC_OFFSET_MIN, varsayılan 180) */
  statsUtcOffsetMin: number;
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

  const trafficQuotaGb = Number(env.TRAFFIC_QUOTA_GB || 5000);
  if (!Number.isFinite(trafficQuotaGb) || trafficQuotaGb <= 0) {
    throw new Error(`Geçersiz TRAFFIC_QUOTA_GB: ${env.TRAFFIC_QUOTA_GB}`);
  }

  const statsOffset = Number(env.STATS_UTC_OFFSET_MIN ?? 180);
  if (!Number.isInteger(statsOffset) || Math.abs(statsOffset) > 14 * 60) {
    throw new Error(`Geçersiz STATS_UTC_OFFSET_MIN: ${env.STATS_UTC_OFFSET_MIN}`);
  }
  const iosDispatchDelaySec = Number(env.IOS_DISPATCH_DELAY_SEC ?? 180);
  if (!Number.isFinite(iosDispatchDelaySec) || iosDispatchDelaySec < 0 || iosDispatchDelaySec > 3600) {
    throw new Error(`Geçersiz IOS_DISPATCH_DELAY_SEC: ${env.IOS_DISPATCH_DELAY_SEC}`);
  }
  const production = env.NODE_ENV === 'production';
  /** Adres ortam değişkeni: verilmemişse üretimde varsayılan, "0" ya da boş: kapalı */
  const optionalUrl = (value: string | undefined, prodDefault: string): string | null => {
    if (value === undefined) return production ? prodDefault : null;
    return value && value !== '0' ? value : null;
  };
  const livekitHost = /^wss:\/\/([^/:?#]+)/.exec(livekitPublicUrl)?.[1] ?? null;

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
    // iOS paket kimliği: Ad Hoc kurulum bildirimi (manifest.plist) ve APNs konusu (apns-topic)
    iosBundleId: env.IOS_BUNDLE_ID || 'com.diskort.app',
    // iOS bildirimleri doğrudan Apple'a (APNs) gider. Anahtar (.p8) yoksa kapalı; bkz. docs/ios.md
    apns:
      env.APNS_KEY_FILE && env.APNS_KEY_ID && env.APNS_TEAM_ID
        ? {
            keyFile: env.APNS_KEY_FILE,
            keyId: env.APNS_KEY_ID,
            teamId: env.APNS_TEAM_ID,
            // Ad Hoc ve App Store imzalı uygulamalar üretim ortamını kullanır; Xcode'dan kurulan geliştirme
            // derlemeleri için APNS_SANDBOX=1
            sandbox: env.APNS_SANDBOX === '1',
          }
        : null,
    attachmentMaxBytes: Math.floor(attachmentMaxMb * 1024 * 1024),
    giphyApiKey: env.GIPHY_API_KEY?.trim() || null,
    giphyRating,
    giphyLang,
    linkPreviews: env.LINK_PREVIEWS ? env.LINK_PREVIEWS !== '0' : env.NODE_ENV !== 'test',
    systemStats: env.SYSTEM_STATS ? env.SYSTEM_STATS !== '0' : env.NODE_ENV !== 'test',
    procRoot: env.PROC_ROOT || '/proc',
    trafficQuotaBytes: Math.round(trafficQuotaGb * 1e9),
    livekitMetricsUrl: optionalUrl(env.LIVEKIT_METRICS_URL, 'http://127.0.0.1:6789/metrics'),
    caddyMetricsUrl: optionalUrl(env.CADDY_METRICS_URL, 'http://127.0.0.1:2019/metrics'),
    backupDir: env.BACKUP_DIR || null,
    tlsCheckDomains: env.TLS_CHECK_DOMAINS
      ? [...new Set(env.TLS_CHECK_DOMAINS.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean))]
      : production && livekitHost
        ? [livekitHost]
        : [],
    tlsCheckHost: env.TLS_CHECK_HOST || '127.0.0.1',
    cgroupRoot: env.CGROUP_ROOT || '/sys/fs/cgroup',
    githubDispatchToken: env.GITHUB_DISPATCH_TOKEN?.trim() || null,
    iosDispatchDelayMs: Math.round(iosDispatchDelaySec * 1000),
    iosDevicesKey: parseDevicesKey(env.IOS_DEVICES_KEY),
    statsUtcOffsetMin: statsOffset,
    isDev,
  };
}
