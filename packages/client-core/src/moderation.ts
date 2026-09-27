import { Permission, type Channel, type Role, type User, type VoiceState } from '@diskort/shared';
import { api, errorMessage } from './api';
import { env } from './env';
import { useGuild } from './guild';
import { can, canAssignRole, outranksUser } from './permissions';
import { useSession } from './session';

// Üyeleri yönetme işleri: iki arayüz de bunları çağırır. Başarısızlıkta hata platformun yoluyla
// gösterilir ve false döner; başarı mesajını arayüz kendi gösterir.

async function run(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (err) {
    env().notifyError(errorMessage(err));
    return false;
  }
}

/** İşlemin yapılacağı sunucu: seçili sunucu (üye yönetimi hep seçili sunucunun ekranlarından yapılır) */
const activeGuild = (): string => useGuild.getState().activeGuildId ?? '';

/**
 * Sesli sohbetteki üyenin sunucusu: seste olduğu kanalın sunucusu (başka sunucunun kanalındaysa oradaki
 * yetkiyle), değilse seçili sunucu
 */
const voiceGuild = (userId: string): string => {
  const s = useGuild.getState();
  const channelId = s.voiceStates[userId]?.channelId;
  return (channelId && s.channelGuild[channelId]) || activeGuild();
};

export const moderation = {
  kick: (userId: string) => run(() => api.kickMember(activeGuild(), userId)),
  ban: (userId: string, reason?: string) => run(() => api.banMember(activeGuild(), userId, reason)),
  unban: (userId: string) => run(() => api.unban(activeGuild(), userId)),
  setServerMute: (userId: string, mute: boolean) => run(() => api.moderateVoice(voiceGuild(userId), userId, { mute })),
  setServerDeaf: (userId: string, deaf: boolean) => run(() => api.moderateVoice(voiceGuild(userId), userId, { deaf })),
  move: (userId: string, channelId: string) => run(() => api.moderateVoice(voiceGuild(userId), userId, { channelId })),
  disconnect: (userId: string) => run(() => api.moderateVoice(voiceGuild(userId), userId, { channelId: null })),
  setRole: (userId: string, roleId: string, add: boolean) =>
    run(() =>
      add ? api.addMemberRole(activeGuild(), userId, roleId) : api.removeMemberRole(activeGuild(), userId, roleId),
    ),
};

/** Oturumdaki kullanıcının bir üyeye yapabilecekleri (arayüzde hangi düğmelerin görüneceği) */
export interface MemberActions {
  kick: boolean;
  ban: boolean;
  /** Sesteyse: sunucuda susturma / sağırlaştırma / taşıma ve sesten çıkarma */
  mute: boolean;
  deafen: boolean;
  move: boolean;
  /** Verip alabileceği roller */
  roles: Role[];
}

/**
 * Yetkilere ve hiyerarşiye göre yapılabilecekler (sunucudaki kuralların aynısı). Kendine: yalnızca
 * sesteki yönetim ve alttaki rolleri.
 */
export function memberActions(targetId: string): MemberActions {
  const s = useGuild.getState();
  const selfId = useSession.getState().user?.id;
  const self = targetId === selfId;
  const above = self || outranksUser(s, selfId, targetId);
  const voice: VoiceState | undefined = s.voiceStates[targetId];
  const inChannel = (flag: number): boolean =>
    above && (voice ? can(s, selfId, flag, voice.channelId) : can(s, selfId, flag));
  return {
    kick: !self && above && can(s, selfId, Permission.KICK_MEMBERS),
    ban: !self && above && can(s, selfId, Permission.BAN_MEMBERS),
    mute: inChannel(Permission.MUTE_MEMBERS),
    deafen: inChannel(Permission.DEAFEN_MEMBERS),
    move: voice !== undefined && inChannel(Permission.MOVE_MEMBERS),
    roles: Object.values(s.roles)
      .filter((r) => canAssignRole(s, selfId, targetId, r))
      .sort((a, b) => b.position - a.position),
  };
}

/** Üyenin taşınabileceği ses kanalları (bulunduğu hariç; oraya taşıma yetkisi olanlar) */
export function moveTargets(target: Pick<User, 'id'>): Channel[] {
  const s = useGuild.getState();
  const selfId = useSession.getState().user?.id;
  const current = s.voiceStates[target.id]?.channelId;
  return s.channels.filter(
    (c) =>
      c.type === 'voice' &&
      c.id !== current &&
      can(s, selfId, Permission.MOVE_MEMBERS, c.id) &&
      can(s, target.id, Permission.CONNECT, c.id),
  );
}

/**
 * Sürükle-bırak: sesteki üyenin bırakılabileceği ses kanalları. Kendini, bağlanabildiğin her kanala
 * (kanal değiştirme; taşıma yetkisi gerekmez); başkasını yalnızca taşıma yetkin olan ve onun
 * bağlanabildiği kanallara. Seste değilse boş.
 */
export function voiceDropTargets(userId: string): Set<string> {
  const s = useGuild.getState();
  const selfId = useSession.getState().user?.id;
  const current = s.voiceStates[userId]?.channelId;
  if (!current) return new Set();
  if (userId === selfId) {
    return new Set(
      s.channels.filter((c) => c.type === 'voice' && c.id !== current && can(s, selfId, Permission.CONNECT, c.id)).map((c) => c.id),
    );
  }
  if (!memberActions(userId).move) return new Set();
  return new Set(moveTargets({ id: userId }).map((c) => c.id));
}
