import { blockUser, isBlocked, unblockUser, useGuild } from '@diskort/client-core';
import { toast, type ContextMenuItem } from '../stores/ui';
import { confirmDialog } from './dialog';

/** Onay sorup kişiyi engeller (yalnızca DM'leri etkiler; karşı tarafa söylenmez) */
export async function confirmBlock(userId: string): Promise<void> {
  const user = useGuild.getState().users[userId];
  const name = user?.displayName ?? 'Bu kişi';
  const ok = await confirmDialog({
    title: `${name} engellensin mi?`,
    message:
      'Bire bir konuşmanız iki taraf için de salt okunur olur: mesaj, tepki ve arama yapılamaz, geçmiş kalır. ' +
      'Sana yeni konuşma açamaz, başlattığı grup araması seni çalmaz. Sunucu kanallarında hiçbir şey değişmez; ' +
      'engellendiği ona söylenmez.',
    confirmLabel: 'Engelle',
    danger: true,
  });
  if (ok && (await blockUser(userId))) toast(`${name} engellendi.`, 'success');
}

export async function unblock(userId: string): Promise<void> {
  const name = useGuild.getState().users[userId]?.displayName;
  if (await unblockUser(userId)) toast(name ? `${name} kişisinin engeli kaldırıldı.` : 'Engel kaldırıldı.', 'success');
}

/** Kişi menüsündeki "Engelle" / "Engeli Kaldır" (kendin için yok) */
export function blockMenuItem(userId: string, selfId: string | undefined): ContextMenuItem[] {
  if (userId === selfId) return [];
  return isBlocked(useGuild.getState(), userId)
    ? [{ label: 'Engeli Kaldır', onClick: () => void unblock(userId) }]
    : [{ label: 'Engelle', danger: true, onClick: () => void confirmBlock(userId) }];
}
