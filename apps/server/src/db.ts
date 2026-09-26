import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nanoid, customAlphabet } from 'nanoid';
import type { Channel, ChannelType, Guild, Invite, User } from '@diskurt/shared';
import { AVATAR_COLORS } from '@diskurt/shared';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_color  TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE invites (
    code         TEXT PRIMARY KEY,
    created_by   TEXT,
    max_uses     INTEGER,
    uses         INTEGER NOT NULL DEFAULT 0,
    expires_at   INTEGER,
    created_at   INTEGER NOT NULL,
    grants_admin INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE guilds (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE channels (
    id         TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('voice', 'text')),
    position   INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
];

type Param = string | number | null;

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  avatar_color: string;
  is_admin: number;
}

interface InviteRow {
  code: string;
  created_by: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  created_at: number;
  grants_admin: number;
}

interface ChannelRow {
  id: string;
  guild_id: string;
  name: string;
  type: ChannelType;
  position: number;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  avatarColor: r.avatar_color,
  isAdmin: r.is_admin === 1,
});

const toInvite = (r: InviteRow): Invite => ({
  code: r.code,
  createdBy: r.created_by ?? '',
  maxUses: r.max_uses,
  uses: r.uses,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
});

const toChannel = (r: ChannelRow): Channel => ({
  id: r.id,
  guildId: r.guild_id,
  name: r.name,
  type: r.type,
  position: r.position,
});

const inviteCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

export type InviteCheck = { ok: true; invite: InviteRow } | { ok: false; reason: string };

export type RegisterResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'invite' | 'username'; message: string };

