import { create } from 'zustand';

interface UiStore {
  /** Şu an ekranda açık olan metin kanalı (bahsetme bildirimi ve okundu bilgisi için) */
  viewingChannelId: string | null;
  /** Kısa bilgi/hata mesajı */
  toast: { text: string; kind: 'info' | 'error'; id: number } | null;
  /** Sunucu bu sürümü reddetti: kurulması gereken sürüm */
  updateRequired: string | null;
}

export const useUi = create<UiStore>()(() => ({ viewingChannelId: null, toast: null, updateRequired: null }));

let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string, kind: 'info' | 'error' = 'info'): void {
  const id = ++toastId;
  useUi.setState({ toast: { text, kind, id } });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (useUi.getState().toast?.id === id) useUi.setState({ toast: null });
  }, kind === 'error' ? 5000 : 3000);
}
