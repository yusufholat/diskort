import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { HotkeyConfig } from '../../../shared/bridge';

export type InputMode = 'vad' | 'ptt';
export type NoiseMode = 'rnnoise' | 'standard' | 'off';
export type ScreenPresetId = '720p30' | '1080p30' | '1080p60' | '1440p60';
export type ScreenCodec = 'h264' | 'vp9' | 'vp8' | 'av1';
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
  noise: 'rnnoise',
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

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
    }),
    {
      name: 'diskurt-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ set: _set, ...rest }) => rest,
    },
  ),
);

export const getSettings = (): SettingsStore => useSettings.getState();
