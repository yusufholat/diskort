import { volumeSummary } from '@diskort/client-core';
import type { TelemetryVoiceSettings } from '@diskort/shared';
import type { getSettings } from '../stores/settings';

/**
 * Ses kalitesi özetine eklenen kayıtlı ses ayarları (sesi bozabilecekler). Kişi başı ses seviyelerinden
 * yalnızca %100'den farklı olanların sayısı ve en yükseği gider; kullanıcı kimliği gönderilmez.
 */
export function voiceSettingsTelemetry(s: ReturnType<typeof getSettings>): TelemetryVoiceSettings {
  return {
    echoCancellation: s.echoCancellation,
    autoGainControl: s.autoGainControl,
    voiceActivity: s.voiceActivity,
    vadAuto: s.vadAuto,
    vadThresholdDb: s.vadThresholdDb,
    noiseMode: s.noiseMode,
    noiseStrengthDb: s.noiseStrengthDb,
    speaker: s.speaker,
    ...volumeSummary(s.userVolumes),
  };
}
