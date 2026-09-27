import { DM_GROUP_MAX_PARTICIPANTS, type DmChannel } from '@diskort/shared';
import {
  ackChannel,
  closeDm,
  dmTitle,
  isUnread,
  openDirectMessage,
  useGuild,
  useSession,
} from '@diskort/client-core';
import { useUi, type ContextMenuItem } from '../stores/ui';
import { confirmDialog } from './dialog';

/** Kişiyle bire bir konuşmayı açar (yoksa oluşturur) ve ona geçer; açık pencere kapanır. */
export async function startDm(userId: string): Promise<void> {
  const dm = await openDirectMessage(userId);
  if (!dm) return;
  const ui = useUi.getState();
  ui.closeModal();
  ui.setView({ kind: 'dm', channelId: dm.id });
}

/** Bire bir konuşmayı listeden kaldırır; gruptan (onay sorarak) ayrılır. */
export async function closeOrLeaveDm(dm: DmChannel): Promise<void> {
  if (dm.group) {
    const title = dmTitle(dm, useGuild.getState().users, useSession.getState().user?.id);
    const ok = await confirmDialog({
      title: `${title} grubundan ayrılınsın mı?`,
      message: 'Konuşma listenden kalkar. Biri seni yeniden eklemedikçe mesajlarını göremezsin.',
      confirmLabel: 'Gruptan Ayrıl',
      danger: true,
    });
    if (!ok) return;
  }
  await closeDm(dm.id);
}

/** Konuşmaya sağ tıklanınca */
export function dmMenuItems(dm: DmChannel): ContextMenuItem[] {
  const guild = useGuild.getState();
  const ui = useUi.getState();
  const items: ContextMenuItem[] = [];
  if (isUnread(guild, dm.id)) items.push({ label: 'Okundu Olarak İşaretle', onClick: () => ackChannel(dm.id) });
  if (dm.group) {
    items.push({ label: 'Grubun Adını Değiştir', onClick: () => ui.openModal({ type: 'renameDm', channelId: dm.id }) });
    if (dm.participantIds.length < DM_GROUP_MAX_PARTICIPANTS) {
      items.push({ label: 'Kişi Ekle', onClick: () => ui.openModal({ type: 'newDm', addTo: dm.id }) });
    }
    items.push({ label: 'Gruptan Ayrıl', danger: true, onClick: () => void closeOrLeaveDm(dm) });
  } else {
    items.push({ label: 'Konuşmayı Kapat', onClick: () => void closeOrLeaveDm(dm) });
  }
  return items;
}
