import {
  basePermissions,
  channelPermissions,
  hasPermission,
  highestRolePosition,
  outranks,
  Permission,
  type Channel,
  type Role,
} from '@diskort/shared';
import type { Store } from './db.js';

/**
 * Sunucudaki yetki denetimleri. Hesaplama istemcilerle ortak koddur (@diskort/shared); veriler
 * veritabanının önbellekli anlık görüntüsünden okunur, her değişiklikten sonra kendiliğinden tazelenir.
 * Üye olmayan (atılan/yasaklanan) hesapların hiçbir yetkisi yoktur.
 */
export class PermissionService {
  constructor(private readonly store: Store) {}

  private get data() {
    return this.store.permissionData();
  }

  rolesOf(userId: string): readonly string[] {
    return this.data.memberRoles.get(userId) ?? [];
  }

  isOwner(userId: string): boolean {
    return this.data.ownerId === userId;
  }

  /** Sunucu genelindeki yetkiler */
  base(userId: string): number {
    const data = this.data;
    if (data.removed.has(userId)) return 0;
    return basePermissions(data, userId, this.rolesOf(userId));
  }

  /** Kanaldaki yetkiler; kanal yoksa 0 */
  inChannel(userId: string, channel: Channel | string): number {
    const data = this.data;
    const c = typeof channel === 'string' ? data.channels.get(channel) : channel;
    if (!c || data.removed.has(userId)) return 0;
    return channelPermissions(data, userId, this.rolesOf(userId), c);
  }

  /** Yetkisi var mı: kanal verilirse o kanalda, verilmezse sunucu genelinde */
  can(userId: string, flag: number, channel?: Channel | string): boolean {
    return hasPermission(channel === undefined ? this.base(userId) : this.inChannel(userId, channel), flag);
  }

  canView(userId: string, channel: Channel | string): boolean {
    return this.can(userId, Permission.VIEW_CHANNEL, channel);
  }

  /** Kullanıcının görebildiği kanallar (sıralı) */
  visibleChannels(userId: string): Channel[] {
    return [...this.data.channels.values()].filter((c) => this.canView(userId, c));
  }

  visibleChannelIds(userId: string): Set<string> {
    return new Set(this.visibleChannels(userId).map((c) => c.id));
  }

  /** Kanalı görebilen üyeler */
  viewersOf(channel: Channel | string, userIds: Iterable<string>): string[] {
    return [...userIds].filter((id) => this.canView(id, channel));
  }

  highest(userId: string): number {
    return highestRolePosition(this.data, userId, this.rolesOf(userId));
  }

  /** Hiyerarşi: actor, target üyeyi yönetebilir mi (sahip herkesi; kimse sahibi ve kendini değil) */
  outranks(actorId: string, targetId: string): boolean {
    return outranks(
      this.data,
      { id: actorId, roles: this.rolesOf(actorId) },
      { id: targetId, roles: this.rolesOf(targetId) },
    );
  }

  /** Hiyerarşi: rol, kullanıcının en üst rolünün altında mı (sahip için hepsi) */
  roleIsBelow(actorId: string, role: Pick<Role, 'position'>): boolean {
    return role.position < this.highest(actorId);
  }
}
