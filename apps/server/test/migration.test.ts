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

/** 0.4.x sürümündeki (şema 8, üretimdeki) gibi bir veritabanı: kanallara bağlı her türden kayıt */
function schema8Database(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-goc9-'));
  dirs.push(dir);
  const file = path.join(dir, 'diskort.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  for (const sql of MIGRATIONS.slice(0, 8)) db.exec(sql);
  db.exec('PRAGMA user_version = 8');
  db.exec(`
    INSERT INTO guilds (id, name, created_at) VALUES ('g1', 'Eski', 1);
    INSERT INTO roles (id, guild_id, name, position, permissions, created_at) VALUES ('g1', 'g1', '@everyone', 0, 0, 1);
    INSERT INTO users (id, username, display_name, password_hash, avatar_color, created_at)
      VALUES ('u1', 'ali', 'Ali', 'x', '#5865f2', 1), ('u2', 'veli', 'Veli', 'x', '#5865f2', 2);
    INSERT INTO channels (id, guild_id, name, type, position, created_at)
      VALUES ('t1', 'g1', 'genel', 'text', 0, 1), ('v1', 'g1', 'Ses', 'voice', 1, 1);
    INSERT INTO channel_overwrites (channel_id, role_id, allow, deny) VALUES ('t1', 'g1', 0, 128);
    INSERT INTO messages (channel_id, author_id, content, created_at) VALUES ('t1', 'u1', 'selam', 5), ('t1', 'u2', 'naber', 6);
    INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (1, 'u2', '👍', 7);
    INSERT INTO attachments (id, message_id, channel_id, uploader_id, name, size, content_type, created_at)
      VALUES ('a1', 1, 't1', 'u1', 'not.txt', 3, 'text/plain', 5);
    INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count) VALUES ('u2', 't1', 1, 1);
  `);
  db.close();
  return file;
}

describe('göç 9: direkt mesajlar', () => {
  it('kanallar tablosu yeniden kurulurken kanala bağlı hiçbir kayıt kaybolmaz', () => {
    const store = new Store(schema8Database());
    try {
      const db = store.db;
      const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(count('channels')).toBe(2);
      expect(count('messages')).toBe(2);
      expect(count('reactions')).toBe(1);
      expect(count('attachments')).toBe(1);
      expect(count('read_states')).toBe(1);
      expect(store.listChannels('g1').map((c) => [c.id, c.type, c.overwrites.length])).toEqual([
        ['t1', 'text', 1],
        ['v1', 'voice', 0],
      ]);
      expect(
        store.listMessages('t1', null, 10, 'u1').map((m) => [m.content, m.reactions.length, m.attachments.length]),
      ).toEqual([
        ['selam', 1, 1],
        ['naber', 0, 0],
      ]);

      // Yeni tür ve kurallar: DM topluluğa bağlı olamaz, topluluk kanalı bağsız olamaz
      expect(() =>
        db.exec(`INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES ('d1', 'g1', '', 'dm', 0, 1)`),
      ).toThrow();
      expect(() =>
        db.exec(`INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES ('t2', NULL, 'x', 'text', 0, 1)`),
      ).toThrow();
      const { dm } = store.openDirectDm('u1', 'u2');
      expect(store.getChannel(dm.id)).toBeNull();
      expect(store.listChannels('g1')).toHaveLength(2);
      expect(new PermissionService(store).inChannel('u2', dm.id)).toBeGreaterThan(0);

      // Yabancı anahtarlar yeni tabloya bağlı: kanal silinince mesajları da gider
      store.deleteChannel('t1');
      expect(count('messages')).toBe(0);
      expect(count('read_states')).toBe(0);
    } finally {
      store.close();
    }
  });
});

describe('göç 10: yanıtlar', () => {
  it('şema 8 veritabanı 9 ve 10 ile göçer; eski mesajlar yanıt değildir, yeni yanıtlar özetiyle okunur', () => {
    const store = new Store(schema8Database());
    try {
      expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
      const [first, second] = store.listMessages('t1', null, 50, 'u1');
      expect(first).toMatchObject({ content: 'selam', replyToId: null, referencedMessage: null, replyMentionUserId: null });
      expect(second).toMatchObject({ content: 'naber', replyToId: null });
      expect(first!.attachments).toHaveLength(1);
      expect(first!.reactions).toHaveLength(1);
      const reply = store.createMessage(
        't1',
        'u2',
        'yanıt',
        [],
        { userIds: ['u1'], everyone: false },
        { toId: Number(first!.id), mentionUserId: 'u1' },
      )!;
      expect(reply).toMatchObject({
        replyToId: first!.id,
        replyMentionUserId: 'u1',
        referencedMessage: { id: first!.id, authorId: 'u1', content: 'selam', hasAttachments: true },
      });
      expect(store.mentionCounts('u1')).toEqual({ t1: 1 });
    } finally {
      store.close();
    }
  });
});

describe('göç 11: GIF ve videolar', () => {
  it('şema 8 veritabanı 9, 10 ve 11 ile göçer; eski kayıtlar korunur, GIF ve video bilgisi saklanır', () => {
    const store = new Store(schema8Database());
    try {
      expect(MIGRATIONS).toHaveLength(11);
      expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 11 });
      expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      const [first, second] = store.listMessages('t1', null, 50, 'u1');
      expect(first).toMatchObject({ content: 'selam', embeds: [], replyToId: null });
      expect(first!.attachments).toEqual([
        expect.objectContaining({ id: 'a1', name: 'not.txt', contentType: 'text/plain', duration: null }),
      ]);
      expect(first!.reactions).toHaveLength(1);
      expect(second).toMatchObject({ content: 'naber', embeds: [] });

      // GIF mesajı ve ona yanıt: özette bağlantı yerine "GIF"
      const gif = store.createMessage('t1', 'u1', 'https://giphy.com/gifs/kedi1', [], { userIds: [], everyone: false })!;
      const embed = {
        type: 'gif' as const,
        provider: 'giphy' as const,
        id: 'kedi1',
        url: 'https://giphy.com/gifs/kedi1',
        title: '',
        width: 480,
        height: 270,
        gif: 'https://media.giphy.com/media/kedi1/giphy.gif',
        mp4: null,
        webp: null,
        still: null,
      };
      store.setMessageEmbeds(Number(gif.id), [embed]);
      expect(store.getMessage(Number(gif.id))!.embeds).toEqual([embed]);
      const reply = store.createMessage('t1', 'u2', 'güzel', [], { userIds: [], everyone: false }, {
        toId: Number(gif.id),
        mentionUserId: null,
      })!;
      expect(reply.referencedMessage).toEqual({ id: gif.id, authorId: 'u1', content: 'GIF', hasAttachments: false });

      store.createAttachment({
        id: 'b'.repeat(32),
        channelId: 't1',
        uploaderId: 'u1',
        name: 'v.mp4',
        size: 10,
        contentType: 'video/mp4',
        width: 1920,
        height: 1080,
        duration: 12.5,
      });
      expect(store.getAttachment('b'.repeat(32))!.attachment).toMatchObject({ duration: 12.5, width: 1920 });
    } finally {
      store.close();
    }
  });
});
