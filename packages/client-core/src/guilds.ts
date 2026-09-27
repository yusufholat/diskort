import { useShallow } from 'zustand/react/shallow';
import {
  AVATAR_MAX_BYTES,
  INVITE_LINK_PATH,
  parseInviteCode,
  type CreateInviteRequest,
  type Guild,
  type GuildData,
  type Invite,
} from '@diskort/shared';
import { api, ApiError, errorMessage, normalizeServerUrl } from './api';
import { env, type LocalFile } from './env';
import { isGuildUnread, useGuild, type GuildStore } from './guild';
import { useSession } from './session';
import { formatBytes, sendFile } from './uploads';

// Sunucular: kurma, davetle katılma, ayrılma, ayarlar. Hata olursa platformun yoluyla gösterilir.

/** Sunucular sol çubuktaki sırasıyla (sunucular değişmedikçe aynı dizi) */
export function useGuildList(): Guild[] {
  return useGuild(useShallow((s) => s.guildOrder.map((id) => s.guilds[id]!.guild)));
}

/** Sunucuda okunmamış mesaj var mı */
export function useGuildUnread(guildId: string): boolean {
  return useGuild((s) => isGuildUnread(s, guildId));
}

/** Sunucunun baş harfleri (simgesi yoksa gösterilir): "Hafta Sonu Ekibi" → "HSE" */
export function guildInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 3)
      .map((w) => [...w][0] ?? '')
      .join('')
      .toLocaleUpperCase('tr') || '?'
  );
}

/** Sunucu simgesinin tam adresi; simge yoksa null */
export const guildIconUrl = (guild: Pick<Guild, 'iconUrl'> | null | undefined): string | null =>
  guild?.iconUrl ? normalizeServerUrl(env().serverUrl()) + guild.iconUrl : null;

/** Davet bağlantısı: https://<sunucu>/davet/<kod> */
export const inviteLink = (code: string): string => normalizeServerUrl(env().serverUrl()) + INVITE_LINK_PATH + code;

/** Oturumdaki kullanıcı sunucunun sahibi mi */
export const isGuildOwner = (s: Pick<GuildStore, 'guilds'>, guildId: string | null | undefined): boolean => {
  const selfId = useSession.getState().user?.id;
  return Boolean(guildId && selfId && s.guilds[guildId]?.guild.ownerId === selfId);
};

/** REST yanıtıyla gelen sunucuyu hemen listeye koyar (gateway'den GUILD_CREATE da gelir; tekrar zararsız) */
function addGuild(data: GuildData): void {
  const self = useSession.getState().user;
  useGuild.getState().apply({
    t: 'GUILD_CREATE',
    d: {
      ...data,
      users: self ? [self] : [],
      voiceStates: [],
      online: self ? [self.id] : [],
      lastMessageIds: {},
      readStates: {},
      mentionCounts: {},
    },
  });
}

/** Yeni sunucu kurar ve seçer; hata olursa gösterir ve null döner. */
export async function createGuild(name: string): Promise<Guild | null> {
  try {
    const data = await api.createGuild({ name: name.trim() });
    addGuild(data);
    useGuild.getState().selectGuild(data.guild.id);
    return data.guild;
  } catch (err) {
    env().notifyError(errorMessage(err));
    return null;
  }
}

/**
 * Davet kodu ya da bağlantısıyla sunucuya katılır ve onu seçer (sunucu gateway'den GUILD_CREATE ile gelir).
 * Hata fırlatır (katılma ekranı mesajı kendisi gösterir).
 */
export async function joinGuild(codeOrLink: string): Promise<Guild> {
  const code = parseInviteCode(codeOrLink);
  if (!code) throw new ApiError(400, 'invalid_invite', 'Davet kodu ya da bağlantısı geçersiz.');
  const { guild } = await api.acceptInvite(code);
  useGuild.getState().selectGuild(guild.id);
  return guild;
}

/** Sunucudan ayrılır (sahip ayrılamaz). */
export async function leaveGuild(guildId: string): Promise<boolean> {
  try {
    await api.leaveGuild(guildId);
    useGuild.getState().apply({ t: 'GUILD_DELETE', d: { id: guildId } });
    return true;
  } catch (err) {
    env().notifyError(errorMessage(err));
    return false;
  }
}

/** Sunucuyu siler (yalnızca sahip). */
export async function deleteGuild(guildId: string): Promise<boolean> {
  try {
    await api.deleteGuild(guildId);
    useGuild.getState().apply({ t: 'GUILD_DELETE', d: { id: guildId } });
    return true;
  } catch (err) {
    env().notifyError(errorMessage(err));
    return false;
  }
}

/** Sunucu simgesini yükler (sunucu kare kırpıp küçültür). */
export async function uploadGuildIcon(
  guildId: string,
  file: LocalFile,
  signal: AbortSignal = new AbortController().signal,
): Promise<Guild> {
  if (file.size > AVATAR_MAX_BYTES) {
    throw new ApiError(413, 'too_large', `Resim çok büyük (en fazla ${formatBytes(AVATAR_MAX_BYTES)}).`);
  }
  const guild = await sendFile<Guild>(`/api/guilds/${guildId}/icon`, file, 200, 'Simge yüklenemedi', () => undefined, signal);
  useGuild.getState().apply({ t: 'GUILD_UPDATE', d: guild });
  return guild;
}

export async function removeGuildIcon(guildId: string): Promise<Guild> {
  const guild = await api.removeGuildIcon(guildId);
  useGuild.getState().apply({ t: 'GUILD_UPDATE', d: guild });
  return guild;
}

/** Sunucunun davetleri (MANAGE_INVITES: hepsi; değilse kendi oluşturdukların) */
export const guildInvites = {
  list: (guildId: string): Promise<Invite[]> => api.listInvites(guildId),
  create: (guildId: string, body: CreateInviteRequest): Promise<Invite> => api.createInvite(guildId, body),
  remove: (guildId: string, code: string): Promise<void> => api.deleteInvite(guildId, code),
};
