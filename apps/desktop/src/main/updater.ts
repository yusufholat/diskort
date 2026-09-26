import { app, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Paketlenmiş sürümde güncellemeleri arka planda indirir; hazır olunca arayüze haber verir. */
export function initAutoUpdates(window: BrowserWindow): void {
  if (!app.isPackaged) return;
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    if (!window.isDestroyed()) window.webContents.send('updates:ready', info.version);
  });
  autoUpdater.on('error', (err) => console.warn('Güncelleme hatası:', err.message));

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err: Error) => console.warn('Güncelleme kontrolü başarısız:', err.message));
  };
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}

export function installUpdate(): void {
  electronUpdater.autoUpdater.quitAndInstall(false, true);
}
