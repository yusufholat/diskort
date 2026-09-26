// LiveKit, TURN/TLS için dinlediği portu (5349) istemcilere bildirir. Sunucuda bu port dışarıya kapalıdır;
// TURN/TLS trafiği 443'te Caddy tarafından karşılanıp (SNI: turn alan adı) LiveKit'e iletilir. Böylece yalnızca
// 443'e izin veren ağlardan (okul, yurt, iş yeri) da bağlanılabilir. Bu modül RTCPeerConnection'a verilen
// "turns:...:5349" adreslerini "turns:...:443" olarak düzeltir.

const LIVEKIT_TURN_TLS_PORT = 5349;
const PUBLIC_TURN_TLS_PORT = 443;

function rewriteUrl(url: string): string {
  return url.replace(
    new RegExp(`^(turns:[^:?]+):${LIVEKIT_TURN_TLS_PORT}(?=$|\\?)`),
    `$1:${PUBLIC_TURN_TLS_PORT}`,
  );
}

export function rewriteIceServers(config?: RTCConfiguration): RTCConfiguration | undefined {
  if (!config?.iceServers) return config;
  return {
    ...config,
    iceServers: config.iceServers.map((server) => ({
      ...server,
      urls: Array.isArray(server.urls) ? server.urls.map(rewriteUrl) : rewriteUrl(server.urls),
    })),
  };
}

let installed = false;

export function installTurnPortRewrite(): void {
  if (installed || typeof window === 'undefined' || !window.RTCPeerConnection) return;
  installed = true;
  const Native = window.RTCPeerConnection;
  class DiskortPeerConnection extends Native {
    constructor(config?: RTCConfiguration) {
      super(rewriteIceServers(config));
    }
    override setConfiguration(config?: RTCConfiguration): void {
      super.setConfiguration(rewriteIceServers(config));
    }
  }
  window.RTCPeerConnection = DiskortPeerConnection;
}
