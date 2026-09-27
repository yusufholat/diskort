import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  basePermissions,
  channelPermissions,
  DEFAULT_EVERYONE_PERMISSIONS,
  hasPermission,
  highestRolePosition,
  hoistedRole,
  memberColor,
  outranks,
  Permission as P,
  roleIsBelow,
  sortRoles,
  type PermissionContext,
  type Role,
} from '@diskort/shared';

const role = (id: string, position: number, permissions: number, extra: Partial<Role> = {}): Role => ({
  id,
  name: id,
  color: null,
  position,
  hoist: false,
  permissions,
  ...extra,
});

// g: @everyone; admin > mod > dj > uye
const ctx: PermissionContext = {
  guildId: 'g',
  ownerId: 'sahip',
  roles: {
    g: role('g', 0, DEFAULT_EVERYONE_PERMISSIONS),
    admin: role('admin', 4, P.ADMINISTRATOR, { color: '#e67e22', hoist: true }),
    mod: role('mod', 3, P.KICK_MEMBERS | P.MANAGE_MESSAGES | P.MUTE_MEMBERS, { color: '#3498db', hoist: true }),
    dj: role('dj', 2, P.MOVE_MEMBERS, { color: '#2ecc71' }),
    uye: role('uye', 1, 0),
  },
};

const text = (overwrites: { roleId: string; allow: number; deny: number }[] = []) => ({ type: 'text' as const, overwrites });
const voice = (overwrites: { roleId: string; allow: number; deny: number }[] = []) => ({
  type: 'voice' as const,
  overwrites,
});

