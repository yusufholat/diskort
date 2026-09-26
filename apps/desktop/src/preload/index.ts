import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DiskurtBridge, HotkeyEvent, TrayAction } from '../shared/bridge';

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge: DiskurtBridge = {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  setPreferences: (prefs) => ipcRenderer.invoke('app:set-preferences', prefs),
  setTrayState: (state) => ipcRenderer.send('app:tray-state', state),
  onTrayAction: (cb) => listen<TrayAction>('tray-action', cb),

  screen: {
    supportsAudio: process.platform === 'win32',
    getSources: () => ipcRenderer.invoke('screen:get-sources'),
    select: (selection) => ipcRenderer.invoke('screen:select', selection),
  },

  hotkeys: {
    available: () => ipcRenderer.invoke('hotkeys:available'),
    set: (config) => ipcRenderer.invoke('hotkeys:set', config),
    record: () => ipcRenderer.invoke('hotkeys:record'),
    cancelRecord: () => ipcRenderer.invoke('hotkeys:cancel-record'),
    onEvent: (cb) => listen<HotkeyEvent>('hotkey', cb),
  },

  updates: {
    onReady: (cb) => listen<string>('updates:ready', cb),
    install: () => ipcRenderer.invoke('updates:install'),
  },
};

contextBridge.exposeInMainWorld('diskurt', bridge);
