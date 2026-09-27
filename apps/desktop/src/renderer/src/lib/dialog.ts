import type { ReactNode } from 'react';
import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Geri alınamaz işlem: onay düğmesi kırmızı */
  danger?: boolean;
}

interface DialogState {
  current: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
}

export const useDialog = create<DialogState>()(() => ({ current: null }));

/**
 * Uygulamanın temasında onay penceresi (window.confirm Windows'un kendi kutusunu açar).
 * Onaylanırsa true, vazgeçilirse (Esc, dışarı tıklama, "Vazgeç") false döner.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // Açık bir onay varsa vazgeçilmiş say
  useDialog.getState().current?.resolve(false);
  return new Promise((resolve) => useDialog.setState({ current: { ...options, resolve } }));
}

export function closeDialog(ok: boolean): void {
  const current = useDialog.getState().current;
  useDialog.setState({ current: null });
  current?.resolve(ok);
}
