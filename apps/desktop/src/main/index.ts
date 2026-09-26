import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  systemPreferences,
  Tray,
  type DesktopCapturerSource,
} from 'electron';
import type {
  AppPreferences,
  HotkeyConfig,
  ScreenSelection,
  ScreenSource,
  TrayAction,
  TrayState,
} from '../shared/bridge';
import { HotkeyManager } from './hotkeys';
import { initAutoUpdates, installUpdate } from './updater';

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

// Geliştirme sürümü kurulu uygulamayla aynı ayarları/oturumu paylaşmasın (ör. localhost sunucu adresi).
// Aynı makinede birden çok istemci için ayrı profil: DISKORT_PROFILE=2
const profile = process.env.DISKORT_PROFILE;
const suffix = [app.isPackaged ? null : 'dev', profile].filter(Boolean).join('-');
if (suffix) app.setPath('userData', `${app.getPath('userData')}-${suffix}`);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Pencere arka planda/küçültülmüşken ses işleme ve zamanlayıcılar yavaşlamasın.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (isLinux) app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

// Yalnızca geliştirme: otomatik test için hata ayıklama portu ve sahte mikrofon/kamera.
if (!app.isPackaged) {
  if (process.env.DISKORT_DEBUG_PORT) {
    app.commandLine.appendSwitch('remote-debugging-port', process.env.DISKORT_DEBUG_PORT);
  }
  if (process.env.DISKORT_FAKE_MEDIA) {
    app.commandLine.appendSwitch('use-fake-device-for-media-stream');
    app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  }
}

const ALLOWED_PERMISSIONS = new Set([
  'media',
  'display-capture',
  'notifications',
  'speaker-selection',
  'clipboard-sanitized-write',
  'fullscreen',
]);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let preferences: AppPreferences = { minimizeToTray: true, openAtLogin: false };
let trayState: TrayState = { connected: false, muted: false, deafened: false };

const hotkeys = new HotkeyManager((event) => mainWindow?.webContents.send('hotkey', event));

// ---------- Ekran paylaşımı ----------

let lastSources: DesktopCapturerSource[] = [];
let pendingSelection: ScreenSelection | null = null;

async function getScreenSources(): Promise<ScreenSource[]> {
  lastSources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 400, height: 225 },
    fetchWindowIcons: true,
  });
  return lastSources
    .filter((s) => !(mainWindow && s.id === mainWindow.getMediaSourceId()))
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));
}

function setupDisplayMedia(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const selection = pendingSelection;
      pendingSelection = null;
      // Wayland'da kaynak listesi portal ile seçildiği için yeniden sorgulamak yerine önbellek kullanılır.
      const source = selection ? lastSources.find((s) => s.id === selection.sourceId) : undefined;
      if (!source) {
        callback({});
        return;
      }
      // Windows'ta sistem sesi; renderer restrictOwnAudio istediğinde Electron uygulamanın kendi
      // sesini (arkadaşların konuşması) hariç tutar, böylece yankı oluşmaz.
      const withAudio = Boolean(selection?.audio && request.audioRequested && isWindows);
      callback(withAudio ? { video: source, audio: 'loopback' } : { video: source });
    },
    // macOS 15+'da yerel sistem seçicisi kullanılır.
    { useSystemPicker: isMac },
  );
}

// ---------- Pencere ----------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    backgroundColor: '#1e1f22',
    title: 'Diskort',
    icon: join(__dirname, '../../resources/icon.png'),
    autoHideMenuBar: true,
    // Windows'ta Discord gibi özel başlık çubuğu; Linux'ta yerel çerçeve (en uyumlu), macOS'ta gömülü trafik ışıkları.
    ...(isWindows
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#1e1f22', symbolColor: '#b5bac1', height: 30 } }
      : isMac
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 9 } }
        : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('close', (event) => {
    if (!quitting && preferences.minimizeToTray && tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Harici bağlantılar varsayılan tarayıcıda açılır; uygulama içinde yeni pencere açılmaz.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

function showWindow(): void {
  if (!mainWindow) createWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

// ---------- Tepsi (tray) ----------

function sendTrayAction(action: TrayAction): void {
  mainWindow?.webContents.send('tray-action', action);
}

function updateTrayMenu(): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: "Diskort'u Aç", click: showWindow },
    { type: 'separator' },
    {
      label: 'Sustur',
      type: 'checkbox',
      checked: trayState.muted,
      click: () => sendTrayAction('toggleMute'),
    },
    {
      label: 'Sağırlaştır',
      type: 'checkbox',
      checked: trayState.deafened,
      click: () => sendTrayAction('toggleDeafen'),
    },
    {
      label: 'Ses Bağlantısını Kes',
      enabled: trayState.connected,
      click: () => sendTrayAction('disconnect'),
    },
    { type: 'separator' },
    {
      label: "Diskort'tan Çık",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(trayState.connected ? 'Diskort — Sese bağlı' : 'Diskort');
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.on('click', showWindow);
  updateTrayMenu();
}

// ---------- IPC ----------

function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:open-external', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle('app:set-preferences', (_e, prefs: AppPreferences) => {
    preferences = prefs;
    if (!isLinux) app.setLoginItemSettings({ openAtLogin: prefs.openAtLogin });
  });
  ipcMain.on('app:tray-state', (_e, state: TrayState) => {
    trayState = state;
    updateTrayMenu();
  });

  ipcMain.handle('screen:get-sources', () => getScreenSources());
  ipcMain.handle('screen:select', (_e, selection: ScreenSelection) => {
    pendingSelection = selection;
  });

  ipcMain.handle('hotkeys:available', () => hotkeys.available);
  ipcMain.handle('hotkeys:set', (_e, config: HotkeyConfig) => hotkeys.setConfig(config));
  ipcMain.handle('hotkeys:record', () => hotkeys.record());
  ipcMain.handle('hotkeys:cancel-record', () => hotkeys.cancelRecord());

  ipcMain.handle('updates:install', () => {
    quitting = true;
    installUpdate();
  });
}

// ---------- Uygulama yaşam döngüsü ----------

app.on('second-instance', showWindow);

app.on('before-quit', () => {
  quitting = true;
  hotkeys.stop();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', showWindow);

void app.whenReady().then(async () => {
  if (isWindows) app.setAppUserModelId('com.diskort.app');
  Menu.setApplicationMenu(null);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  if (isMac && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
    await systemPreferences.askForMediaAccess('microphone');
  }

  setupDisplayMedia();
  registerIpc();
  await hotkeys.init();
  createWindow();
  createTray();
  if (mainWindow) initAutoUpdates(mainWindow);
});
