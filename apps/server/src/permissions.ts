import {
  basePermissions,
  channelPermissions,
  dmPermissions,
  hasPermission,
  highestRolePosition,
  outranks,
  Permission,
  type Channel,
  type Role,
} from '@diskort/shared';
import type { GuildPermissionData, Store } from './db.js';

/**
 * Sunucudaki yetki denetimleri. Hesaplama istemcilerle ortak koddur (@diskort/shared); veriler
 * veritabanının önbellekli anlık görüntüsünden okunur, her değişiklikten sonra kendiliğinden tazelenir.
 * Yetkiler sunucu (guild) başınadır: bir sunucunun üyesi olmayan (hiç katılmamış, ayrılmış, atılmış ya da
 * yasaklanmış) hesabın o sunucuda hiçbir yetkisi yoktur ve kanallarını göremez.
 */
export class PermissionService {
  constructor(private readonly store: Store) {}

  private get data() {
    return this.store.permissionData();
  }

  private guild(guildId: string): GuildPermissionData | undefined {
    return this.data.guilds.get(guildId);
  }

  rolesOf(guildId: string, userId: string): readonly string[] {
    return this.guild(guildId)?.memberRoles.get(userId) ?? [];
  }

  isOwner(guildId: string, userId: string): boolean {
    return this.guild(guildId)?.ownerId === userId;
  }

  /** Sunucunun şu anki üyesi mi */
  isMember(guildId: string, userId: string): boolean {
    return this.guild(guildId)?.members.has(userId) ?? false;
  }

  /** Kullanıcının üye olduğu sunucular */
  guildsOf(userId: string): ReadonlySet<string> {
    return this.data.userGuilds.get(userId) ?? new Set();
  }

  /** İki hesabın ortak bir sunucusu var mı */
  sharesGuild(a: string, b: string): boolean {
    if (a === b) return true;
    const mine = this.guildsOf(a);
    for (const id of this.guildsOf(b)) if (mine.has(id)) return true;
    return false;
  }

  /** Kullanıcıyla ortak sunucusu olan herkes (kendisi dahil) */
  coMembers(userId: string): Set<string> {
    const result = new Set<string>([userId]);
    for (const guildId of this.guildsOf(userId)) {
      for (const id of this.guild(guildId)?.members ?? []) result.add(id);
    }
    return result;
  }

  /** Hesap yöneticisi: hesabın kendi bayrağı (users.is_admin), hiçbir sunucunun rollerine bağlı değil */
  isInstanceAdmin(userId: string): boolean {
    return this.store.isAdmin(userId);
  }

  /** Ana sunucu (hesap yöneticilerinin sunucusu) */
  get primaryGuildId(): string | null {
    return this.data.primaryGuildId;
  }

  /** Kanal (DM'ler hariç) */
  channel(channelId: string): Channel | undefined {
    const guildId = this.data.channelGuild.get(channelId);
    return guildId ? this.guild(guildId)?.channels.get(channelId) : undefined;
  }

  /** Kanalın sunucusu (DM ya da bilinmeyen kanalda undefined) */
  guildOf(channelId: string): string | undefined {
    return this.data.channelGuild.get(channelId);
  }

  /** Sunucu genelindeki yetkiler; üye değilse 0 */
  base(guildId: string, userId: string): number {
    const g = this.guild(guildId);
    if (!g || !g.members.has(userId)) return 0;
    return basePermissions(g, userId, g.memberRoles.get(userId) ?? []);
  }

  /**
   * Kanaldaki yetkiler; kanal yoksa ya da kişi kanalın sunucusunun üyesi değilse 0. Kimlikle verilen kanal
   * bir direkt mesaj konuşmasıysa yalnızca katılımcılar yetki alır (roller ve yöneticilik uygulanmaz, bkz.
   * dmPermissions); bire bir konuşmada ortak sunucusu kalmayan karşı tarafa yazılamaz.
   */
  inChannel(userId: string, channel: Channel | string): number {
    const data = this.data;
    if (typeof channel === 'string') {
      const dm = data.dms.get(channel);
      if (dm) return dmPermissions(dm, userId, (id) => id === userId || this.sharesGuild(userId, id));
    }
    const c = typeof channel === 'string' ? this.channel(channel) : channel;
    if (!c) return 0;
    const g = this.guild(c.guildId);
    if (!g || !g.members.has(userId)) return 0;
    return channelPermissions(g, userId, g.memberRoles.get(userId) ?? [], c);
  }

  /** Kimlik bir direkt mesaj konuşmasının mı */
  isDm(channelId: string): boolean {
    return this.data.dms.has(channelId);
  }

  /** Konuşmanın katılımcıları (DM değilse boş) */
  dmParticipants(channelId: string): readonly string[] {
    return this.data.dms.get(channelId)?.participantIds ?? [];
  }

  /** Kanalda yetkisi var mı */
  can(userId: string, flag: number, channel: Channel | string): boolean {
    return hasPermission(this.inChannel(userId, channel), flag);
  }

  /** Sunucu genelinde yetkisi var mı */
  canInGuild(guildId: string, userId: string, flag: number): boolean {
    return hasPermission(this.base(guildId, userId), flag);
  }

  canView(userId: string, channel: Channel | string): boolean {
    return this.can(userId, Permission.VIEW_CHANNEL, channel);
  }

  /** Kullanıcının bir sunucuda görebildiği kanallar (sıralı) */
  visibleChannels(guildId: string, userId: string): Channel[] {
    return [...(this.guild(guildId)?.channels.values() ?? [])].filter((c) => this.canView(userId, c));
  }

  /** Kullanıcının tüm sunucularda görebildiği kanalların kimlikleri */
  visibleChannelIds(userId: string): Set<string> {
    const ids = new Set<string>();
    for (const guildId of this.guildsOf(userId)) {
      for (const c of this.visibleChannels(guildId, userId)) ids.add(c.id);
    }
    return ids;
  }

  /** Kanalı görebilen kullanıcılar */
  viewersOf(channel: Channel | string, userIds: Iterable<string>): string[] {
    return [...userIds].filter((id) => this.canView(id, channel));
  }

  highest(guildId: string, userId: string): number {
    const g = this.guild(guildId);
    if (!g) return 0;
    return highestRolePosition(g, userId, g.memberRoles.get(userId) ?? []);
  }

  /** Hiyerarşi: actor, target üyeyi yönetebilir mi (sahip herkesi; kimse sahibi ve kendini değil) */
  outranks(guildId: string, actorId: string, targetId: string): boolean {
    const g = this.guild(guildId);
    if (!g) return false;
    return outranks(
      g,
      { id: actorId, roles: g.memberRoles.get(actorId) ?? [] },
      { id: targetId, roles: g.memberRoles.get(targetId) ?? [] },
    );
  }

  /** Hiyerarşi: rol, kullanıcının en üst rolünün altında mı (sahip için hepsi) */
  roleIsBelow(guildId: string, actorId: string, role: Pick<Role, 'position'>): boolean {
    return role.position < this.highest(guildId, actorId);
  }
}
