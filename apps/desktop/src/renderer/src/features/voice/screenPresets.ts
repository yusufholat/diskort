import type { ScreenCodec, ScreenPresetId } from '../../stores/settings';

export interface ScreenPreset {
  label: string;
  width: number;
  height: number;
  fps: number;
  /** Üst sınır bit hızı (bps); bant yetmezse WebRTC tıkanıklık denetimi bunun altında kalır */
  bitrate: number;
}

// Akıcılık ve bit hızı öncelikli sabit kaliteler; yayın boyunca hiçbir ayar değişmez (bant yetmezse WebRTC kendi
// içinde düşürür). 1080p60 · 12 Mbps kare başına eski 1080p30 · 6 Mbps kadar veri demek (kullanıcılar onu iyi buldu).
// Simulcast olmadığından izleyicinin indirme hızı da bunu taşımalı; taşımazsa LiveKit o izleyicide yayını duraklatır.
// Sunucu çıkışı ≈ bit hızı × izleyici (aylık ~5 TB kota): 1080p60 izleyici başına saatte en çok ~5,4 GB. 1440p60
// (18 Mbps) sunucuya fazla ağır geldiği için kaldırıldı; en yüksek seçenek 1080p60.
export const SCREEN_PRESETS: Record<ScreenPresetId, ScreenPreset> = {
  '720p60': { label: '720p · 60 FPS', width: 1280, height: 720, fps: 60, bitrate: 6_000_000 },
  '1080p30': { label: '1080p · 30 FPS', width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 },
  '1080p60': { label: '1080p · 60 FPS (önerilen)', width: 1920, height: 1080, fps: 60, bitrate: 12_000_000 },
};

// Donanım kodlaması (ekran kartı): H.264 hemen her kartta; AV1 yeni kartlarda (NVIDIA RTX 40+, AMD RX 7000+,
// Intel Arc). VP8/VP9 NVIDIA ve AMD'de her zaman işlemcide kodlanır. Bkz. hardwareEncoder.ts.
export const SCREEN_CODECS: Record<ScreenCodec, string> = {
  h264: 'H.264 (önerilen; ekran kartı varsa onunla kodlanır)',
  vp9: 'VP9 (işlemciyle kodlanır, daha fazla CPU)',
  vp8: 'VP8 (işlemciyle kodlanır, en uyumlu)',
  av1: 'AV1 (deneysel; yeni ekran kartlarında donanımla, izleyiciye daha ağır)',
};
