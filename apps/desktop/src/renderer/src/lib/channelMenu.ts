import { hasPermission, Permission, type Channel } from '@diskort/shared';
import { api, can, errorMessage, useGuild, useSession } from '@diskort/client-core';
import { toast, useUi, type ContextMenuItem } from '../stores/ui';
import { confirmDialog } from './dialog';

/** Kanal @everyone'dan gizlenmiş mi (listede kilit simgesi gösterilir) */
export function isPrivateChannel(channel: Channel, guildId: string | undefined): boolean {
  const everyone = channel.overwrites?.find((o) => o.roleId === guildId);
  return everyone !== undefined && hasPermission(everyone.deny, Permission.VIEW_CHANNEL);
}

/** Kanala sağ tıklanınca: düzenleme (ad ya da izinler) ve silme, yetkiye göre */
export function channelMenuItems(channel: Channel): ContextMenuItem[] {
  const s = useGuild.getState();
  const selfId = useSession.getState().user?.id;
  const manage = can(s, selfId, Permission.MANAGE_CHANNELS, channel.id);
  const permissions = can(s, selfId, Permission.MANAGE_ROLES, channel.id);
  const items: ContextMenuItem[] = [];
  if (manage || permissions) {
    items.push({ label: 'Kanalı Düzenle', onClick: () => useUi.getState().openModal({ type: 'channel', channel }) });
  }
  if (manage) {
    items.push({
      label: 'Kanalı Sil',
      danger: true,
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'Kanalı sil',
          message:
            channel.type === 'text'
              ? `#${channel.name} kanalı ve tüm mesajları kalıcı olarak silinsin mi?`
              : `"${channel.name}" ses kanalı silinsin mi? İçindekilerin bağlantısı kesilir.`,
          confirmLabel: 'Kanalı Sil',
          danger: true,
        });
        if (ok) api.deleteChannel(channel.id).catch((err) => toast(errorMessage(err), 'error'));
      },
    });
  }
  return items;
}
