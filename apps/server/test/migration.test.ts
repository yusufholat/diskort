import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, hasPermission, Permission as P } from '@diskort/shared';
import { MIGRATIONS, Store } from '../src/db.js';
import { PermissionService } from '../src/permissions.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** 0.3.2 sürümündeki (şema 7, üretimdeki) gibi bir veritabanı: iki yönetici, bir üye */
function legacyDatabase(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-goc-'));
  dirs.push(dir);
  const file = path.join(dir, 'diskort.db');
  const db = new DatabaseSync(file);
  for (const sql of MIGRATIONS.slice(0, 7)) db.exec(sql);
  db.exec('PRAGMA user_version = 7');
  db.exec(`INSERT INTO guilds (id, name, created_at) VALUES ('g1', 'Eski', 1)`);
  const user = db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, avatar_color, is_admin, created_at)
     VALUES (?, ?, ?, 'x', '#5865f2', ?, ?)`,
  );
  user.run('uye', 'uye', 'Üye', 0, 100);
  user.run('ikinci', 'ikinci', 'İkinci Yönetici', 1, 300);
  user.run('kurucu', 'kurucu', 'Kurucu', 1, 200);
  db.exec(`UPDATE users SET avatar_hash = 'abc123' WHERE id = 'kurucu'`);
  db.exec(`INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES ('t1', 'g1', 'genel', 'text', 0, 1)`);
  db.close();
  return file;
}

describe('göç 8: roller', () => {
  it('yöneticiler Yönetici rolüne geçer, en eski yönetici sahip olur, herkes bugünkü yetkilerini korur', () => {
    const store = new Store(legacyDatabase());
    try {
      expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
      const guild = store.ensureGuild('Yeni ad yok sayılır');
      expect(guild).toEqual({ id: 'g1', name: 'Eski', ownerId: 'kurucu' });

      const roles = Object.values(store.permissionData().roles).sort((a, b) => b.position - a.position);
      expect(roles.map((r) => [r.name, r.position])).toEqual([
        ['Yönetici', 1],
        ['@everyone', 0],
      ]);
      const [admin, everyone] = roles;
      expect(everyone!.id).toBe('g1');
      expect(admin!.permissions).toBe(P.ADMINISTRATOR);
      expect(admin!.hoist).toBe(true);

      expect(store.getUser('kurucu')).toMatchObject({
        isAdmin: true,
        roles: [admin!.id],
        removed: false,
        avatarUrl: '/api/avatars/kurucu/abc123.webp',
      });
      expect(store.getUser('ikinci')).toMatchObject({ isAdmin: true, roles: [admin!.id] });
      expect(store.getUser('uye')).toMatchObject({ isAdmin: false, roles: [] });

      const perms = new PermissionService(store);
      expect(perms.base('ikinci')).toBe(ALL_PERMISSIONS);
      const member = perms.inChannel('uye', 't1');
      for (const flag of [P.VIEW_CHANNEL, P.SEND_MESSAGES, P.ATTACH_FILES, P.ADD_REACTIONS]) {
        expect(hasPermission(member, flag)).toBe(true);
      }
      for (const flag of [P.MANAGE_MESSAGES, P.MANAGE_CHANNELS, P.MANAGE_INVITES, P.KICK_MEMBERS]) {
        expect(hasPermission(perms.base('uye'), flag)).toBe(false);
      }
      expect(perms.outranks('kurucu', 'ikinci')).toBe(true);
      expect(perms.outranks('ikinci', 'kurucu')).toBe(false);
      expect(store.listChannels('g1')[0]!.overwrites).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('göç tekrar açılışta yeniden çalışmaz; is_admin sütunu rollerle güncel kalır', () => {
    const file = legacyDatabase();
    new Store(file).close();
    const store = new Store(file);
    try {
      store.ensureGuild('x');
      expect(Object.keys(store.permissionData().roles)).toHaveLength(2);
      const adminRole = Object.values(store.permissionData().roles).find((r) => r.name === 'Yönetici')!;
      store.removeMemberRole('ikinci', adminRole.id);
      const flags = store.db.prepare('SELECT id, is_admin FROM users ORDER BY id').all();
      expect(flags).toEqual([
        { id: 'ikinci', is_admin: 0 },
        { id: 'kurucu', is_admin: 1 },
        { id: 'uye', is_admin: 0 },
      ]);
    } finally {
      store.close();
    }
  });
});

describe('göç 10: yanıtlar', () => {
  it('üretimdeki şema 8 veritabanı göçer; eski mesajlar yanıt değildir, yeni yanıtlar özetiyle okunur', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-goc-'));
    dirs.push(dir);
    const file = path.join(dir, 'diskort.db');
    const db = new DatabaseSync(file);
    for (const sql of MIGRATIONS.slice(0, 8)) db.exec(sql);
    db.exec('PRAGMA user_version = 8');
    db.exec(`INSERT INTO guilds (id, name, created_at) VALUES ('g1', 'Eski', 1)`);
    db.exec(`INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES ('t1', 'g1', 'genel', 'text', 0, 1)`);
    db.exec(
      `INSERT INTO users (id, username, display_name, password_hash, avatar_color, is_admin, created_at)
       VALUES ('ali', 'ali', 'Ali', 'x', '#5865f2', 0, 1), ('veli', 'veli', 'Veli', 'x', '#5865f2', 0, 2)`,
    );
    db.exec(`INSERT INTO messages (channel_id, author_id, content, created_at) VALUES ('t1', 'ali', 'eski mesaj', 1)`);
    db.close();

    const store = new Store(file);
    try {
      expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
      const [old] = store.listMessages('t1', null, 50);
      expect(old).toMatchObject({ content: 'eski mesaj', replyToId: null, referencedMessage: null, replyMentionUserId: null });
      const reply = store.createMessage(
        't1',
        'veli',
        'yanıt',
        [],
        { userIds: ['ali'], everyone: false },
        { toId: Number(old!.id), mentionUserId: 'ali' },
      )!;
      expect(reply).toMatchObject({
        replyToId: old!.id,
        replyMentionUserId: 'ali',
        referencedMessage: { id: old!.id, authorId: 'ali', content: 'eski mesaj', hasAttachments: false },
      });
    } finally {
      store.close();
    }
  });
});
