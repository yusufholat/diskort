import type { DatabaseSync } from 'node:sqlite';
import {
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  type Feedback,
  type FeedbackContext,
  type FeedbackScreenshot,
  type FeedbackStatus,
  type FeedbackType,
} from '@diskort/shared';

/**
 * Geri bildirim tabloları (göç 12). Kendi başınadır: başka göçlerin tablolarına dokunmaz, yalnızca
 * users'a bağlanır. Hesap silinince geri bildirim kalır (gönderen null olur).
 */
export const FEEDBACK_MIGRATION = `
  CREATE TABLE IF NOT EXISTS feedback (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
    type        TEXT NOT NULL CHECK (type IN (${FEEDBACK_TYPES.map((t) => `'${t}'`).join(', ')})),
    title       TEXT,
    body        TEXT NOT NULL,
    context     TEXT,
    status      TEXT NOT NULL DEFAULT 'yeni'
                CHECK (status IN (${FEEDBACK_STATUSES.map((s) => `'${s}'`).join(', ')})),
    admin_note  TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS feedback_by_status ON feedback(status, id);
  CREATE INDEX IF NOT EXISTS feedback_by_user ON feedback(user_id, created_at);
  CREATE TABLE IF NOT EXISTS feedback_screenshots (
    id          TEXT PRIMARY KEY,
    feedback_id INTEGER REFERENCES feedback(id) ON DELETE CASCADE,
    uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    size        INTEGER NOT NULL,
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS feedback_screenshots_by_feedback ON feedback_screenshots(feedback_id, position);
`;

interface FeedbackRow {
  id: number;
  user_id: string | null;
  type: FeedbackType;
  title: string | null;
  body: string;
  context: string | null;
  status: FeedbackStatus;
  admin_note: string | null;
  created_at: number;
  updated_at: number;
}

interface ScreenshotRow {
  id: string;
  feedback_id: number | null;
  uploader_id: string | null;
  size: number;
  width: number;
  height: number;
}

export const screenshotUrl = (id: string): string => `/api/feedback/screenshots/${id}`;

const toScreenshot = (r: ScreenshotRow): FeedbackScreenshot => ({
  id: r.id,
  width: r.width,
  height: r.height,
  size: r.size,
  url: screenshotUrl(r.id),
});

function parseContext(raw: string | null): FeedbackContext | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FeedbackContext;
  } catch {
    return null;
  }
}

export interface FeedbackFilter {
  status?: FeedbackStatus;
  type?: FeedbackType;
  userId?: string;
  limit?: number;
}

/** Geri bildirimin gönderenle birlikte hâli (CLI ve kayıtlar için) */
export interface FeedbackWithAuthor extends Feedback {
  username: string | null;
  displayName: string | null;
}

/**
 * Geri bildirim verisi (node:sqlite). Sunucu Store'un bağlantısını kullanır; sunucudaki komut satırı
 * aracı (feedback-cli) aynı sınıfı kendi açtığı bağlantıyla kullanır.
 */
