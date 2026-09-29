import type { ThermalInfo } from '../../modules/noise-filter';

/**
 * Telefonun ısı durumu (Android PowerManager; noise-filter modülünden okunur): ses kalitesi özetinin cihaz
 * bölümüne yazılır (ısınma tahmini). Eski APK'larda yerel işlev yoktur: alanlar null.
 */

/** PowerManager.THERMAL_STATUS_* sırasıyla (0–6) */
const THERMAL_NAMES = ['none', 'light', 'moderate', 'severe', 'critical', 'emergency', 'shutdown'] as const;

export type ThermalName = (typeof THERMAL_NAMES)[number];

export interface DeviceThermal {
  /** ör. "moderate"; bilinmiyorsa (Android 10 öncesi, eski APK) null */
  thermal: ThermalName | null;
  /** Isınma payı (1,0 = "ciddi" eşiği), iki basamak; bilinmiyorsa null */
  thermalHeadroom: number | null;
}

const UNKNOWN: DeviceThermal = { thermal: null, thermalHeadroom: null };

/** Android'in ısı durumu sayısı → ad; -1 (desteklenmiyor) ya da tanınmayan değer: null */
export function thermalName(status: number | null | undefined): ThermalName | null {
  if (typeof status !== 'number' || !Number.isInteger(status)) return null;
  return THERMAL_NAMES[status] ?? null;
}

/** Isınma payı iki basamağa yuvarlanır; NaN, negatif ya da yoksa null */
export function thermalHeadroom(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

/** Yerel okuma (yoksa undefined: eski APK) hiçbir durumda fırlatmaz */
export function readThermal(read: (() => ThermalInfo) | undefined): DeviceThermal {
  if (typeof read !== 'function') return UNKNOWN;
  try {
    const info = read();
    return { thermal: thermalName(info?.status), thermalHeadroom: thermalHeadroom(info?.headroom) };
  } catch {
    return UNKNOWN;
  }
}
