import { create } from 'zustand';
import type { Attachment, Channel, ChannelType, User } from '@diskort/shared';

export type Modal =
  | { type: 'settings'; section?: SettingsSection }
  | { type: 'serverSettings'; section?: ServerSettingsSection }
  | { type: 'screenPicker' }
  | { type: 'channel'; channel?: Channel; channelType?: ChannelType }
  | { type: 'image'; attachment: Attachment }
  | { type: 'feedback' }
  | null;

export type SettingsSection = 'account' | 'voice' | 'stream' | 'keybinds' | 'app' | 'feedback';

export type ServerSettingsSection = 'overview' | 'roles' | 'members' | 'invites' | 'bans' | 'feedback';

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  /** Sağda soluk gösterilen kısayol (ör. "Ctrl+C") */
  hint?: string;
  disabled?: boolean;
  /** Onay kutusu gibi gösterilir (ör. üyenin rolü, sunucuda susturma) */
  checked?: boolean;
  /** Etiketin önündeki renkli nokta (rol rengi) */
  color?: string | null;
  /** Tıklanamayan küçük başlık (öğe grubu) */
  heading?: boolean;
  onClick?: () => void;
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
  /** Metin kanalının sağındaki üye listesi açık mı */
  memberListOpen: boolean;
  toggleMemberList: () => void;
  /** Yasaklama penceresi (açık pencerenin, ör. sunucu ayarlarının, üstünde açılır) */
  banUser: User | null;
  setBanUser: (user: User | null) => void;
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
const MEMBER_LIST_KEY = 'diskort-member-list';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // depolama kullanılamıyor
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // depolama kullanılamıyor
  }
}

const initialTextChannel = stored(LAST_TEXT_CHANNEL_KEY);

export const useUi = create<UiStore>()((set, get) => ({
  memberListOpen: stored(MEMBER_LIST_KEY) !== '0',
  toggleMemberList: () => {
    const memberListOpen = !get().memberListOpen;
    store(MEMBER_LIST_KEY, memberListOpen ? '1' : '0');
    set({ memberListOpen });
  },
  banUser: null,
  setBanUser: (banUser) => set({ banUser, contextMenu: null }),
  view: initialTextChannel ? { kind: 'text', channelId: initialTextChannel } : { kind: 'home' },
  lastTextChannelId: initialTextChannel,
  setView: (view) => {
    if (view.kind !== 'text') {
      set({ view });
      return;
    }
    store(LAST_TEXT_CHANNEL_KEY, view.channelId);
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
