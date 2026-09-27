import { memberActions, moderation, moveTargets, useGuild, useSession } from '@diskort/client-core';
import { toast, useUi, type ContextMenuItem } from '../stores/ui';
import { startDm } from './dm';
import { confirmDialog } from './dialog';

/**
 * Bir üyeye sağ tıklanınca: başkasıysa "Mesaj Gönder", sonra yetkilere ve hiyerarşiye göre yönetim
 * öğeleri: seste sunucuda susturma, sağırlaştırma, taşıma, sesten çıkarma; rol verme/alma; atma ve
 * yasaklama. Kendisi için ve yetki yoksa boş liste.
 */
export function memberMenuItems(userId: string): ContextMenuItem[] {
  const guild = useGuild.getState();
  const user = guild.users[userId];
  if (!user) return [];
  const self = userId === useSession.getState().user?.id;
  // Seçili sunucunun üyesi değil (ör. DM'deki başka sunucudan biri): ortak sunucu varsa yalnızca mesaj
  if (user.removed) {
    return !self && guild.reachable[userId] ? [{ label: 'Mesaj Gönder', onClick: () => void startDm(userId) }] : [];
  }
  const name = user.displayName;
  const actions = memberActions(userId);
  const voice = guild.voiceStates[userId];
  const items: ContextMenuItem[] = [];

  if (!self && guild.reachable[userId]) {
    items.push({ label: 'Mesaj Gönder', onClick: () => void startDm(userId) });
  }

  if (voice && (actions.mute || actions.deafen || actions.move)) {
    items.push({ label: 'Sesli sohbet', heading: true });
    if (actions.mute) {
      items.push({
        label: 'Sunucuda Sustur',
        checked: voice.serverMute,
        onClick: () => void moderation.setServerMute(userId, !voice.serverMute),
      });
    }
    if (actions.deafen) {
      items.push({
        label: 'Sunucuda Sağırlaştır',
        checked: voice.serverDeaf,
        onClick: () => void moderation.setServerDeaf(userId, !voice.serverDeaf),
      });
    }
    if (actions.move) {
      for (const channel of moveTargets(user)) {
        items.push({
          label: `Taşı: ${channel.name}`,
          onClick: () => void moderation.move(userId, channel.id),
        });
      }
      items.push({
        label: 'Sesten Çıkar',
        danger: true,
        onClick: () =>
          void moderation.disconnect(userId).then((ok) => ok && toast(`${name} sesten çıkarıldı.`, 'success')),
      });
    }
  }

  if (actions.roles.length > 0) {
    items.push({ label: 'Roller', heading: true });
    for (const role of actions.roles) {
      const has = user.roles.includes(role.id);
      items.push({
        label: role.name,
        color: role.color,
        checked: has,
        onClick: () => void moderation.setRole(userId, role.id, !has),
      });
    }
  }

  if (actions.kick || actions.ban) items.push({ label: 'Üyelik', heading: true });
  if (actions.kick) {
    items.push({ label: `${name} kişisini at`, danger: true, onClick: () => void kickMember(userId) });
  }
  if (actions.ban) {
    items.push({
      label: `${name} kişisini yasakla`,
      danger: true,
      onClick: () => useUi.getState().setBanUser(user),
    });
  }
  return items;
}

/** Onay sorup üyeyi atar */
export async function kickMember(userId: string): Promise<void> {
  const user = useGuild.getState().users[userId];
  if (!user) return;
  const ok = await confirmDialog({
    title: `${user.displayName} atılsın mı?`,
    message: 'Sunucudan çıkarılır ve bu sunucudaki rolleri alınır. Mesajları kalır; yeni bir davetle geri dönebilir.',
    confirmLabel: 'At',
    danger: true,
  });
  if (ok && (await moderation.kick(userId))) toast(`${user.displayName} sunucudan atıldı.`, 'success');
}