describe('temel yetkiler', () => {
  it('@everyone ile rollerin yetkileri birleşir', () => {
    const perms = basePermissions(ctx, 'u', ['mod']);
    expect(hasPermission(perms, P.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(perms, P.KICK_MEMBERS)).toBe(true);
    expect(hasPermission(perms, P.BAN_MEMBERS)).toBe(false);
    expect(basePermissions(ctx, 'u', [])).toBe(DEFAULT_EVERYONE_PERMISSIONS);
  });

  it('ADMINISTRATOR ve sahip her yetkiye sahiptir; bilinmeyen rol yok sayılır', () => {
    expect(basePermissions(ctx, 'u', ['admin'])).toBe(ALL_PERMISSIONS);
    expect(basePermissions(ctx, 'sahip', [])).toBe(ALL_PERMISSIONS);
    expect(basePermissions(ctx, 'u', ['silinmis-rol'])).toBe(DEFAULT_EVERYONE_PERMISSIONS);
  });
});

describe('kanal izinleri', () => {
  it('özel kanal: @everyone görmez, izin verilen rol görür', () => {
    const channel = text([
      { roleId: 'g', allow: 0, deny: P.VIEW_CHANNEL },
      { roleId: 'dj', allow: P.VIEW_CHANNEL, deny: 0 },
    ]);
    expect(channelPermissions(ctx, 'u', [], channel)).toBe(0);
    expect(channelPermissions(ctx, 'u', ['uye'], channel)).toBe(0);
    const dj = channelPermissions(ctx, 'u', ['dj'], channel);
    expect(hasPermission(dj, P.VIEW_CHANNEL | P.SEND_MESSAGES)).toBe(true);
  });

  it('rollerin izinleri birleşir ve izin verme engellemeye üstün gelir; @everyone izni rollerden önce uygulanır', () => {
    const channel = text([
      { roleId: 'g', allow: P.MANAGE_MESSAGES, deny: 0 },
      { roleId: 'mod', allow: 0, deny: P.SEND_MESSAGES },
      { roleId: 'dj', allow: P.SEND_MESSAGES, deny: 0 },
    ]);
    // @everyone'a verilen yetki herkese geçer
    expect(hasPermission(channelPermissions(ctx, 'u', [], channel), P.MANAGE_MESSAGES)).toBe(true);
    // Yalnızca mod: engellendi
    expect(hasPermission(channelPermissions(ctx, 'u', ['mod'], channel), P.SEND_MESSAGES)).toBe(false);
    // mod + dj: dj'nin izni üstün
    expect(hasPermission(channelPermissions(ctx, 'u', ['mod', 'dj'], channel), P.SEND_MESSAGES)).toBe(true);
  });

  it('salt okunur kanal: mesaj gönderemeyen dosya ekleyemez ve herkesten bahsedemez', () => {
    const channel = text([{ roleId: 'g', allow: 0, deny: P.SEND_MESSAGES }]);
    const perms = channelPermissions(ctx, 'u', [], channel);
    expect(hasPermission(perms, P.VIEW_CHANNEL)).toBe(true);
    expect(hasPermission(perms, P.ADD_REACTIONS)).toBe(true);
    expect(perms & (P.SEND_MESSAGES | P.ATTACH_FILES | P.MENTION_EVERYONE)).toBe(0);
  });

  it('ses kanalı: bağlanamayan konuşamaz, yayın yapamaz, kimseyi yönetemez; metin yetkileri görünmez', () => {
    const channel = voice([{ roleId: 'g', allow: 0, deny: P.CONNECT }]);
    const perms = channelPermissions(ctx, 'u', ['mod'], channel);
    expect(hasPermission(perms, P.VIEW_CHANNEL)).toBe(true);
    expect(perms & (P.CONNECT | P.SPEAK | P.STREAM | P.MUTE_MEMBERS)).toBe(0);
    expect(perms & P.SEND_MESSAGES).toBe(0);
    // Genel yetkiler kanalda da geçerli
    expect(hasPermission(perms, P.KICK_MEMBERS)).toBe(true);
    // Metin kanalında ses yetkileri yok
    expect(channelPermissions(ctx, 'u', [], text()) & P.CONNECT).toBe(0);
  });

  it('yönetici ve sahip kanal izinlerinden etkilenmez', () => {
    const channel = voice([{ roleId: 'g', allow: 0, deny: P.VIEW_CHANNEL | P.CONNECT }]);
    expect(channelPermissions(ctx, 'u', ['admin'], channel)).toBe(ALL_PERMISSIONS);
    expect(channelPermissions(ctx, 'sahip', [], channel)).toBe(ALL_PERMISSIONS);
  });
});

describe('hiyerarşi', () => {
  it('en üst rolü daha yukarıda olan yönetir; eşitler ve kendisi yönetemez', () => {
    expect(outranks(ctx, { id: 'a', roles: ['mod'] }, { id: 'b', roles: ['dj', 'uye'] })).toBe(true);
    expect(outranks(ctx, { id: 'b', roles: ['dj'] }, { id: 'a', roles: ['mod'] })).toBe(false);
    expect(outranks(ctx, { id: 'a', roles: ['mod'] }, { id: 'b', roles: ['mod'] })).toBe(false);
    expect(outranks(ctx, { id: 'a', roles: ['mod'] }, { id: 'a', roles: ['mod'] })).toBe(false);
    expect(outranks(ctx, { id: 'a', roles: ['uye'] }, { id: 'b', roles: [] })).toBe(true);
  });

  it('sahip herkesin üstündedir; sahibi kimse yönetemez (yönetici de)', () => {
    expect(highestRolePosition(ctx, 'sahip', [])).toBe(Number.POSITIVE_INFINITY);
    expect(outranks(ctx, { id: 'sahip', roles: [] }, { id: 'b', roles: ['admin'] })).toBe(true);
    expect(outranks(ctx, { id: 'b', roles: ['admin'] }, { id: 'sahip', roles: [] })).toBe(false);
  });

  it('yalnızca kendi en üst rolünün altındaki rolleri düzenler', () => {
    const mod = { id: 'a', roles: ['mod', 'uye'] };
    expect(roleIsBelow(ctx, mod, ctx.roles.dj!)).toBe(true);
    expect(roleIsBelow(ctx, mod, ctx.roles.g!)).toBe(true);
    expect(roleIsBelow(ctx, mod, ctx.roles.mod!)).toBe(false);
    expect(roleIsBelow(ctx, mod, ctx.roles.admin!)).toBe(false);
    expect(roleIsBelow(ctx, { id: 'b', roles: [] }, ctx.roles.g!)).toBe(false);
    expect(roleIsBelow(ctx, { id: 'sahip', roles: [] }, ctx.roles.admin!)).toBe(true);
  });
});

describe('görünüm', () => {
  it('ad rengi ve üye listesi grubu en üstteki renkli / ayrı gösterilen rolden gelir', () => {
    expect(memberColor(ctx, ['dj', 'mod'])).toBe('#3498db');
    expect(memberColor(ctx, ['uye'])).toBeNull();
    expect(hoistedRole(ctx, ['dj', 'mod', 'admin'])?.id).toBe('admin');
    expect(hoistedRole(ctx, ['dj'])).toBeNull();
    expect(sortRoles(Object.values(ctx.roles)).map((r) => r.id)).toEqual(['admin', 'mod', 'dj', 'uye', 'g']);
  });
});
