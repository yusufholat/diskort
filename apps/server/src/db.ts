import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nanoid, customAlphabet } from 'nanoid';
import {
  extractMentions,
  MESSAGE_MAX_REACTIONS,
  type Attachment,
  type Channel,
  type ChannelType,
  type Guild,
  type Invite,
  type Message,
  type Reaction,
  type User,
} from '@diskort/shared';
import { AVATAR_COLORS } from '@diskort/shared';

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
  // 2: şifre sıfırlama kodları; şifre değişince eski oturumları geçersiz kılmak için zaman damgası
  `
  ALTER TABLE users ADD COLUMN sessions_valid_after INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE reset_codes (
    code       TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  // 3: metin kanalları — mesajlar ve kullanıcı başına okunma durumu; mevcut topluluğa bir metin kanalı
  `
  CREATE TABLE messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    edited_at  INTEGER
  );
  CREATE INDEX messages_by_channel ON messages(channel_id, id);
  CREATE TABLE read_states (
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_id INTEGER NOT NULL,
    mention_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, channel_id)
  );
  INSERT INTO channels (id, guild_id, name, type, position, created_at)
    SELECT lower(hex(randomblob(6))), g.id, 'genel-sohbet', 'text', 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000
    FROM guilds g WHERE NOT EXISTS (SELECT 1 FROM channels WHERE type = 'text');
  `,
  // 4: telefonlara bildirim göndermek için cihaz jetonları (FCM / APNs)
  `
  CREATE TABLE push_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform   TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL
  );
  CREATE INDEX push_tokens_by_user ON push_tokens(user_id);
  `,
  // 5: mesaj tepkileri — kullanıcı başına, emoji başına bir kayıt
  `
  CREATE TABLE reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, emoji, user_id)
  ) WITHOUT ROWID;
  CREATE INDEX reactions_by_user ON reactions(user_id);
  `,
  // 6: dosya ekleri. Dosyanın kendisi <DATA_DIR>/attachments/<id>; message_id boşsa yüklenmiş ama
  // henüz bir mesaja eklenmemiştir (bir saat içinde eklenmezse silinir).
  `
  CREATE TABLE attachments (
    id           TEXT PRIMARY KEY,
    message_id   INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    uploader_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    size         INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    width        INTEGER,
    height       INTEGER,
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX attachments_by_message ON attachments(message_id, position);
  CREATE INDEX attachments_by_channel ON attachments(channel_id);
  CREATE INDEX attachments_by_uploader ON attachments(uploader_id);
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
  sessions_valid_after: number;
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

interface MessageRow {
  id: number;
  channel_id: string;
  author_id: string | null;
  content: string;
  created_at: number;
  edited_at: number | null;
}

const toMessage = (r: MessageRow): Message => ({
  id: String(r.id),
  channelId: r.channel_id,
  authorId: r.author_id,
  content: r.content,
  createdAt: r.created_at,
  editedAt: r.edited_at,
  attachments: [],
  reactions: [],
});

interface AttachmentRow {
  id: string;
  message_id: number | null;
  channel_id: string;
  uploader_id: string | null;
  name: string;
  size: number;
  content_type: string;
  width: number | null;
  height: number | null;
}

const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  name: r.name,
  size: r.size,
  contentType: r.content_type,
  width: r.width,
  height: r.height,
  url: `/api/attachments/${r.id}/${encodeURIComponent(r.name)}`,
});

