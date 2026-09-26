import { api, errorMessage, useSession } from '@diskort/client-core';
import { toast, type ContextMenuItem } from '../stores/ui';

/** Sesteki bir üyeye sağ tıklandığında yöneticiye gösterilen ek menü öğeleri. */
export function adminVoiceItems(userId: string, displayName: string | undefined): ContextMenuItem[] | undefined {
  if (!useSession.getState().user?.isAdmin) return undefined;
  return [
    {
      label: 'Sesten At',
      danger: true,
      onClick: () =>
        void api
          .kickFromVoice(userId)
          .then(() => toast(`${displayName ?? 'Kullanıcı'} sesten atıldı.`, 'success'))
          .catch((err) => toast(errorMessage(err), 'error')),
    },
  ];
}