export class FeedbackStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Tablo var mı (CLI: sunucu henüz bu sürüme güncellenmemiş olabilir) */
  ready(): boolean {
    return this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'feedback'").get() !== undefined;
  }

  private withScreenshots(rows: FeedbackRow[]): Feedback[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const shots = this.db
      .prepare(
        `SELECT * FROM feedback_screenshots WHERE feedback_id IN (${ids.map(() => '?').join(',')})
         ORDER BY feedback_id, position`,
      )
      .all(...ids) as unknown as ScreenshotRow[];
    const byFeedback = new Map<number, FeedbackScreenshot[]>();
    for (const s of shots) {
      const list = byFeedback.get(s.feedback_id!) ?? [];
      list.push(toScreenshot(s));
      byFeedback.set(s.feedback_id!, list);
    }
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      title: r.title,
      body: r.body,
      context: parseContext(r.context),
      screenshots: byFeedback.get(r.id) ?? [],
      status: r.status,
      adminNote: r.admin_note,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /** En yeni önce */
  list(filter: FeedbackFilter = {}): Feedback[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.type) {
      where.push('type = ?');
      params.push(filter.type);
    }
    if (filter.userId) {
      where.push('user_id = ?');
      params.push(filter.userId);
    }
    params.push(filter.limit ?? 500);
    const rows = this.db
      .prepare(
        `SELECT * FROM feedback ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
      )
      .all(...params) as unknown as FeedbackRow[];
    return this.withScreenshots(rows);
  }

  get(id: number): Feedback | null {
    const row = this.db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as unknown as FeedbackRow | undefined;
    return row ? this.withScreenshots([row])[0]! : null;
  }

  /** Gönderenin kullanıcı adı ve görünen adıyla (hesap silindiyse null) */
  withAuthors(items: Feedback[]): FeedbackWithAuthor[] {
    const find = this.db.prepare('SELECT username, display_name FROM users WHERE id = ?');
    return items.map((f) => {
      const u = f.userId ? (find.get(f.userId) as { username: string; display_name: string } | undefined) : undefined;
      return { ...f, username: u?.username ?? null, displayName: u?.display_name ?? null };
    });
  }

  countByStatus(): Record<FeedbackStatus, number> {
    const counts = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0])) as Record<FeedbackStatus, number>;
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM feedback GROUP BY status').all() as unknown as {
      status: FeedbackStatus;
      n: number;
    }[];
    for (const r of rows) counts[r.status] = r.n;
    return counts;
  }

  /** Kullanıcının `since`ten sonra gönderdiği geri bildirim sayısı (saatlik sınır) */
  countSince(userId: string, since: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at > ?')
      .get(userId, since) as { n: number };
    return row.n;
  }

  /** Geri bildirimi oluşturur ve verilen (yükleyene ait, bekleyen) ekran görüntülerini bağlar. */
  create(input: {
    userId: string;
    type: FeedbackType;
    title: string | null;
    body: string;
    context: FeedbackContext | null;
    screenshotIds: string[];
    now?: number;
  }): Feedback {
    const now = input.now ?? Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db
        .prepare(
          `INSERT INTO feedback (user_id, type, title, body, context, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'yeni', ?, ?)`,
        )
        .run(
          input.userId,
          input.type,
          input.title,
          input.body,
          input.context ? JSON.stringify(input.context) : null,
          now,
          now,
        );
      const id = Number(result.lastInsertRowid);
      const attach = this.db.prepare(
        'UPDATE feedback_screenshots SET feedback_id = ?, position = ? WHERE id = ? AND uploader_id = ? AND feedback_id IS NULL',
      );
      input.screenshotIds.forEach((sid, i) => attach.run(id, i, sid, input.userId));
      this.db.exec('COMMIT');
      return this.get(id)!;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Değişen alanlar; geri bildirim yoksa null */
  update(id: number, patch: { status?: FeedbackStatus; adminNote?: string | null }, now = Date.now()): Feedback | null {
    const sets: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [now];
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.adminNote !== undefined) {
      sets.push('admin_note = ?');
      params.push(patch.adminNote);
    }
    params.push(id);
    const changes = Number(this.db.prepare(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`).run(...params).changes);
    return changes > 0 ? this.get(id) : null;
  }

  /** Siler; silinen ekran görüntülerinin kimliklerini döner (dosyaları ayrıca silinir). Yoksa null. */
  delete(id: number): string[] | null {
    const shots = (
      this.db.prepare('SELECT id FROM feedback_screenshots WHERE feedback_id = ?').all(id) as unknown as { id: string }[]
    ).map((r) => r.id);
    const changes = Number(this.db.prepare('DELETE FROM feedback WHERE id = ?').run(id).changes);
    return changes > 0 ? shots : null;
  }

  // ---------- Ekran görüntüleri ----------

  addScreenshot(s: { id: string; uploaderId: string; size: number; width: number; height: number }, now = Date.now()): FeedbackScreenshot {
    this.db
      .prepare(
        `INSERT INTO feedback_screenshots (id, feedback_id, uploader_id, size, width, height, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      )
      .run(s.id, s.uploaderId, s.size, s.width, s.height, now);
    return toScreenshot({ ...s, feedback_id: null, uploader_id: s.uploaderId });
  }

  getScreenshot(id: string): { screenshot: FeedbackScreenshot; feedbackId: number | null; uploaderId: string | null } | null {
    const row = this.db.prepare('SELECT * FROM feedback_screenshots WHERE id = ?').get(id) as unknown as
      | ScreenshotRow
      | undefined;
    return row ? { screenshot: toScreenshot(row), feedbackId: row.feedback_id, uploaderId: row.uploader_id } : null;
  }

  /** Kullanıcının henüz gönderilmemiş (bekleyen) ekran görüntülerinden hangileri bu kimliklerde */
  pendingOwned(userId: string, ids: string[]): Set<string> {
    if (ids.length === 0) return new Set();
    const rows = this.db
      .prepare(
        `SELECT id FROM feedback_screenshots WHERE uploader_id = ? AND feedback_id IS NULL
         AND id IN (${ids.map(() => '?').join(',')})`,
      )
      .all(userId, ...ids) as unknown as { id: string }[];
    return new Set(rows.map((r) => r.id));
  }

  screenshotExists(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM feedback_screenshots WHERE id = ?').get(id) !== undefined;
  }

  /** `before`den önce yüklenip gönderilmemiş ekran görüntülerini siler ve kimliklerini döner */
  deleteStalePending(before: number): string[] {
    const ids = (
      this.db
        .prepare('SELECT id FROM feedback_screenshots WHERE feedback_id IS NULL AND created_at < ?')
        .all(before) as unknown as { id: string }[]
    ).map((r) => r.id);
    const del = this.db.prepare('DELETE FROM feedback_screenshots WHERE id = ?');
    for (const id of ids) del.run(id);
    return ids;
  }
}
