// TURN/TLS trafiği 443'te Caddy tarafından karşılanıp (SNI: turn alan adı) LiveKit'in 5349'daki dinleyicisine
// iletilir; 5349 dışarıya kapalıdır. Böylece yalnızca 443'e izin veren ağlardan da (okul, yurt, iş yeri) bağlanılır.
// LiveKit 1.13 external_tls modunda istemcilere zaten "turns:<alan adı>:443" bildiriyor (canlıda ölçüldü).
// Belgesi ise tls_port'un (5349) bildirileceğini söylüyor; ileride o davranışa dönülürse bağlantı sessizce
// bozulmasın diye bu modül "turns:...:5349" adreslerini "turns:...:443" olarak düzeltir.

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