/** SQLite (node:sqlite) üzerinde kalıcı veri erişimi. */
export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const current = this.one<{ user_version: number }>('PRAGMA user_version')!.user_version;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private one<T>(sql: string, ...params: Param[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private all<T>(sql: string, ...params: Param[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private run(sql: string, ...params: Param[]): number {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  // ---------- Kullanıcılar ----------

  countUsers(): number {
    return this.one<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
  }

  getUser(id: string): User | null {
    const row = this.one<UserRow>('SELECT * FROM users WHERE id = ?', id);
    return row ? toUser(row) : null;
  }

  getUserAuthByUsername(username: string): (User & { passwordHash: string }) | null {
    const row = this.one<UserRow>('SELECT * FROM users WHERE username = ?', username);
    return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
  }

  listUsers(): User[] {
    return this.all<UserRow>('SELECT * FROM users ORDER BY created_at').map(toUser);
  }

  updateUser(id: string, patch: { displayName?: string; avatarColor?: string }): User | null {
    if (patch.displayName !== undefined) this.run('UPDATE users SET display_name = ? WHERE id = ?', patch.displayName, id);
    if (patch.avatarColor !== undefined) this.run('UPDATE users SET avatar_color = ? WHERE id = ?', patch.avatarColor, id);
    return this.getUser(id);
  }

  /** Davet kodunu kullanarak kullanıcı oluşturur; kodu aynı transaction içinde tüketir. */
  registerWithInvite(input: {
    code: string;
    username: string;
    displayName: string;
    passwordHash: string;
  }): RegisterResult {
    return this.tx((): RegisterResult => {
      const check = this.checkInvite(input.code);
      if (!check.ok) return { ok: false, reason: 'invite', message: check.reason };
      if (this.getUserAuthByUsername(input.username)) {
        return { ok: false, reason: 'username', message: 'Bu kullanıcı adı alınmış.' };
      }
      const id = nanoid(16);
      const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
      const isAdmin = check.invite.grants_admin === 1 || this.countUsers() === 0;
      this.run(
        `INSERT INTO users (id, username, display_name, password_hash, avatar_color, is_admin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.username,
        input.displayName,
        input.passwordHash,
        color,
        isAdmin ? 1 : 0,
        Date.now(),
      );
      this.run('UPDATE invites SET uses = uses + 1 WHERE code = ?', check.invite.code);
      return { ok: true, user: this.getUser(id)! };
    });
  }

  // ---------- Davetler ----------

  createInvite(opts: {
    createdBy: string | null;
    maxUses: number | null;
    expiresAt: number | null;
    grantsAdmin?: boolean;
  }): Invite {
    const code = inviteCode();
    this.run(
      `INSERT INTO invites (code, created_by, max_uses, uses, expires_at, created_at, grants_admin)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
      code,
      opts.createdBy,
      opts.maxUses,
      opts.expiresAt,
      Date.now(),
      opts.grantsAdmin ? 1 : 0,
    );
    return this.getInvite(code)!;
  }

  getInvite(code: string): Invite | null {
    const row = this.one<InviteRow>('SELECT * FROM invites WHERE code = ?', code);
    return row ? toInvite(row) : null;
  }

  listInvites(): Invite[] {
    return this.all<InviteRow>('SELECT * FROM invites WHERE grants_admin = 0 ORDER BY created_at DESC').map(toInvite);
  }

  deleteInvite(code: string): boolean {
    return this.run('DELETE FROM invites WHERE code = ?', code) > 0;
  }

  checkInvite(code: string): InviteCheck {
    const row = this.one<InviteRow>('SELECT * FROM invites WHERE code = ?', code.trim().toUpperCase());
    if (!row) return { ok: false, reason: 'Davet kodu geçersiz.' };
    if (row.expires_at !== null && row.expires_at < Date.now()) {
      return { ok: false, reason: 'Davet kodunun süresi dolmuş.' };
    }
    if (row.max_uses !== null && row.uses >= row.max_uses) {
      return { ok: false, reason: 'Davet kodunun kullanım hakkı dolmuş.' };
    }
    return { ok: true, invite: row };
  }

  /** Hiç kullanıcı yoksa ilk yöneticinin kaydolabilmesi için tek kullanımlık davet döner. */
  ensureBootstrapInvite(): Invite | null {
    if (this.countUsers() > 0) return null;
    const existing = this.one<InviteRow>(
      'SELECT * FROM invites WHERE grants_admin = 1 AND uses = 0 ORDER BY created_at DESC LIMIT 1',
    );
    if (existing) return toInvite(existing);
    return this.createInvite({ createdBy: null, maxUses: 1, expiresAt: null, grantsAdmin: true });
  }

  // ---------- Sunucu (guild) ve kanallar ----------

  /** Tek topluluk modeli: ilk açılışta varsayılan guild ve ses kanallarını oluşturur. */
  ensureGuild(name: string): Guild {
    const row = this.one<Guild>('SELECT id, name FROM guilds ORDER BY created_at LIMIT 1');
    if (row) return { id: row.id, name: row.name };
    const guild: Guild = { id: nanoid(12), name };
    this.tx(() => {
      this.run('INSERT INTO guilds (id, name, created_at) VALUES (?, ?, ?)', guild.id, name, Date.now());
      ['Genel', 'Oyun', 'Müzik'].forEach((channelName, i) => {
        this.run(
          'INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          nanoid(12),
          guild.id,
          channelName,
          'voice',
          i,
          Date.now(),
        );
      });
    });
    return guild;
  }

  listChannels(guildId: string): Channel[] {
    return this.all<ChannelRow>(
      'SELECT * FROM channels WHERE guild_id = ? ORDER BY position, created_at',
      guildId,
    ).map(toChannel);
  }

  getChannel(id: string): Channel | null {
    const row = this.one<ChannelRow>('SELECT * FROM channels WHERE id = ?', id);
    return row ? toChannel(row) : null;
  }

  createChannel(guildId: string, name: string, type: ChannelType): Channel {
    const id = nanoid(12);
    const max = this.one<{ p: number }>(
      'SELECT COALESCE(MAX(position), -1) AS p FROM channels WHERE guild_id = ?',
      guildId,
    )!;
    this.run(
      'INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      guildId,
      name,
      type,
      max.p + 1,
      Date.now(),
    );
    return this.getChannel(id)!;
  }

  updateChannel(id: string, patch: { name?: string; position?: number }): Channel | null {
    if (patch.name !== undefined) this.run('UPDATE channels SET name = ? WHERE id = ?', patch.name, id);
    if (patch.position !== undefined) this.run('UPDATE channels SET position = ? WHERE id = ?', patch.position, id);
    return this.getChannel(id);
  }

  deleteChannel(id: string): boolean {
    return this.run('DELETE FROM channels WHERE id = ?', id) > 0;
  }
}
