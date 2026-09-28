import { useRef } from 'react';
import { View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Permission, type Channel } from '@diskort/shared';
import { ackChannel, api, can, errorMessage, isUnread, useGuild, useSession } from '@diskort/client-core';
import { feedback } from '../haptics';
import { toast } from '../stores/ui';
import { colors } from '../theme';
import { BottomSheet, SheetGroup, SheetHeader, SheetItem, SheetNote } from './BottomSheet';
import { confirmDialog } from './Dialog';
import { openChannelSettings } from './serverSettings/common';

/** Kanal silinmeden önce onay; silinirse true */
export async function confirmDeleteChannel(channel: Channel): Promise<boolean> {
  const ok = await confirmDialog({
    title: 'Kanal silinsin mi?',
    message:
      channel.type === 'text'
        ? `#${channel.name} kanalı ve bütün mesajları kalıcı olarak silinir. Bu işlem geri alınamaz.`
        : `"${channel.name}" ses kanalı silinir; içindekilerin bağlantısı kesilir.`,
    icon: 'trash-outline',
    confirmLabel: 'Kanalı sil',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.deleteChannel(channel.id);
    feedback('moderate');
    toast(channel.type === 'text' ? `#${channel.name} silindi.` : `"${channel.name}" silindi.`);
    return true;
  } catch (err) {
    toast(errorMessage(err), 'error');
    return false;
  }
}

/**
 * Kanala uzun basınca (masaüstündeki sağ tık menüsü gibi): okundu işaretle; yetkiye göre kanalı düzenle
 * (ad, izinler) ve sil.
 */
export function ChannelMenu({ channelId: requested, onClose }: { channelId: string | null; onClose: () => void }) {
  // Kapanış animasyonu sürerken içerik kaybolmasın: son kanal tutulur
  const last = useRef(requested);
  if (requested) last.current = requested;
  const channelId = requested ?? last.current;
  const channel = useGuild((s) => (channelId ? s.channels.find((c) => c.id === channelId) : undefined));
  const selfId = useSession((s) => s.user?.id);
  const canManage = useGuild((s) => (channelId ? can(s, selfId, Permission.MANAGE_CHANNELS, channelId) : false));
  const canPermissions = useGuild((s) => (channelId ? can(s, selfId, Permission.MANAGE_ROLES, channelId) : false));
  const unread = useGuild((s) => (channelId ? isUnread(s, channelId) : false));

  const markRead = (): void => {
    if (channelId) ackChannel(channelId);
    feedback('tick');
    onClose();
  };

  const edit = (): void => {
    onClose();
    if (channelId) openChannelSettings(channelId);
  };

  const remove = async (): Promise<void> => {
    onClose();
    if (channel) await confirmDeleteChannel(channel);
  };

  const nothing = !unread && !canManage && !canPermissions;

  return (
    <BottomSheet visible={Boolean(requested && channel)} onClose={onClose}>
      {channel ? (
        <>
          <SheetHeader
            title={channel.name}
            subtitle={channel.type === 'text' ? 'Metin kanalı' : 'Ses kanalı'}
            leading={
              <View style={{ width: 28, alignItems: 'center' }}>
                {channel.type === 'text' ? (
                  <Feather name="hash" size={24} color={colors.muted} />
                ) : (
                  <Ionicons name="volume-medium" size={24} color={colors.muted} />
                )}
              </View>
            }
          />
          {unread && (
            <SheetGroup>
              <SheetItem icon="checkmark-done" label="Okundu olarak işaretle" onPress={markRead} />
            </SheetGroup>
          )}
          {(canManage || canPermissions) && (
            <SheetGroup>
              <SheetItem
                icon="create-outline"
                label="Kanalı düzenle"
                hint={canManage ? 'Ad, izinler' : 'İzinler'}
                onPress={edit}
              />
            </SheetGroup>
          )}
          {canManage && (
            <SheetGroup>
              <SheetItem icon="trash-outline" label="Kanalı sil" danger onPress={() => void remove()} />
            </SheetGroup>
          )}
          {nothing && <SheetNote>Bu kanal için yapabileceğin bir şey yok.</SheetNote>}
        </>
      ) : null}
    </BottomSheet>
  );
}
