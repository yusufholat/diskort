import { create } from 'zustand';
import type { Channel, ChannelType } from '@diskort/shared';

export type Modal =
  | { type: 'settings'; section?: SettingsSection }
  | { type: 'screenPicker' }
  | { type: 'channel'; channel?: Channel; channelType?: ChannelType }
  | null;

export type SettingsSection = 'account' | 'voice' | 'stream' | 'keybinds' | 'app' | 'members' | 'invites';

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

/** Ana alanda gösterilen: bir metin kanalı ya da bağlı olunan ses kanalının sahnesi */
export type View = { kind: 'text'; channelId: string } | { kind: 'voice' } | { kind: 'home' };

interface UiStore {
  view: View;
  /** Ses sahnesinden dönülecek metin kanalı */
  lastTextChannelId: string | null;
  setView: (view: View) => void;
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

const LAST_TEXT_CHANNEL_KEY = 'diskort-last-text-channel';

function storedTextChannel(): string | null {
  try {
    return localStorage.getItem(LAST_TEXT_CHANNEL_KEY);
  } catch {
    return null; // depolama kullanılamıyor
  }
}

const initialTextChannel = storedTextChannel();

export const useUi = create<UiStore>()((set, get) => ({
  view: initialTextChannel ? { kind: 'text', channelId: initialTextChannel } : { kind: 'home' },
  lastTextChannelId: initialTextChannel,
  setView: (view) => {
    if (view.kind !== 'text') {
      set({ view });
      return;
    }
    try {
      localStorage.setItem(LAST_TEXT_CHANNEL_KEY, view.channelId);
    } catch {
      // depolama kullanılamıyor
    }
    set({ view, lastTextChannelId: view.channelId });
  },
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
