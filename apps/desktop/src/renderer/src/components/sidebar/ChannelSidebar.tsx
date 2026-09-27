import { ChevronDown, Plus } from 'lucide-react';
import { Permission, type ChannelType } from '@diskort/shared';
import { useMainView } from '../../lib/mainView';
import { canManageFeedback, isGuildOwner, leaveGuild, useCan, useFeedback, useGuild } from '@diskort/client-core';
import { confirmDialog } from '../../lib/dialog';
import { toast, useUi, type ContextMenuItem } from '../../stores/ui';
import { CountBadge, useServerSettingsSections } from '../serverSettings/ServerSettingsModal';
import { DragGhost } from './DragGhost';
import { TextChannelItem } from './TextChannelItem';
import { UserPanel } from './UserPanel';
import { VoiceChannelItem } from './VoiceChannelItem';
import { VoiceConnectionPanel } from './VoiceConnectionPanel';

export function ChannelSidebar() {
  const guild = useGuild((s) => s.guild);
  const channels = useGuild((s) => s.channels);
  const canManageChannels = useCan(Permission.MANAGE_CHANNELS);
  const canCreateInvite = useCan(Permission.CREATE_INVITE);
  const canManageInvites = useCan(Permission.MANAGE_INVITES);
  const canInvite = canCreateInvite || canManageInvites;
  const owner = useGuild((s) => isGuildOwner(s, s.activeGuildId));
  // Geri bildirimler ana sunucunun yöneticilerine, ana sunucunun menüsünde
  const feedbackHere = useGuild((s) => s.activeGuildId === s.primaryGuildId) && canManageFeedback();
  const newFeedback = useFeedback((s) => (feedbackHere ? s.newCount : 0));
  const settingsSections = useServerSettingsSections();
  const openModal = useUi((s) => s.openModal);
  const openContextMenu = useUi((s) => s.openContextMenu);
  const view = useMainView();

  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  // Sunucu menüsü: yalnızca yetkisi olunan işler
  const menu: ContextMenuItem[] = [
    ...(settingsSections.length > 0
      ? [{ label: 'Sunucu Ayarları', onClick: () => openModal({ type: 'serverSettings' }) }]
      : []),
    ...(canInvite ? [{ label: 'Arkadaşlarını Davet Et', onClick: () => openModal({ type: 'invite' }) }] : []),
    ...(canManageChannels ? [{ label: 'Kanal Oluştur', onClick: () => openModal({ type: 'channel' }) }] : []),
    ...(feedbackHere
      ? [
          {
            label: 'Geri Bildirimler',
            hint: newFeedback > 0 ? `${newFeedback} yeni` : undefined,
            onClick: () => openModal({ type: 'serverSettings', section: 'feedback' }),
          },
        ]
      : []),
    // Sahip ayrılamaz (önce sahipliği devretmeli ya da sunucuyu silmeli)
    ...(!owner && guild
      ? [
          {
            label: 'Sunucudan Ayrıl',
            danger: true,
            onClick: async () => {
              const ok = await confirmDialog({
                title: `"${guild.name}" sunucusundan ayrılınsın mı?`,
                message: 'Bu sunucunun kanallarını artık göremezsin ve rollerin alınır. Geri dönmek için yeni bir davet gerekir.',
                confirmLabel: 'Sunucudan Ayrıl',
                danger: true,
              });
              if (ok && (await leaveGuild(guild.id))) toast(`"${guild.name}" sunucusundan ayrıldın.`);
            },
          },
        ]
      : []),
  ];

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-bg-side">
      <button
        className="flex h-12 shrink-0 items-center justify-between border-b border-edge px-4 font-semibold text-text-head shadow-sm transition-colors hover:bg-bg-hover"
        onClick={(e) => {
          if (menu.length === 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          openContextMenu({ x: rect.left + 8, y: rect.bottom + 4, items: menu });
        }}
      >
        <span className="truncate">{guild?.name}</span>
        <span className="flex shrink-0 items-center">
          {newFeedback > 0 && <CountBadge count={newFeedback} className="mr-1.5" />}
          {menu.length > 0 && <ChevronDown size={18} />}
        </span>
      </button>

      <div className="flex-1 overflow-y-auto px-2 pt-4 pb-2" data-drag-scroll>
        <SectionHeader title="Metin Kanalları" type="text" canCreate={canManageChannels} />
        {textChannels.map((channel) => (
          <TextChannelItem
            key={channel.id}
            channel={channel}
            selected={view.kind === 'text' && view.channelId === channel.id}
          />
        ))}

        <div className="h-4" />
        <SectionHeader title="Ses Kanalları" type="voice" canCreate={canManageChannels} />
        {voiceChannels.map((channel) => (
          <VoiceChannelItem key={channel.id} channel={channel} />
        ))}
      </div>

      <DragGhost />
      <VoiceConnectionPanel />
      <UserPanel />
    </aside>
  );
}

function SectionHeader({ title, type, canCreate }: { title: string; type: ChannelType; canCreate: boolean }) {
  const openModal = useUi((s) => s.openModal);
  return (
    <div className="group mb-1 flex items-center justify-between pr-1 pl-1">
      <span className="text-xs font-bold tracking-wide text-text-muted uppercase group-hover:text-text-normal">
        {title}
      </span>
      {canCreate && (
        <button
          className="press-icon text-text-muted hover:text-text-head"
          data-tooltip="Kanal Oluştur"
          aria-label="Kanal Oluştur"
          onClick={() => openModal({ type: 'channel', channelType: type })}
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}
