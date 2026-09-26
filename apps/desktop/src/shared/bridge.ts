// Electron ana süreci, preload ve arayüz arasında paylaşılan IPC tipleri.

export type Keybind =
  | { kind: 'key'; keycode: number; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; label: string }
  | { kind: 'mouse'; button: number; label: string };

export interface HotkeyConfig {
  pushToTalk: Keybind | null;
  toggleMute: Keybind | null;
  toggleDeafen: Keybind | null;
}

export type HotkeyAction = 'pushToTalk' | 'toggleMute' | 'toggleDeafen';

export interface HotkeyEvent {
  action: HotkeyAction;
  /** Yalnızca bas-konuş için anlamlı: tuş basılı mı */
  pressed: boolean;
}

export interface ScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
  appIcon: string | null;
}

export interface ScreenSelection {
  sourceId: string;
  audio: boolean;
}

export interface AppPreferences {
  minimizeToTray: boolean;
  openAtLogin: boolean;
}

export interface TrayState {
  connected: boolean;
  muted: boolean;
  deafened: boolean;
}

export type TrayAction = 'toggleMute' | 'toggleDeafen' | 'disconnect';

/**
 * Güncelleme desteği: auto = indirip kendisi kurar (Windows, Linux), manual = kullanıcı indirme
 * sayfasından kurar (macOS; Apple imzası olmadan kendi kendine güncelleme mümkün değil),
 * none = geliştirme sürümü.
 */
export type UpdateSupport = 'auto' | 'manual' | 'none';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number; transferred: number; total: number }
  | { kind: 'ready'; version: string }
  | { kind: 'installing'; version: string }
  | { kind: 'error'; message: string };

export interface DiskortBridge {
  platform: 'win32' | 'linux' | 'darwin' | string;
  getVersion(): Promise<string>;
  openExternal(url: string): Promise<void>;
  setPreferences(prefs: AppPreferences): Promise<void>;
  setTrayState(state: TrayState): void;
  onTrayAction(cb: (action: TrayAction) => void): () => void;
  /** Pencereyi (tepsiden/küçültülmüşse) öne getirir. */
  showWindow(): void;
  /** Pencere odakta değilse görev çubuğu simgesini yakıp söndürerek dikkat çeker. */
  requestAttention(): void;

  screen: {
    /** Sistem sesi paylaşımı destekleniyor mu (şu an yalnızca Windows) */
    supportsAudio: boolean;
    getSources(): Promise<ScreenSource[]>;
    select(selection: ScreenSelection): Promise<void>;
  };

  hotkeys: {
    available(): Promise<boolean>;
    set(config: HotkeyConfig): Promise<void>;
    /** Bir sonraki tuş/fare tuşunu yakalar; Esc ile iptal edilirse null döner. */
    record(): Promise<Keybind | null>;
    cancelRecord(): Promise<void>;
    onEvent(cb: (event: HotkeyEvent) => void): () => void;
  };

  updates: {
    support: UpdateSupport;
    getState(): Promise<UpdateState>;
    onState(cb: (state: UpdateState) => void): () => void;
    /** Arka planda denetle ve varsa indir (kurulum için yeniden başlatma beklenir). */
    check(): Promise<void>;
    /** Gerekirse indirip hemen kurar; uygulama kapanıp yeni sürümle yeniden açılır. */
    install(): Promise<void>;
  };
}
