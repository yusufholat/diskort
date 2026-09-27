import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { HotkeyConfig } from '../../../shared/bridge';

export type InputMode = 'vad' | 'ptt';
export type NoiseMode = 'deepfilter' | 'standard' | 'off';
const SCREEN_PRESET_IDS = ['720p30', '1080p30', '1080p60', '1440p60'] as const;
export type ScreenPresetId = (typeof SCREEN_PRESET_IDS)[number];
const SCREEN_CODEC_IDS = ['h264', 'vp9', 'vp8', 'av1'] as const;
export type ScreenCodec = (typeof SCREEN_CODEC_IDS)[number];
export type ScreenContent = 'motion' | 'detail';

export interface Settings {
  serverUrl: string;

  inputDeviceId: string;
  outputDeviceId: string;
  inputMode: InputMode;
  vadAuto: boolean;
  vadThresholdDb: number;
  pttReleaseMs: number;
  noise: NoiseMode;
  echoCancellation: boolean;
  autoGainControl: boolean;
  audioBitrateKbps: number;

  /** Kişi başı ses seviyesi (0–2), yerel susturma ve yayın sesi seviyesi */
  userVolumes: Record<string, number>;
  localMutes: Record<string, boolean>;
  streamVolumes: Record<string, number>;

  screenPreset: ScreenPresetId;
  screenCodec: ScreenCodec;
  screenContent: ScreenContent;
  shareAudio: boolean;

  hotkeys: HotkeyConfig;
  minimizeToTray: boolean;
  openAtLogin: boolean;
  sounds: boolean;

  selfMute: boolean;
  selfDeaf: boolean;
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
}

export const DEFAULT_SERVER_URL = (import.meta.env.VITE_DEFAULT_SERVER as string | undefined) ?? 'http://localhost:3000';

const defaults: Settings = {
  serverUrl: DEFAULT_SERVER_URL,
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  inputMode: 'vad',
  vadAuto: true,
  vadThresholdDb: -50,
  pttReleaseMs: 150,
  noise: 'deepfilter',
  echoCancellation: true,
  autoGainControl: true,
  audioBitrateKbps: 64,
  userVolumes: {},
  localMutes: {},
  streamVolumes: {},
  screenPreset: '1080p30',
  screenCodec: 'h264',
  screenContent: 'motion',
  shareAudio: true,
  hotkeys: { pushToTalk: null, toggleMute: null, toggleDeafen: null },
  minimizeToTray: true,
  openAtLogin: false,
  sounds: true,
  selfMute: false,
  selfDeaf: false,
};

const NOISE_MODES: readonly NoiseMode[] = ['deepfilter', 'standard', 'off'];
const AUDIO_BITRATES_KBPS = [32, 64, 96, 128] as const;

/** Kayıtlı ayarları geçerli değerlere çeker (eski sürümlerden kalan veya bozuk değerler). */
function sanitize(saved: Partial<Settings>): Partial<Settings> {
  const s = { ...saved };
  // RNNoise kaldırıldı; eski 'rnnoise' seçimi yerini alan DeepFilterNet'e taşınır.
  if (s.noise !== undefined && !NOISE_MODES.includes(s.noise)) s.noise = 'deepfilter';
  if (s.audioBitrateKbps !== undefined && !(AUDIO_BITRATES_KBPS as readonly number[]).includes(s.audioBitrateKbps)) {
    const kbps = Number(s.audioBitrateKbps) || defaults.audioBitrateKbps;
    // En yakın seçenek (eşitlikte yüksek olan)
    s.audioBitrateKbps = AUDIO_BITRATES_KBPS.reduce((best, v) => (Math.abs(v - kbps) <= Math.abs(best - kbps) ? v : best));
  }
  if (s.screenPreset !== undefined && !SCREEN_PRESET_IDS.includes(s.screenPreset)) s.screenPreset = defaults.screenPreset;
  if (s.screenCodec !== undefined && !SCREEN_CODEC_IDS.includes(s.screenCodec)) s.screenCodec = defaults.screenCodec;
  return s;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
    }),
    {
      name: 'diskort-settings',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ set: _set, ...rest }) => rest,
      // Sürüm 1 → 2: gürültü engelleme RNNoise → DeepFilterNet 3 (sanitize içinde)
      migrate: (saved) => saved as Settings,
      merge: (saved, current) => ({ ...current, ...sanitize((saved ?? {}) as Partial<Settings>) }),
    },
  ),
);

export const getSettings = (): SettingsStore => useSettings.getState();
