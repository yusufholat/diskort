import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nanoid, customAlphabet } from 'nanoid';
import {
  ALL_PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  extractMentions,
  hasPermission,
  MESSAGE_MAX_REACTIONS,
  Permission,
  basePermissions,
  type Attachment,
  type Channel,
  type ChannelType,
  type DmChannel,
  type Guild,
  type Invite,
  type Message,
  type PermissionContext,
  type PermissionOverwrite,
  type Reaction,
  type Role,
  type User,
} from '@diskort/shared';
import { AVATAR_COLORS } from '@diskort/shared';

/**
 * Göç 8'de @everyone'a verilen yetkiler: rollerden önce herkesin yapabildikleri (+ yeni @everyone
 * bahsetmesi). Bit değerleri kalıcı olduğundan göç her zaman aynı sonucu verir.
 */
const V8_EVERYONE =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.ATTACH_FILES |
  Permission.ADD_REACTIONS |
  Permission.MENTION_EVERYONE |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.STREAM;

/** Göçte ve yeni toplulukta oluşturulan yönetici rolü */
const ADMIN_ROLE_NAME = 'Yönetici';
const ADMIN_ROLE_COLOR = '#e67e22';

/** Testler eski şemadan göçü sınayabilsin diye dışa açık */
export const MIGRATIONS: string[] = [
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
  // 7: profil fotoğrafı. Dosyanın kendisi <DATA_DIR>/avatars/<özet>.webp; boşsa baş harfler gösterilir.
  `
  ALTER TABLE users ADD COLUMN avatar_hash TEXT;
  `,
  // 8: roller ve yetkiler. @everyone rolünün kimliği topluluğun kimliğidir. Yöneticiler "Yönetici" rolüne
  // (ADMINISTRATOR) geçer, en eski yönetici topluluğun sahibi olur; diğer herkesin bugünkü yetkileri
  // @everyone'da kalır. users.is_admin artık rollerden hesaplanıp güncel tutulur (eski sürüme dönülürse
  // diye). Atılan/yasaklanan hesap silinmez (mesajları adıyla kalsın): removed_at doluysa üye değildir.
  `
  CREATE TABLE roles (
    id          TEXT PRIMARY KEY,
    guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT,
    position    INTEGER NOT NULL,
    hoist       INTEGER NOT NULL DEFAULT 0,
    permissions INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE member_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  ) WITHOUT ROWID;
  CREATE INDEX member_roles_by_role ON member_roles(role_id);
  CREATE TABLE channel_overwrites (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id    TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    allow      INTEGER NOT NULL DEFAULT 0,
    deny       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, role_id)
  ) WITHOUT ROWID;
  ALTER TABLE guilds ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE users ADD COLUMN removed_at INTEGER;
  ALTER TABLE users ADD COLUMN banned_at INTEGER;
  ALTER TABLE users ADD COLUMN ban_reason TEXT;
  ALTER TABLE users ADD COLUMN server_mute INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN server_deaf INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE messages ADD COLUMN mention_everyone INTEGER NOT NULL DEFAULT 0;
  INSERT INTO roles (id, guild_id, name, color, position, hoist, permissions, created_at)
    SELECT g.id, g.id, '@everyone', NULL, 0, 0, ${V8_EVERYONE}, CAST(strftime('%s', 'now') AS INTEGER) * 1000
    FROM guilds g;
  INSERT INTO roles (id, guild_id, name, color, position, hoist, permissions, created_at)
    SELECT lower(hex(randomblob(6))), g.id, '${ADMIN_ROLE_NAME}', '${ADMIN_ROLE_COLOR}', 1, 1, ${Permission.ADMINISTRATOR},
      CAST(strftime('%s', 'now') AS INTEGER) * 1000
    FROM guilds g;
  INSERT INTO member_roles (user_id, role_id)
    SELECT u.id, r.id FROM users u JOIN roles r ON r.position = 1 AND r.name = '${ADMIN_ROLE_NAME}'
    WHERE u.is_admin = 1;
  UPDATE guilds SET owner_id = (SELECT id FROM users ORDER BY is_admin DESC, created_at, rowid LIMIT 1);
  `,
  // 9: direkt mesajlar. Konuşma da bir kanaldır (type 'dm', topluluğa bağlı değil: guild_id boş); mesajlar,
  // dosyalar, tepkiler ve okunma durumu kanallarınkiyle aynı tablolardadır. Tür denetimi değiştiğinden
  // channels tablosu SQLite'ın önerdiği yolla yeniden kurulur (yeni tablo, kopya, eskisini sil, yeniden
  // adlandır); bu yüzden göçler yabancı anahtar denetimi kapalıyken çalışır (bkz. migrate).
  // dm_channels.pair_key: bire bir konuşmada iki kimliğin sıralı birleşimi (aynı iki kişiye tek konuşma);
  // grupta boş. dm_participants.open: konuşma kişinin listesinde mi (kapatılan konuşma yeni mesajla açılır).
  `
  CREATE TABLE channels_new (
    id         TEXT PRIMARY KEY,
    guild_id   TEXT REFERENCES guilds(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('voice', 'text', 'dm')),
    position   INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    CHECK ((type = 'dm') = (guild_id IS NULL))
  );
  INSERT INTO channels_new (id, guild_id, name, type, position, created_at)
    SELECT id, guild_id, name, type, position, created_at FROM channels;
  DROP TABLE channels;
  ALTER TABLE channels_new RENAME TO channels;
  CREATE TABLE dm_channels (
    channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    pair_key   TEXT UNIQUE,
    owner_id   TEXT REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE dm_participants (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  INTEGER NOT NULL,
    open       INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (channel_id, user_id)
  ) WITHOUT ROWID;
  CREATE INDEX dm_participants_by_user ON dm_participants(user_id);
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
  avatar_hash: string | null;
  removed_at: number | null;
  banned_at: number | null;
  ban_reason: string | null;
  server_mute: number;
  server_deaf: number;
}

interface RoleRow {
  id: string;
  guild_id: string;
  name: string;
  color: string | null;
  position: number;
  hoist: number;
  permissions: number;
}

const toRole = (r: RoleRow): Role => ({
  id: r.id,
  name: r.name,
  color: r.color,
  position: r.position,
  hoist: r.hoist === 1,
  permissions: r.permissions,
});

/** Yetki denetimi için bir DM'in katılımcıları */
export interface DmAccess {
  participantIds: readonly string[];
  group: boolean;
}

/** Yetki hesaplaması için topluluğun anlık görüntüsü (her yazma işleminden sonra yeniden okunur) */
export interface PermissionData extends PermissionContext {
  /** Üye → rolleri (@everyone hariç); rolü olmayan üye listede yoktur */
  memberRoles: ReadonlyMap<string, readonly string[]>;
  /** Üye olmayan hesaplar (atıldı ya da yasaklandı) */
  removed: ReadonlySet<string>;
  /** Topluluğun kanalları, izinleriyle (DM'ler hariç) */
  channels: ReadonlyMap<string, Channel>;
  /** Direkt mesaj konuşmaları: kimlik → katılımcılar */
  dms: ReadonlyMap<string, DmAccess>;
}

export interface BanRow {
  user: User;
  reason: string | null;
  bannedAt: number;
}

/** Giriş denetimi: hesap üye değilse neden */
export type MembershipStatus = 'member' | 'kicked' | 'banned';

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

interface DmRow {
  id: string;
  name: string;
  created_at: number;
  pair_key: string | null;
  owner_id: string | null;
  last_id: number | null;
  last_at: number | null;
}

/** Bire bir konuşmanın anahtarı: iki kimliğin sıralı birleşimi */
const pairKey = (a: string, b: string): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Konuşma satırlarını (son mesaj bilgisiyle) seçen sorgunun başı; WHERE ile tamamlanır */
const DM_SELECT = `
  SELECT c.id, c.name, c.created_at, d.pair_key, d.owner_id,
    (SELECT MAX(m.id) FROM messages m WHERE m.channel_id = c.id) AS last_id,
    (SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id) AS last_at
  FROM channels c JOIN dm_channels d ON d.channel_id = c.id`;


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
  mention_everyone: number;
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
  mentionEveryone: r.mention_everyone === 1,
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


const toChannel = (r: ChannelRow, overwrites: PermissionOverwrite[] = []): Channel => ({
  id: r.id,
  guildId: r.guild_id,
  name: r.name,
  type: r.type,
  position: r.position,
  overwrites,
});

const inviteCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

export type InviteCheck = { ok: true; invite: InviteRow } | { ok: false; reason: string };

export type RegisterResult =
  | { ok: true; user: User; rejoined: boolean }
  | { ok: false; reason: 'invite' | 'username' | 'banned'; message: string };

/** SQLite (node:sqlite) üzerinde kalıcı veri erişimi. */
export class Store {
  readonly db: DatabaseSync;
  /** Yetki anlık görüntüsü; her yazma işleminde silinir, gerekince yeniden okunur */
  private permissionCache: PermissionData | null = null;

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
    if (current >= MIGRATIONS.length) return;
    // Tabloyu yeniden kuran göçler (9) yabancı anahtar denetimi kapalıyken çalışmalı: açıkken eski tablonun
    // silinmesi ona bağlı satırları (mesajları!) da siler. Denetim işlem içinde değiştirilemediğinden
    // göçlerin tamamı için dışarıda kapatılır; göçler yalnızca var olan satırları taşır.
    this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      for (let v = current; v < MIGRATIONS.length; v++) {
        this.tx(() => {
          this.db.exec(MIGRATIONS[v]!);
          this.db.exec(`PRAGMA user_version = ${v + 1}`);
        });
      }
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON');
    }
  }

  private tx<T>(fn: () => T): T {
    this.permissionCache = null;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      // İşlem sırasında okunan (geri alınan) durum önbellekte kalmasın
      this.permissionCache = null;
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
    this.permissionCache = null;
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  private toUser(r: UserRow, data = this.permissionData()): User {
    const roles = [...(data.memberRoles.get(r.id) ?? [])];
    const removed = r.removed_at !== null;
    return {
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      avatarColor: r.avatar_color,
      avatarUrl: r.avatar_hash ? `/api/avatars/${r.id}/${r.avatar_hash}.webp` : null,
      isAdmin: !removed && hasPermission(basePermissions(data, r.id, roles), Permission.ADMINISTRATOR),
      roles,
      removed,
    };
  }

  // ---------- Kullanıcılar ----------

  countUsers(): number {
    return this.one<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
  }

  getUser(id: string): User | null {
    const row = this.one<UserRow>('SELECT * FROM users WHERE id = ?', id);
    return row ? this.toUser(row) : null;
  }

  getUserAuthByUsername(username: string): (User & { passwordHash: string }) | null {
    const row = this.one<UserRow>('SELECT * FROM users WHERE username = ?', username);
    return row ? { ...this.toUser(row), passwordHash: row.password_hash } : null;
  }

  /** Atılan ve yasaklananlar dahil tüm hesaplar (mesajlarda adları görünsün diye) */
  listUsers(): User[] {
    const data = this.permissionData();
    return this.all<UserRow>('SELECT * FROM users ORDER BY created_at').map((r) => this.toUser(r, data));
  }

  /** Hesap topluluğun üyesi mi; değilse atıldı mı yasaklandı mı */
  membership(userId: string): MembershipStatus {
    const row = this.one<{ removed_at: number | null; banned_at: number | null }>(
      'SELECT removed_at, banned_at FROM users WHERE id = ?',
      userId,
    );
    if (!row || row.removed_at === null) return 'member';
    return row.banned_at === null ? 'kicked' : 'banned';
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

  /** Kullanıcının şu anki profil fotoğrafının özeti (yoksa ya da kullanıcı yoksa null). */
  getAvatarHash(userId: string): string | null {
    return this.one<{ h: string | null }>('SELECT avatar_hash AS h FROM users WHERE id = ?', userId)?.h ?? null;
  }

  /**
   * Profil fotoğrafını değiştirir ya da kaldırır (null); önceki özet diskten silinmek üzere döner.
   * Kullanıcı yoksa (bu arada silinmişse) null.
   */
  setAvatar(userId: string, hash: string | null): { user: User; previous: string | null } | null {
    return this.tx(() => {
      const row = this.one<{ h: string | null }>('SELECT avatar_hash AS h FROM users WHERE id = ?', userId);
      if (!row) return null;
      this.run('UPDATE users SET avatar_hash = ? WHERE id = ?', hash, userId);
      return { user: this.getUser(userId)!, previous: row.h };
    });
  }

  /** Kullanılan tüm profil fotoğrafı özetleri (artık dosyaların temizliği için) */
  avatarHashes(): Set<string> {
    return new Set(
      this.all<{ h: string }>('SELECT avatar_hash AS h FROM users WHERE avatar_hash IS NOT NULL').map((r) => r.h),
    );
  }

  /**
   * Davet kodunu kullanarak kullanıcı oluşturur; kodu aynı transaction içinde tüketir. İlk kullanıcı
   * (ya da başlangıç davetiyle gelen) topluluğun sahibi olur ve yönetici rolünü alır.
   */
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
      const founder = check.invite.grants_admin === 1 || this.countUsers() === 0;
      this.run(
        `INSERT INTO users (id, username, display_name, password_hash, avatar_color, is_admin, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        id,
        input.username,
        input.displayName,
        input.passwordHash,
        color,
        Date.now(),
      );
      if (founder) {
        this.run('UPDATE guilds SET owner_id = ? WHERE owner_id IS NULL', id);
        const adminRole = this.one<{ id: string }>(
          `SELECT id FROM roles WHERE (permissions & ${Permission.ADMINISTRATOR}) != 0 ORDER BY position DESC LIMIT 1`,
        );
        if (adminRole) this.run('INSERT OR IGNORE INTO member_roles (user_id, role_id) VALUES (?, ?)', id, adminRole.id);
      }
      this.run('UPDATE invites SET uses = uses + 1 WHERE code = ?', check.invite.code);
      this.syncAdminFlags();
      return { ok: true, user: this.getUser(id)!, rejoined: false };
    });
  }

  /**
   * Atılan hesap yeni bir davet koduyla geri döner (şifresi doğrulandıktan sonra). Yasaklı hesap dönemez;
   * önce yasağın kaldırılması gerekir. Roller geri gelmez (Discord'daki gibi).
   */
  rejoinWithInvite(code: string, userId: string): RegisterResult {
    return this.tx((): RegisterResult => {
      const status = this.membership(userId);
      if (status === 'banned') return { ok: false, reason: 'banned', message: 'Bu hesap sunucudan yasaklandı.' };
      if (status === 'member') return { ok: false, reason: 'username', message: 'Bu kullanıcı adı alınmış.' };
      const check = this.checkInvite(code);
      if (!check.ok) return { ok: false, reason: 'invite', message: check.reason };
      // Atıldığı saniye içinde dönse de yeni oturum jetonu geçerli olsun (jetonlar saniye hassasiyetinde)
      this.run(
        'UPDATE users SET removed_at = NULL, sessions_valid_after = MIN(sessions_valid_after, ?) WHERE id = ?',
        Math.floor(Date.now() / 1000) * 1000,
        userId,
      );
      this.run('UPDATE invites SET uses = uses + 1 WHERE code = ?', check.invite.code);
      return { ok: true, user: this.getUser(userId)!, rejoined: true };
    });
  }

  /**
   * Hesabı topluluktan çıkarır (atma), `ban` verilirse yasaklar. Hesap ve mesajları kalır; oturumları,
   * rolleri, bildirim jetonları ve sıfırlama kodları silinir.
   */
  removeMember(userId: string, ban: { reason: string | null } | null): User | null {
    const now = Date.now();
    this.tx(() => {
      this.run(
        'UPDATE users SET removed_at = COALESCE(removed_at, ?), sessions_valid_after = ? WHERE id = ?',
        now,
        Math.ceil(now / 1000) * 1000,
        userId,
      );
      if (ban) this.run('UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?', now, ban.reason, userId);
      this.run('DELETE FROM member_roles WHERE user_id = ?', userId);
      this.run('DELETE FROM push_tokens WHERE user_id = ?', userId);
      this.run('DELETE FROM reset_codes WHERE user_id = ?', userId);
      this.syncAdminFlags();
    });
    return this.getUser(userId);
  }

  /** Yasağı kaldırır: hesap yeni bir davetle geri dönebilir. */
  unban(userId: string): boolean {
    return (
      this.run('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ? AND banned_at IS NOT NULL', userId) > 0
    );
  }

  listBans(): BanRow[] {
    const data = this.permissionData();
    return this.all<UserRow>('SELECT * FROM users WHERE banned_at IS NOT NULL ORDER BY banned_at DESC').map((r) => ({
      user: this.toUser(r, data),
      reason: r.ban_reason,
      bannedAt: r.banned_at!,
    }));
  }

  /** Sunucu tarafı susturma/sağırlaştırma (kalıcı: kanaldan çıkıp girince de sürer) */
  setServerVoiceFlags(userId: string, flags: { serverMute: boolean; serverDeaf: boolean }): void {
    this.run(
      'UPDATE users SET server_mute = ?, server_deaf = ? WHERE id = ?',
      flags.serverMute ? 1 : 0,
      flags.serverDeaf ? 1 : 0,
      userId,
    );
  }

  serverVoiceFlags(): Map<string, { serverMute: boolean; serverDeaf: boolean }> {
    return new Map(
      this.all<{ id: string; server_mute: number; server_deaf: number }>(
        'SELECT id, server_mute, server_deaf FROM users WHERE server_mute = 1 OR server_deaf = 1',
      ).map((r) => [r.id, { serverMute: r.server_mute === 1, serverDeaf: r.server_deaf === 1 }]),
    );
  }

  // ---------- Roller ve yetkiler ----------

  /** Yetki hesaplaması için roller, üyelerin rolleri, kanal izinleri ve sahip (önbellekli). */
  permissionData(): PermissionData {
    if (this.permissionCache) return this.permissionCache;
    const guild = this.one<{ id: string; owner_id: string | null }>(
      'SELECT id, owner_id FROM guilds ORDER BY created_at LIMIT 1',
    );
    const guildId = guild?.id ?? '';
    const roles: Record<string, Role> = {};
    for (const r of this.all<RoleRow>('SELECT * FROM roles WHERE guild_id = ?', guildId)) roles[r.id] = toRole(r);
    const memberRoles = new Map<string, string[]>();
    for (const r of this.all<{ user_id: string; role_id: string }>(
      'SELECT mr.user_id, mr.role_id FROM member_roles mr JOIN roles r ON r.id = mr.role_id ORDER BY r.position DESC',
    )) {
      const list = memberRoles.get(r.user_id) ?? [];
      list.push(r.role_id);
      memberRoles.set(r.user_id, list);
    }
    const removed = new Set(
      this.all<{ id: string }>('SELECT id FROM users WHERE removed_at IS NOT NULL').map((r) => r.id),
    );
    const channels = new Map(this.listChannels(guildId).map((c) => [c.id, c]));
    const dms = new Map<string, { participantIds: string[]; group: boolean }>();
    for (const r of this.all<{ id: string; pair_key: string | null }>(
      'SELECT channel_id AS id, pair_key FROM dm_channels',
    )) {
      dms.set(r.id, { participantIds: [], group: r.pair_key === null });
    }
    for (const r of this.all<{ channel_id: string; user_id: string }>(
      'SELECT channel_id, user_id FROM dm_participants ORDER BY joined_at, user_id',
    )) {
      dms.get(r.channel_id)?.participantIds.push(r.user_id);
    }
    const data: PermissionData = { guildId, ownerId: guild?.owner_id ?? null, roles, memberRoles, removed, channels, dms };
    this.permissionCache = data;
    return data;
  }

  /**
   * users.is_admin sütununu rollerden hesaplanan duruma eşitler. Sunucu yalnızca rollere bakar; sütun,
   * eski sürüme dönülürse yöneticiler yönetici kalsın diye tutulur.
   */
  private syncAdminFlags(): void {
    const data = this.permissionData();
    for (const r of this.all<{ id: string; is_admin: number; removed_at: number | null }>(
      'SELECT id, is_admin, removed_at FROM users',
    )) {
      const admin =
        r.removed_at === null &&
        hasPermission(basePermissions(data, r.id, data.memberRoles.get(r.id) ?? []), Permission.ADMINISTRATOR);
      if ((r.is_admin === 1) !== admin) this.run('UPDATE users SET is_admin = ? WHERE id = ?', admin ? 1 : 0, r.id);
    }
  }

  getRole(id: string): Role | null {
    return this.permissionData().roles[id] ?? null;
  }

  /** Yeni rol en alta (@everyone'ın hemen üstüne) eklenir; diğerleri bir sıra yukarı kayar. */
  createRole(guildId: string, input: { name: string; color: string | null; hoist: boolean; permissions: number }): Role {
    const id = nanoid(12);
    this.tx(() => {
      this.run('UPDATE roles SET position = position + 1 WHERE guild_id = ? AND position >= 1', guildId);
      this.run(
        `INSERT INTO roles (id, guild_id, name, color, position, hoist, permissions, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        id,
        guildId,
        input.name,
        input.color,
        input.hoist ? 1 : 0,
        input.permissions & ALL_PERMISSIONS,
        Date.now(),
      );
    });
    return this.getRole(id)!;
  }

  updateRole(
    id: string,
    patch: { name?: string; color?: string | null; hoist?: boolean; permissions?: number },
  ): Role | null {
    this.tx(() => {
      if (patch.name !== undefined) this.run('UPDATE roles SET name = ? WHERE id = ?', patch.name, id);
      if (patch.color !== undefined) this.run('UPDATE roles SET color = ? WHERE id = ?', patch.color, id);
      if (patch.hoist !== undefined) this.run('UPDATE roles SET hoist = ? WHERE id = ?', patch.hoist ? 1 : 0, id);
      if (patch.permissions !== undefined) {
        this.run('UPDATE roles SET permissions = ? WHERE id = ?', patch.permissions & ALL_PERMISSIONS, id);
      }
      this.syncAdminFlags();
    });
    return this.getRole(id);
  }

  /** Rolü siler (@everyone silinemez); kalan rollerin sırası boşluksuz yeniden numaralanır. */
  deleteRole(guildId: string, id: string): boolean {
    if (id === guildId) return false;
    return this.tx(() => {
      if (this.run('DELETE FROM roles WHERE id = ? AND guild_id = ?', id, guildId) === 0) return false;
      const rest = this.all<{ id: string }>(
        'SELECT id FROM roles WHERE guild_id = ? AND id != ? ORDER BY position DESC',
        guildId,
        guildId,
      );
      rest.forEach((r, i) => this.run('UPDATE roles SET position = ? WHERE id = ?', rest.length - i, r.id));
      this.syncAdminFlags();
      return true;
    });
  }

  /** Rollerin yeni sırası: `roleIds` yukarıdan aşağı, @everyone hariç tüm roller. */
  setRoleOrder(roleIds: string[]): void {
    this.tx(() => {
      roleIds.forEach((id, i) => this.run('UPDATE roles SET position = ? WHERE id = ?', roleIds.length - i, id));
    });
  }

  /** Üyeye rol verir; zaten varsa false. */
  addMemberRole(userId: string, roleId: string): boolean {
    return this.tx(() => {
      const added = this.run('INSERT OR IGNORE INTO member_roles (user_id, role_id) VALUES (?, ?)', userId, roleId) > 0;
      if (added) this.syncAdminFlags();
      return added;
    });
  }

  /** Üyeden rolü alır; yoksa false. */
  removeMemberRole(userId: string, roleId: string): boolean {
    return this.tx(() => {
      const removed = this.run('DELETE FROM member_roles WHERE user_id = ? AND role_id = ?', userId, roleId) > 0;
      if (removed) this.syncAdminFlags();
      return removed;
    });
  }

  /** Kanalın tüm rol izinlerini verilenlerle değiştirir (boş izinler kaydedilmez). */
  setChannelOverwrites(channelId: string, overwrites: PermissionOverwrite[]): Channel | null {
    this.tx(() => {
      this.run('DELETE FROM channel_overwrites WHERE channel_id = ?', channelId);
      for (const o of overwrites) {
        if (o.allow === 0 && o.deny === 0) continue;
        this.run(
          'INSERT INTO channel_overwrites (channel_id, role_id, allow, deny) VALUES (?, ?, ?, ?)',
          channelId,
          o.roleId,
          o.allow,
          o.deny,
        );
      }
    });
    return this.getChannel(channelId);
  }

  private overwritesByChannel(guildId: string): Map<string, PermissionOverwrite[]> {
    const map = new Map<string, PermissionOverwrite[]>();
    for (const r of this.all<{ channel_id: string; role_id: string; allow: number; deny: number }>(
      `SELECT o.channel_id, o.role_id, o.allow, o.deny FROM channel_overwrites o
       JOIN channels c ON c.id = o.channel_id JOIN roles r ON r.id = o.role_id
       WHERE c.guild_id = ? ORDER BY r.position`,
      guildId,
    )) {
      const list = map.get(r.channel_id) ?? [];
      list.push({ roleId: r.role_id, allow: r.allow, deny: r.deny });
      map.set(r.channel_id, list);
    }
    return map;
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

  /**
   * Tek topluluk modeli: ilk açılışta varsayılan guild'i, kanalları ve rolleri (@everyone, Yönetici)
   * oluşturur.
   */
  ensureGuild(name: string): Guild {
    const row = this.one<{ id: string }>('SELECT id FROM guilds ORDER BY created_at LIMIT 1');
    if (row) {
      this.ensureRoles(row.id);
      return this.getGuild()!;
    }
    const id = nanoid(12);
    this.tx(() => {
      this.run('INSERT INTO guilds (id, name, created_at) VALUES (?, ?, ?)', id, name, Date.now());
      this.ensureRoles(id);
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
          id,
          channelName,
          type,
          i,
          Date.now(),
        );
      });
    });
    return this.getGuild()!;
  }

  /** @everyone yoksa oluşturur; hiç başka rol yoksa yönetici rolünü de (yeni topluluk). */
  private ensureRoles(guildId: string): void {
    if (this.one('SELECT 1 FROM roles WHERE id = ?', guildId)) return;
    const now = Date.now();
    this.run(
      `INSERT INTO roles (id, guild_id, name, color, position, hoist, permissions, created_at)
       VALUES (?, ?, '@everyone', NULL, 0, 0, ?, ?)`,
      guildId,
      guildId,
      DEFAULT_EVERYONE_PERMISSIONS,
      now,
    );
    if (this.one('SELECT 1 FROM roles WHERE guild_id = ? AND id != ?', guildId, guildId)) return;
    this.run(
      `INSERT INTO roles (id, guild_id, name, color, position, hoist, permissions, created_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
      nanoid(12),
      guildId,
      ADMIN_ROLE_NAME,
      ADMIN_ROLE_COLOR,
      Permission.ADMINISTRATOR,
      now,
    );
  }

  getGuild(): Guild | null {
    const row = this.one<{ id: string; name: string; owner_id: string | null }>(
      'SELECT id, name, owner_id FROM guilds ORDER BY created_at LIMIT 1',
    );
    return row ? { id: row.id, name: row.name, ownerId: row.owner_id } : null;
  }

  updateGuild(patch: { name?: string; ownerId?: string }): Guild | null {
    this.tx(() => {
      if (patch.name !== undefined) this.run('UPDATE guilds SET name = ?', patch.name);
      if (patch.ownerId !== undefined) this.run('UPDATE guilds SET owner_id = ?', patch.ownerId);
      this.syncAdminFlags();
    });
    return this.getGuild();
  }

  listChannels(guildId: string): Channel[] {
    const overwrites = this.overwritesByChannel(guildId);
    return this.all<ChannelRow>(
      'SELECT * FROM channels WHERE guild_id = ? ORDER BY position, created_at',
      guildId,
    ).map((r) => toChannel(r, overwrites.get(r.id)));
  }

  /** Topluluğun kanalı; DM'ler burada yoktur (bkz. getDm), kanal yönetimi onlara hiç ulaşamaz. */
  getChannel(id: string): Channel | null {
    const row = this.one<ChannelRow>("SELECT * FROM channels WHERE id = ? AND type != 'dm'", id);
    if (!row) return null;
    const overwrites = this.all<{ role_id: string; allow: number; deny: number }>(
      `SELECT o.role_id, o.allow, o.deny FROM channel_overwrites o JOIN roles r ON r.id = o.role_id
       WHERE o.channel_id = ? ORDER BY r.position`,
      id,
    ).map((o) => ({ roleId: o.role_id, allow: o.allow, deny: o.deny }));
    return toChannel(row, overwrites);
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
    return this.run("DELETE FROM channels WHERE id = ? AND type != 'dm'", id) > 0;
  }

  // ---------- Direkt mesajlar ----------
  // Yetki burada denetlenmez: çağıran (routes/dms.ts, routes/messages.ts) kişinin katılımcı olduğuna bakar.

  private toDm(r: DmRow, participantIds: string[]): DmChannel {
    const group = r.pair_key === null;
    return {
      id: r.id,
      participantIds,
      group,
      name: group && r.name ? r.name : null,
      ownerId: group ? r.owner_id : null,
      createdAt: r.created_at,
      lastMessageId: r.last_id === null ? null : String(r.last_id),
      lastActivityAt: r.last_at ?? r.created_at,
    };
  }

  /** Konuşmaların katılımcıları, katılma sırasıyla */
  private participantsByDm(ids: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return map;
    for (const r of this.all<{ channel_id: string; user_id: string }>(
      `SELECT channel_id, user_id FROM dm_participants WHERE channel_id IN (${ids.map(() => '?').join(',')})
       ORDER BY joined_at, user_id`,
      ...ids,
    )) {
      map.get(r.channel_id)?.push(r.user_id);
    }
    return map;
  }

  getDm(id: string): DmChannel | null {
    const row = this.one<DmRow>(`${DM_SELECT} WHERE c.id = ?`, id);
    return row ? this.toDm(row, this.participantsByDm([id]).get(id)!) : null;
  }

  isDm(id: string): boolean {
    return this.one('SELECT 1 FROM dm_channels WHERE channel_id = ?', id) !== undefined;
  }

  /** Kullanıcının listesinde açık konuşmaları */
  listDms(userId: string): DmChannel[] {
    const rows = this.all<DmRow>(
      `${DM_SELECT} JOIN dm_participants p ON p.channel_id = c.id WHERE p.user_id = ? AND p.open = 1`,
      userId,
    );
    const participants = this.participantsByDm(rows.map((r) => r.id));
    return rows.map((r) => this.toDm(r, participants.get(r.id)!));
  }

  /** Kullanıcının katıldığı tüm konuşmaların kimlikleri (listesinde kapalı olanlar dahil) */
  dmIdsOf(userId: string): string[] {
    return this.all<{ id: string }>('SELECT channel_id AS id FROM dm_participants WHERE user_id = ?', userId).map(
      (r) => r.id,
    );
  }

  /**
   * İki kişi arasındaki bire bir konuşmayı bulur, yoksa oluşturur. Konuşma açan kişinin listesinde açılır;
   * karşı tarafın listesinde ilk mesaj gelince görünür (boş konuşma kimseyi rahatsız etmesin).
   * `opened`: konuşma açan kişinin listesine yeni girdi (yeni ya da önceden kapatılmıştı).
   */
  openDirectDm(userId: string, otherId: string): { dm: DmChannel; created: boolean; opened: boolean } {
    return this.tx(() => {
      const key = pairKey(userId, otherId);
      const existing = this.one<{ id: string }>('SELECT channel_id AS id FROM dm_channels WHERE pair_key = ?', key);
      if (existing) {
        // Hesap silinip yeniden kurulamayacağından kişi hâlâ katılımcıdır; yine de satır yoksa eklenir
        const opened =
          this.run(
            `INSERT INTO dm_participants (channel_id, user_id, joined_at, open) VALUES (?, ?, ?, 1)
             ON CONFLICT (channel_id, user_id) DO UPDATE SET open = 1 WHERE open = 0`,
            existing.id,
            userId,
            Date.now(),
          ) > 0;
        return { dm: this.getDm(existing.id)!, created: false, opened };
      }
      const id = this.insertDm(key, null, null);
      const now = Date.now();
      this.addParticipant(id, userId, now, true);
      this.addParticipant(id, otherId, now, false);
      return { dm: this.getDm(id)!, created: true, opened: true };
    });
  }

  /** Yeni grup konuşması; herkesin listesinde hemen görünür. */
  createGroupDm(ownerId: string, otherIds: string[], name: string | null): DmChannel {
    return this.tx(() => {
      const id = this.insertDm(null, ownerId, name);
      const now = Date.now();
      // Katılma sırası seçilme sırasıdır (sahiplik bu sırayla devredilir): aynı ana birer ms aralıkla
      this.addParticipant(id, ownerId, now, true);
      otherIds.forEach((userId, i) => this.addParticipant(id, userId, now + i + 1, true));
      return this.getDm(id)!;
    });
  }

  private insertDm(key: string | null, ownerId: string | null, name: string | null): string {
    const id = nanoid(12);
    this.run(
      "INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES (?, NULL, ?, 'dm', 0, ?)",
      id,
      name ?? '',
      Date.now(),
    );
    this.run('INSERT INTO dm_channels (channel_id, pair_key, owner_id) VALUES (?, ?, ?)', id, key, ownerId);
    return id;
  }

  private addParticipant(channelId: string, userId: string, joinedAt: number, open: boolean): boolean {
    return (
      this.run(
        'INSERT OR IGNORE INTO dm_participants (channel_id, user_id, joined_at, open) VALUES (?, ?, ?, ?)',
        channelId,
        userId,
        joinedAt,
        open ? 1 : 0,
      ) > 0
    );
  }

  /** Gruba katılımcı ekler (listesinde hemen açılır); zaten katılımcıysa false. */
  addDmParticipant(channelId: string, userId: string): boolean {
    return this.addParticipant(channelId, userId, Date.now(), true);
  }

  /** Konuşmayı kullanıcının listesinden kaldırır (bire bir konuşmada "kapat"); değiştiyse true. */
  closeDm(channelId: string, userId: string): boolean {
    return (
      this.run('UPDATE dm_participants SET open = 0 WHERE channel_id = ? AND user_id = ? AND open = 1', channelId, userId) >
      0
    );
  }

  /** Yeni mesaj geldiğinde: konuşmayı kapatmış katılımcıların listesinde yeniden açar; açılanları döner. */
  reopenDm(channelId: string): string[] {
    return this.tx(() => {
      const closed = this.all<{ user_id: string }>(
        'SELECT user_id FROM dm_participants WHERE channel_id = ? AND open = 0',
        channelId,
      ).map((r) => r.user_id);
      if (closed.length > 0) this.run('UPDATE dm_participants SET open = 1 WHERE channel_id = ? AND open = 0', channelId);
      return closed;
    });
  }

  renameDm(channelId: string, name: string | null): DmChannel | null {
    this.run("UPDATE channels SET name = ? WHERE id = ? AND type = 'dm'", name ?? '', channelId);
    return this.getDm(channelId);
  }

  /**
   * Katılımcı gruptan ayrılır; sahipse sahiplik sıradaki katılımcıya geçer. Kimse kalmazsa konuşma
   * silinir: diskten silinecek dosyalar döner.
   */
  leaveDm(channelId: string, userId: string): { deleted: boolean; files: string[] } {
    return this.tx(() => {
      this.run('DELETE FROM dm_participants WHERE channel_id = ? AND user_id = ?', channelId, userId);
      this.fixDmOwner(channelId);
      const files = this.deleteEmptyDms();
      return { deleted: !this.isDm(channelId), files };
    });
  }

  /** Grubun sahibi artık katılımcı değilse sahiplik en eski katılımcıya geçer. */
  private fixDmOwner(channelId: string): void {
    this.run(
      `UPDATE dm_channels SET owner_id = (
         SELECT user_id FROM dm_participants WHERE channel_id = ?1 ORDER BY joined_at, user_id LIMIT 1)
       WHERE channel_id = ?1 AND pair_key IS NULL AND (owner_id IS NULL OR owner_id NOT IN (
         SELECT user_id FROM dm_participants WHERE channel_id = ?1))`,
      channelId,
    );
  }

  /**
   * Hesap silindikten sonra: grupların sahipliğini düzeltir, katılımcısı kalmayan konuşmaları siler.
   * Diskten silinecek dosyalar döner.
   */
  cleanupDms(channelIds: string[]): string[] {
    return this.tx(() => {
      for (const id of channelIds) this.fixDmOwner(id);
      return this.deleteEmptyDms();
    });
  }

  private deleteEmptyDms(): string[] {
    const empty = this.all<{ id: string }>(
      `SELECT channel_id AS id FROM dm_channels d
       WHERE NOT EXISTS (SELECT 1 FROM dm_participants p WHERE p.channel_id = d.channel_id)`,
    ).map((r) => r.id);
    const files: string[] = [];
    for (const id of empty) {
      files.push(...this.channelAttachmentIds(id));
      this.run("DELETE FROM channels WHERE id = ? AND type = 'dm'", id);
    }
    return files;
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
  createMessage(
    channelId: string,
    authorId: string,
    content: string,
    attachmentIds: string[] = [],
    mentions: { userIds: string[]; everyone: boolean } = {
      userIds: this.resolveMentions(content, authorId),
      everyone: false,
    },
  ): Message | null {
    return this.tx((): Message | null => {
      for (const attachmentId of attachmentIds) {
        const row = this.one<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', attachmentId);
        if (!row || row.uploader_id !== authorId || row.channel_id !== channelId || row.message_id !== null) return null;
      }
      const id = Number(
        this.db
          .prepare(
            'INSERT INTO messages (channel_id, author_id, content, created_at, mention_everyone) VALUES (?, ?, ?, ?, ?)',
          )
          .run(channelId, authorId, content, Date.now(), mentions.everyone ? 1 : 0).lastInsertRowid,
      );
      attachmentIds.forEach((attachmentId, position) => {
        this.run('UPDATE attachments SET message_id = ?, position = ? WHERE id = ?', id, position, attachmentId);
      });
      for (const userId of mentions.userIds) {
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

  /** Metinde bahsedilen (var olan, üye) kullanıcıların kimlikleri; yazar hariç. */
  resolveMentions(content: string, authorId: string | null): string[] {
    const ids: string[] = [];
    for (const username of extractMentions(content)) {
      const user = this.one<{ id: string }>(
        'SELECT id FROM users WHERE username = ? AND removed_at IS NULL',
        username,
      );
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
