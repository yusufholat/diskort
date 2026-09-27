import type { ScreenCodec, ScreenPresetId } from '../../stores/settings';

export interface ScreenPreset {
  label: string;
  width: number;
  height: number;
  fps: number;
  /** Üst sınır bit hızı (bps); bant yetmezse WebRTC tıkanıklık denetimi bunun altında kalır */
  bitrate: number;
}

// Sunucu çıkışı ≈ bit hızı × izleyici sayısı (aylık ~5 TB kota): 1080p60 izleyici başına saatte en çok ~4,5 GB,
// 1440p60 ~6,8 GB. Hareketsiz ekranda gerçek bit hızı sınırın çok altında kalır. Yayıncının yükleme hızı da
// en az bu kadar olmalı; yetmezse WebRTC kendiliğinden düşürür.
export const SCREEN_PRESETS: Record<ScreenPresetId, ScreenPreset> = {
  '720p30': { label: '720p · 30 FPS', width: 1280, height: 720, fps: 30, bitrate: 3_000_000 },
  '1080p30': { label: '1080p · 30 FPS', width: 1920, height: 1080, fps: 30, bitrate: 6_000_000 },
  '1080p60': { label: '1080p · 60 FPS', width: 1920, height: 1080, fps: 60, bitrate: 10_000_000 },
  '1440p60': { label: '1440p · 60 FPS', width: 2560, height: 1440, fps: 60, bitrate: 15_000_000 },
};

export const SCREEN_CODECS: Record<ScreenCodec, string> = {
  h264: 'H.264 (önerilen; destekleyen sistemde donanımla)',
  vp9: 'VP9 (daha iyi kalite, daha fazla CPU)',
  vp8: 'VP8 (en uyumlu)',
  av1: 'AV1 (deneysel, en verimli)',
};