export type AddReactionResult = 'added' | 'exists' | 'limit';


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

  /** Bu andan önce verilmiş oturum jetonları geçersizdir (ms, saniyeye yuvarlanmış). */
  getSessionsValidAfter(userId: string): number | null {
    return this.one<{ v: number }>('SELECT sessions_valid_after AS v FROM users WHERE id = ?', userId)?.v ?? null;
  }

  /** Şifreyi değiştirir ve kullanıcının diğer tüm oturumlarını geçersiz kılar. */
  setPassword(userId: string, passwordHash: string): void {
    const validAfter = Math.floor(Date.now() / 1000) * 1000;
    this.run('UPDATE users SET password_hash = ?, sessions_valid_after = ? WHERE id = ?', passwordHash, validAfter, userId);
    this.run('DELETE FROM reset_codes WHERE user_id = ?', userId);
  }

  setAdmin(userId: string, isAdmin: boolean): User | null {
    this.run('UPDATE users SET is_admin = ? WHERE id = ?', isAdmin ? 1 : 0, userId);
    return this.getUser(userId);
  }

  countAdmins(): number {
    return this.one<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1')!.n;
  }

  deleteUser(userId: string): boolean {
    return this.run('DELETE FROM users WHERE id = ?', userId) > 0;
  }

  /** Kullanıcı için yeni tek kullanımlık sıfırlama kodu (öncekiler geçersiz olur). */
  createResetCode(userId: string, createdBy: string, ttlMs: number): { code: string; expiresAt: number } {
    const code = inviteCode();
    const expiresAt = Date.now() + ttlMs;
    this.tx(() => {
      this.run('DELETE FROM reset_codes WHERE user_id = ?', userId);
      this.run(
        'INSERT INTO reset_codes (code, user_id, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        code,
        userId,
        createdBy,
        expiresAt,
        Date.now(),
      );
    });
    return { code, expiresAt };
  }

  /** Kod bu kullanıcıya aitse ve süresi geçmemişse tüketir ve kullanıcı kimliğini döner. */
  consumeResetCode(username: string, code: string): string | null {
    return this.tx(() => {
      const row = this.one<{ user_id: string; expires_at: number }>(
        `SELECT r.user_id, r.expires_at FROM reset_codes r JOIN users u ON u.id = r.user_id
         WHERE r.code = ? AND u.username = ?`,
        code.trim().toUpperCase(),
        username,
      );
      if (!row) return null;
      this.run('DELETE FROM reset_codes WHERE code = ?', code.trim().toUpperCase());
      return row.expires_at >= Date.now() ? row.user_id : null;
    });
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
      const defaults: [string, ChannelType][] = [
        ['genel-sohbet', 'text'],
        ['Genel', 'voice'],
        ['Oyun', 'voice'],
        ['Müzik', 'voice'],
      ];
      defaults.forEach(([channelName, type], i) => {
        this.run(
          'INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          nanoid(12),
          guild.id,
          channelName,
          type,
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

  // ---------- Bildirim jetonları ----------

  /** Cihaz jetonunu kaydeder; aynı cihaz başka hesaba geçtiyse jeton yeni hesaba taşınır. */
  savePushToken(userId: string, token: string, platform: string): void {
    const now = Date.now();
    this.run(
      `INSERT INTO push_tokens (token, user_id, platform, created_at, last_seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, last_seen = excluded.last_seen`,
      token,
      userId,
      platform,
      now,
      now,
    );
  }

  removePushToken(token: string): void {
    this.run('DELETE FROM push_tokens WHERE token = ?', token);
  }

  pushTokens(userIds: string[]): { token: string; userId: string; platform: string }[] {
    if (userIds.length === 0) return [];
    return this.all<{ token: string; user_id: string; platform: string }>(
      `SELECT token, user_id, platform FROM push_tokens WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
      ...userIds,
    ).map((r) => ({ token: r.token, userId: r.user_id, platform: r.platform }));
  }

  // ---------- Mesajlar ----------

  /**
   * En yeni mesajlardan geriye doğru bir sayfa; sonuç eskiden yeniye sıralıdır. Tepkilerdeki `me`
   * alanı `viewerId` kullanıcısına göredir.
   */
  listMessages(channelId: string, before: number | null, limit: number, viewerId: string | null = null): Message[] {
    const rows = before
      ? this.all<MessageRow>(
          'SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
          channelId,
          before,
          limit,
        )
      : this.all<MessageRow>('SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?', channelId, limit);
    return this.withDetails(rows.reverse().map(toMessage), viewerId);
  }

  getMessage(id: number, viewerId: string | null = null): Message | null {
    const row = this.one<MessageRow>('SELECT * FROM messages WHERE id = ?', id);
    return row ? this.withDetails([toMessage(row)], viewerId)[0]! : null;
  }

  /** Mesajlara dosya eklerini ve tepkilerini ekler (her biri tek sorguda). */
  private withDetails(messages: Message[], viewerId: string | null): Message[] {
    if (messages.length === 0) return messages;
    const ids = messages.map((m) => Number(m.id));
    const marks = ids.map(() => '?').join(',');
    const attachments = new Map<string, Attachment[]>();
    for (const r of this.all<AttachmentRow>(
      `SELECT * FROM attachments WHERE message_id IN (${marks}) ORDER BY message_id, position`,
      ...ids,
    )) {
      const list = attachments.get(String(r.message_id)) ?? [];
      list.push(toAttachment(r));
      attachments.set(String(r.message_id), list);
    }
    const reactions = new Map<string, Reaction[]>();
    for (const r of this.all<{ message_id: number; emoji: string; n: number; me: number }>(
      `SELECT message_id, emoji, COUNT(*) AS n, MAX(user_id = ?) AS me, MIN(created_at) AS first
       FROM reactions WHERE message_id IN (${marks})
       GROUP BY message_id, emoji ORDER BY first, emoji`,
      viewerId,
      ...ids,
    )) {
      const list = reactions.get(String(r.message_id)) ?? [];
      list.push({ emoji: r.emoji, count: r.n, me: r.me === 1 });
      reactions.set(String(r.message_id), list);
    }
    return messages.map((m) => ({
      ...m,
      attachments: attachments.get(m.id) ?? [],
      reactions: reactions.get(m.id) ?? [],
    }));
  }

  /** Kullanıcının tepkisini ekler; mesajda en fazla MESSAGE_MAX_REACTIONS farklı emoji olabilir. */
  addReaction(messageId: number, userId: string, emoji: string): AddReactionResult {
    return this.tx((): AddReactionResult => {
      const known = this.one('SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ? LIMIT 1', messageId, emoji);
      if (!known) {
        const distinct = this.one<{ n: number }>(
          'SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id = ?',
          messageId,
        )!.n;
        if (distinct >= MESSAGE_MAX_REACTIONS) return 'limit';
      }
      const added = this.run(
        'INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)',
        messageId,
        userId,
        emoji,
        Date.now(),
      );
      return added > 0 ? 'added' : 'exists';
    });
  }

  /** Kullanıcının tepkisini kaldırır; yoksa false. */
  removeReaction(messageId: number, userId: string, emoji: string): boolean {
    return (
      this.run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', messageId, userId, emoji) > 0
    );
  }

  /**
   * Mesajı kaydeder ve yüklenmiş dosyaları ona bağlar (dosyalar bu kullanıcının, bu kanala yüklediği ve
   * henüz kullanılmamış dosyalar olmalı; değilse null döner). Bahsedilen kullanıcıların okunmamış
   * bahsetme sayısını artırır.
   */
  createMessage(channelId: string, authorId: string, content: string, attachmentIds: string[] = []): Message | null {
    return this.tx((): Message | null => {
      for (const attachmentId of attachmentIds) {
        const row = this.one<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', attachmentId);
        if (!row || row.uploader_id !== authorId || row.channel_id !== channelId || row.message_id !== null) return null;
      }
      const id = Number(
        this.db
          .prepare('INSERT INTO messages (channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?)')
          .run(channelId, authorId, content, Date.now()).lastInsertRowid,
      );
      attachmentIds.forEach((attachmentId, position) => {
        this.run('UPDATE attachments SET message_id = ?, position = ? WHERE id = ?', id, position, attachmentId);
      });
      for (const userId of this.resolveMentions(content, authorId)) {
        this.run(
          `INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count) VALUES (?, ?, 0, 1)
           ON CONFLICT (user_id, channel_id) DO UPDATE SET mention_count = mention_count + 1`,
          userId,
          channelId,
        );
      }
      return this.getMessage(id)!;
    });
  }

  /** Metinde bahsedilen (var olan) kullanıcıların kimlikleri; yazar hariç. */
  resolveMentions(content: string, authorId: string | null): string[] {
    const ids: string[] = [];
    for (const username of extractMentions(content)) {
      const user = this.one<{ id: string }>('SELECT id FROM users WHERE username = ?', username);
      if (user && user.id !== authorId) ids.push(user.id);
    }
    return ids;
  }

  updateMessage(id: number, content: string, viewerId: string | null = null): Message | null {
    this.run('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?', content, Date.now(), id);
    return this.getMessage(id, viewerId);
  }

  /** Mesajı siler; diskten de silinmesi gereken dosya eklerinin kimliklerini döner. */
  deleteMessage(id: number): string[] {
    return this.tx(() => {
      const files = this.all<{ id: string }>('SELECT id FROM attachments WHERE message_id = ?', id).map((r) => r.id);
      this.run('DELETE FROM messages WHERE id = ?', id);
      return files;
    });
  }

  // ---------- Dosya ekleri ----------

  createAttachment(a: {
    id: string;
    channelId: string;
    uploaderId: string;
    name: string;
    size: number;
    contentType: string;
    width: number | null;
    height: number | null;
  }): Attachment {
    this.run(
      `INSERT INTO attachments (id, channel_id, uploader_id, name, size, content_type, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.id,
      a.channelId,
      a.uploaderId,
      a.name,
      a.size,
      a.contentType,
      a.width,
      a.height,
      Date.now(),
    );
    return this.getAttachment(a.id)!.attachment;
  }

  /** Ek ve bağlı olduğu mesaj (henüz bir mesaja eklenmediyse null). */
  getAttachment(id: string): { attachment: Attachment; messageId: number | null } | null {
    const row = this.one<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', id);
    return row ? { attachment: toAttachment(row), messageId: row.message_id } : null;
  }

  attachmentExists(id: string): boolean {
    return this.one('SELECT 1 FROM attachments WHERE id = ?', id) !== undefined;
  }

  /** Kanal silinmeden önce: diskten silinecek dosyalar */
  channelAttachmentIds(channelId: string): string[] {
    return this.all<{ id: string }>('SELECT id FROM attachments WHERE channel_id = ?', channelId).map((r) => r.id);
  }

  /** Belirtilen andan önce yüklenip hiçbir mesaja eklenmemiş dosyalar */
  stalePendingAttachments(before: number): string[] {
    return this.all<{ id: string }>(
      'SELECT id FROM attachments WHERE message_id IS NULL AND created_at < ?',
      before,
    ).map((r) => r.id);
  }

  deleteAttachments(ids: string[]): void {
    for (const id of ids) this.run('DELETE FROM attachments WHERE id = ?', id);
  }

  /** Kanal başına en son mesaj kimliği (okunmamış göstergesi için). */
  lastMessageIds(): Record<string, string> {
    return Object.fromEntries(
      this.all<{ channel_id: string; id: number }>(
        'SELECT channel_id, MAX(id) AS id FROM messages GROUP BY channel_id',
      ).map((r) => [r.channel_id, String(r.id)]),
    );
  }

  readStates(userId: string): Record<string, string> {
    return Object.fromEntries(
      this.all<{ channel_id: string; last_read_id: number }>(
        'SELECT channel_id, last_read_id FROM read_states WHERE user_id = ?',
        userId,
      ).map((r) => [r.channel_id, String(r.last_read_id)]),
    );
  }

  mentionCounts(userId: string): Record<string, number> {
    return Object.fromEntries(
      this.all<{ channel_id: string; mention_count: number }>(
        'SELECT channel_id, mention_count FROM read_states WHERE user_id = ? AND mention_count > 0',
        userId,
      ).map((r) => [r.channel_id, r.mention_count]),
    );
  }

  /** Okunma durumunu yalnızca ileri taşır; kanalın sonuna kadar okunduysa bahsetme sayısı sıfırlanır. */
  ack(userId: string, channelId: string, messageId: number): void {
    this.run(
      `INSERT INTO read_states (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT (user_id, channel_id) DO UPDATE SET
         last_read_id = MAX(last_read_id, excluded.last_read_id),
         mention_count = CASE
           WHEN excluded.last_read_id >= (SELECT COALESCE(MAX(id), 0) FROM messages WHERE channel_id = excluded.channel_id)
           THEN 0 ELSE mention_count END`,
      userId,
      channelId,
      messageId,
    );
  }
}
