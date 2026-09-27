import { create } from 'zustand';
import type { Attachment, Channel, ChannelType } from '@diskort/shared';

export type Modal =
  | { type: 'settings'; section?: SettingsSection }
  | { type: 'screenPicker' }
  | { type: 'channel'; channel?: Channel; channelType?: ChannelType }
  | { type: 'image'; attachment: Attachment }
  | null;

export type SettingsSection = 'account' | 'voice' | 'stream' | 'keybinds' | 'app' | 'members' | 'invites';

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  /** Sağda soluk gösterilen kısayol (ör. "Ctrl+C") */
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  /** Özel içerik (ör. ses seviyesi kaydırıcısı) veya basit menü öğeleri */
  userId?: string;
  items?: ContextMenuItem[];
}

export interface EmojiPickerAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Emoji seçici: açıldığı öğenin ekrandaki konumu ve seçilince ne yapılacağı */
export interface EmojiPickerState {
  anchor: EmojiPickerAnchor;
  onPick: (emoji: string) => void;
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
  emojiPicker: EmojiPickerState | null;
  toasts: Toast[];
  openModal: (modal: Modal) => void;
  closeModal: () => void;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
  openEmojiPicker: (picker: EmojiPickerState) => void;
  closeEmojiPicker: () => void;
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
  emojiPicker: null,
  toasts: [],
  openModal: (modal) => set({ modal, contextMenu: null, emojiPicker: null }),
  closeModal: () => set({ modal: null }),
  openContextMenu: (contextMenu) => set({ contextMenu, emojiPicker: null }),
  closeContextMenu: () => set({ contextMenu: null }),
  openEmojiPicker: (emojiPicker) => set({ emojiPicker, contextMenu: null }),
  closeEmojiPicker: () => set({ emojiPicker: null }),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, kind }].slice(-4) });
    window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (text: string, kind?: Toast['kind']): void => useUi.getState().toast(text, kind);
