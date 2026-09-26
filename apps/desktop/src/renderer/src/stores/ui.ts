import { create } from 'zustand';
import type { Channel } from '@diskurt/shared';

export type Modal =
  | { type: 'settings'; section?: SettingsSection }
  | { type: 'screenPicker' }
  | { type: 'channel'; channel?: Channel }
  | null;

export type SettingsSection = 'account' | 'voice' | 'stream' | 'keybinds' | 'app' | 'invites';

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  /** Özel içerik (ör. ses seviyesi kaydırıcısı) veya basit menü öğeleri */
  userId?: string;
  items?: ContextMenuItem[];
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

interface UiStore {
  modal: Modal;
  contextMenu: ContextMenuState | null;
  toasts: Toast[];
  openModal: (modal: Modal) => void;
  closeModal: () => void;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useUi = create<UiStore>()((set, get) => ({
  modal: null,
  contextMenu: null,
  toasts: [],
  openModal: (modal) => set({ modal, contextMenu: null }),
  closeModal: () => set({ modal: null }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, kind }].slice(-4) });
    window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (text: string, kind?: Toast['kind']): void => useUi.getState().toast(text, kind);
