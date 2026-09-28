// Electron ana süreci, preload ve arayüz arasında paylaşılan IPC tipleri.
import type { ThemeId } from './themes';

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

/** Arayüz teması (pencerenin zemin ve başlık çubuğu renkleri buna uyar) */
export type AppTheme = ThemeId;

export interface TrayState {
  connected: boolean;
  muted: boolean;
  deafened: boolean;
}

export type TrayAction = 'toggleMute' | 'toggleDeafen' | 'disconnect';

/** Metin kutusu sağ tık menüsünün komutları (Chromium'un düzenleme komutları) */
export type EditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

/** Biten indirme: kaydedilen dosyanın adı; ok: false ise yarıda kesildi */
export interface DownloadResult {
  name: string;
  ok: boolean;
}

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

/** Diskort penceresinin görüntüsü (geri bildirime eklenir) */
export interface CapturedImage {
  data: Uint8Array;
  type: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

/** Geri bildirimin teknik bilgileri için işletim sistemi */
export interface SystemInfo {
  os: string;
  osVersion: string;
  arch: string;
  electron: string;
}

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
  /** Dosyayı indirir ("Farklı kaydet" penceresi açılır). */
  download(url: string): Promise<void>;
  /** İndirme bitti (kaydetme penceresinde vazgeçilirse çağrılmaz). */
  onDownloadDone(cb: (result: DownloadResult) => void): () => void;
  /** Pencere renklerini temaya uydurur (Windows başlık çubuğu, açılış zemini) ve seçimi saklar. */
  setTheme(theme: AppTheme): void;
  /** Odaktaki metin kutusunda düzenleme komutu (yapıştırma sayfadan izinsiz yapılamaz). */
  edit(command: EditCommand): void;

  /**
   * Bilgisayar boşta mı (~10 dakikadır girdi yok, ekran kilitli ya da uykuda). Bu alanı bilmeyen eski
   * ana süreçte yoktur.
   */
  idle?: {
    get(): Promise<boolean>;
    onChange(cb: (idle: boolean) => void): () => void;
  };

  /**
   * Uygulamayı açan davet bağlantıları (diskort://davet/<kod>). take() bekleyen kodu verir ve ana sürece
   * arayüzün hazır olduğunu bildirir; sonraki bağlantılar onOpen ile gelir. Eski ana süreçte yoktur.
   */
  invites?: {
    take(): Promise<string | null>;
    onOpen(cb: (code: string) => void): () => void;
  };

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

  feedback: {
    /** Yalnızca Diskort penceresinin görüntüsünü alır (masaüstünün değil) */
    capture(): Promise<CapturedImage>;
    systemInfo(): Promise<SystemInfo>;
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
