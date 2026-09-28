import { create } from 'zustand';
import { useAppUpdate } from './updater';

/** Kapatılan sürüm: aynı sürüm için güncelleme şeridi bir daha çıkmaz (uygulama kapatılıp açılınca zaten uygulanır) */
export const useDismissedUpdate = create<{ version: string | null }>(() => ({ version: null }));

/** Güncelleme şeridi (components/UpdateBanner) şu an görünüyor mu: Toast bunun altına iner */
export function useUpdateBannerVisible(): boolean {
  const ota = useAppUpdate((s) => s.ota);
  const dismissed = useDismissedUpdate((s) => s.version);
  return ota.kind === 'downloaded' && ota.version !== dismissed;
}
