import { Permission, type Channel } from '@diskort/shared';
import { api, errorMessage } from './api';
import { env } from './env';
import { useGuild } from './guild';
import { can } from './permissions';
import { useSession } from './session';

// Kanalları sürükleyerek sıralama. Sunucu görülebilen kanalların tamamının yeni sırasını ister;
// görülemeyenler yerini korur (bkz. PUT /api/guilds/:id/channels/order).

/** Seçili sunucuda kanalları sıralayabilir mi (sunucu genelinde KANALLARI_YÖNET) */
export function canReorderChannels(): boolean {
  const s = useGuild.getState();
  return can(s, useSession.getState().user?.id, Permission.MANAGE_CHANNELS);
}

/**
 * `fromId`, `targetId`'nin önüne (`after` ise arkasına) taşınmış sıra. Aynı yere düşüyorsa ya da
 * kimliklerden biri listede yoksa aynı dizi döner.
 */
export function reorderedIds(ids: readonly string[], fromId: string, targetId: string, after: boolean): string[] {
  if (fromId === targetId || !ids.includes(fromId) || !ids.includes(targetId)) return [...ids];
  const rest = ids.filter((id) => id !== fromId);
  const index = rest.indexOf(targetId) + (after ? 1 : 0);
  return [...rest.slice(0, index), fromId, ...rest.slice(index)];
}

const applyChannels = (channels: Channel[]): void => {
  const { apply } = useGuild.getState();
  for (const d of channels) apply({ t: 'CHANNEL_UPDATE', d });
};

/**
 * Seçili sunucunun kanallarını yeni sıraya koyar: liste hemen güncellenir (iyimser), sunucunun
 * yanıtıyla kesinleşir; hata olursa eski sıraya döner ve hata gösterilir.
 */
export async function reorderChannels(guildId: string, orderedIds: string[]): Promise<boolean> {
  const before = useGuild.getState().guilds[guildId]?.channels ?? [];
  const byId = new Map(before.map((c) => [c.id, c]));
  const current = before.map((c) => c.id);
  if (orderedIds.length !== current.length || orderedIds.every((id, i) => current[i] === id)) return false;
  applyChannels(
    orderedIds.flatMap((id, i) => {
      const c = byId.get(id);
      return c ? [{ ...c, position: i }] : [];
    }),
  );
  try {
    applyChannels(await api.reorderChannels(guildId, orderedIds));
    return true;
  } catch (err) {
    applyChannels(before);
    env().notifyError(errorMessage(err));
    return false;
  }
}
