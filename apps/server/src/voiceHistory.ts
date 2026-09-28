import type { DatabaseSync } from 'node:sqlite';
import type { VoiceState } from '@diskort/shared';
import type { VoiceStateStore } from './voiceState.js';

/**
 * Yönetim paneli için ses geçmişi (göç 20). voice_sessions: kim, hangi kanalda, ne zaman girip çıktı
 * (kind 'voice') ve ne zaman yayın yaptı (kind 'stream'). Sunucu açıkken dakikada bir açık oturumların
 * last_seen_at'i yazılır; sunucu kapanırken ya da çökünce açık kalanlar son görüldükleri anda "restart"
 * olarak kapanır. Yeniden açılışta (LiveKit eşitlemesiyle) aynı kişi aynı kanalda kısa süre içinde yeniden
 * görülürse kapanan oturum sürdürülür; yeniden başlatmalar oturumları bölmez.
 * invite_uses: hangi davetle kim kaydoldu / sunucuya katıldı (davet eden, sunucu). İkisi de kendi başınadır
 * ve yeniden çalışsa da zararsızdır (IF NOT EXISTS).
 */
export const ADMIN_HISTORY_MIGRATION = `
  CREATE TABLE IF NOT EXISTS voice_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
    guild_id     TEXT,
    channel_id   TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('voice', 'stream')),
    started_at   INTEGER NOT NULL,
    ended_at     INTEGER,
    last_seen_at INTEGER,
    end_reason   TEXT
  );
  CREATE INDEX IF NOT EXISTS voice_sessions_by_start ON voice_sessions(started_at);
  CREATE INDEX IF NOT EXISTS voice_sessions_by_end ON voice_sessions(ended_at);
  CREATE INDEX IF NOT EXISTS voice_sessions_by_user ON voice_sessions(user_id, kind, started_at);
  CREATE TABLE IF NOT EXISTS invite_uses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT NOT NULL,
    guild_id   TEXT,
    inviter_id TEXT,
    user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('register', 'join')),
    used_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS invite_uses_by_time ON invite_uses(used_at);
`;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Yeniden başlatmada kapanan oturum, kişi bu süre içinde aynı kanalda görülürse sürdürülür */
export const RESUME_WINDOW_MS = 5 * MINUTE;
const HEARTBEAT_MS = MINUTE;

type Kind = 'voice' | 'stream';
type Log = { warn(obj: object, msg: string): void };

/** Ses durumu değişikliklerini voice_sessions tablosuna yazar */
export class VoiceSessionRecorder {
  /** Kullanıcı → açık oturum (kimlik, kanal) */
  private readonly open = { voice: new Map<string, { id: number; channelId: string }>(), stream: new Map<string, { id: number; channelId: string }>() };
  private timer: NodeJS.Timeout | null = null;
  private warned = false;

  constructor(
    private readonly db: DatabaseSync,
    private readonly guildOf: (channelId: string) => string | null,
    private readonly log?: Log,
  ) {}

  /**
   * Önceki çalışmadan açık kalanları kapatır ve ses olaylarını dinlemeye başlar. Sunucu aniden kapandıysa
   * bitiş son görülme anıdır (en çok bir dakika eksik).
   */
  attach(voice: VoiceStateStore, now = Date.now()): void {
    this.safe(() =>
      this.db
        .prepare(
          `UPDATE voice_sessions SET ended_at = MAX(started_at, COALESCE(last_seen_at, started_at)), end_reason = 'restart'
           WHERE ended_at IS NULL`,
        )
        .run(),
    );
    for (const state of voice.list()) this.onUpdate(state, now);
    voice.on('update', (state) => this.onUpdate(state));
    voice.on('delete', ({ userId }) => this.onDelete(userId));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.timer.unref();
  }

  /** Açık oturumların son görülme anı (çökme sonrası bitiş tahmini için) */
  heartbeat(now = Date.now()): void {
    this.safe(() => this.db.prepare('UPDATE voice_sessions SET last_seen_at = ? WHERE ended_at IS NULL').run(now));
  }

  /** Sunucu kapanıyor: açık oturumlar "restart" olarak kapanır (yeniden açılışta sürdürülebilir) */
  stop(now = Date.now()): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.safe(() =>
      this.db.prepare(`UPDATE voice_sessions SET ended_at = ?, end_reason = 'restart' WHERE ended_at IS NULL`).run(now),
    );
    this.open.voice.clear();
    this.open.stream.clear();
  }

  onUpdate(state: VoiceState, now = Date.now()): void {
    const voice = this.open.voice.get(state.userId);
    if (!voice || voice.channelId !== state.channelId) {
      if (voice) this.close('voice', state.userId, now, 'move');
      this.openSession('voice', state.userId, state.channelId, now);
    }
    const stream = this.open.stream.get(state.userId);
    if (stream && (!state.streaming || stream.channelId !== state.channelId)) this.close('stream', state.userId, now, 'end');
    if (state.streaming && !this.open.stream.has(state.userId)) {
      this.openSession('stream', state.userId, state.channelId, Math.min(now, state.streamStartedAt ?? now));
    }
  }

  onDelete(userId: string, now = Date.now()): void {
    this.close('stream', userId, now, 'leave');
    this.close('voice', userId, now, 'leave');
  }

  private openSession(kind: Kind, userId: string, channelId: string, startedAt: number): void {
    this.safe(() => {
      const resumable = this.db
        .prepare(
          `SELECT id FROM voice_sessions
           WHERE user_id = ? AND channel_id = ? AND kind = ? AND end_reason = 'restart' AND ended_at >= ?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(userId, channelId, kind, startedAt - RESUME_WINDOW_MS) as { id: number } | undefined;
      let id: number;
      if (resumable) {
        this.db
          .prepare('UPDATE voice_sessions SET ended_at = NULL, end_reason = NULL, last_seen_at = ? WHERE id = ?')
          .run(startedAt, resumable.id);
        id = resumable.id;
      } else {
        const res = this.db
          .prepare(
            `INSERT INTO voice_sessions (user_id, guild_id, channel_id, kind, started_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(userId, this.guildOf(channelId), channelId, kind, startedAt, startedAt);
        id = Number(res.lastInsertRowid);
      }
      this.open[kind].set(userId, { id, channelId });
    });
  }

  private close(kind: Kind, userId: string, now: number, reason: string): void {
    const open = this.open[kind].get(userId);
    if (!open) return;
    this.open[kind].delete(userId);
    this.safe(() =>
      this.db
        .prepare('UPDATE voice_sessions SET ended_at = MAX(started_at, ?), end_reason = ? WHERE id = ? AND ended_at IS NULL')
        .run(now, reason, open.id),
    );
  }

  /** Kayıt hatası ses akışını asla bozmaz */
  private safe(fn: () => unknown): void {
    try {
      fn();
    } catch (err) {
      if (!this.warned) this.log?.warn({ err: String(err) }, 'ses geçmişi yazılamadı');
      this.warned = true;
    }
  }
}

// ---------- Özet (GET /api/admin/voice-history) ----------

interface SessionRow {
  user_id: string | null;
  guild_id: string | null;
  channel_id: string;
  kind: Kind;
  started_at: number;
  ended_at: number;
  open: number;
}

export interface VoiceHistory {
  from: number;
  to: number;
  days: number;
  totals: { voiceMin: number; streamMin: number; sessions: number; streams: number; users: number; streamers: number };
  /** Gün gün (istemcinin saat dilimine göre), eskiden yeniye; `peak`: aynı anda en çok kişi */
  perDay: { day: number; voiceMin: number; streamMin: number; users: number; peak: number }[];
  /** [haftanın günü (0 = Pazartesi)][saat] → ses dakikası */
  heatmap: number[][];
  users: { userId: string | null; voiceMin: number; streamMin: number; sessions: number; lastAt: number; online: boolean }[];
  channels: { channelId: string; guildId: string | null; voiceMin: number; streamMin: number; users: number; sessions: number }[];
  recent: { userId: string | null; channelId: string; guildId: string | null; kind: Kind; start: number; end: number; open: boolean }[];
}

/**
 * Son `days` günün ses ve yayın süreleri. Pencere dışına taşan oturumlar kırpılır; süren oturumlar şimdiye
 * kadar sayılır. Günler ve ısı haritası `tzOffsetMin` (Date#getTimezoneOffset) saat dilimindedir.
 */
export function voiceHistory(db: DatabaseSync, days: number, tzOffsetMin: number, now = Date.now()): VoiceHistory {
  const shift = -tzOffsetMin * MINUTE;
  const localDayStart = (t: number): number => Math.floor((t + shift) / DAY) * DAY - shift;
  const today = localDayStart(now);
  const from = today - (days - 1) * DAY;
  const rows = db
    .prepare(
      `SELECT user_id, guild_id, channel_id, kind, started_at, COALESCE(ended_at, ?) AS ended_at,
              ended_at IS NULL AS open
       FROM voice_sessions
       WHERE (ended_at IS NULL OR ended_at >= ?) AND started_at <= ?
       ORDER BY started_at`,
    )
    .all(now, from, now) as unknown as SessionRow[];

  const perDay = Array.from({ length: days }, (_, i) => ({
    day: from + i * DAY,
    voiceMin: 0,
    streamMin: 0,
    users: new Set<string>(),
    events: [] as [number, number][],
  }));
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const users = new Map<string, VoiceHistory['users'][number]>();
  const channels = new Map<string, VoiceHistory['channels'][number] & { userSet: Set<string> }>();
  const totals = { voiceMin: 0, streamMin: 0, sessions: 0, streams: 0 };
  const voiceUsers = new Set<string>();
  const streamers = new Set<string>();

  for (const row of rows) {
    const start = Math.max(row.started_at, from);
    const end = Math.min(Math.max(row.ended_at, row.started_at), now);
    if (end <= start) continue;
    const minutes = (end - start) / MINUTE;
    const who = row.user_id ?? '';
    const stream = row.kind === 'stream';
    if (stream) {
      totals.streamMin += minutes;
      totals.streams++;
      streamers.add(who);
    } else {
      totals.voiceMin += minutes;
      totals.sessions++;
      voiceUsers.add(who);
    }
    const u = users.get(who) ?? { userId: row.user_id, voiceMin: 0, streamMin: 0, sessions: 0, lastAt: 0, online: false };
    if (stream) u.streamMin += minutes;
    else {
      u.voiceMin += minutes;
      u.sessions++;
    }
    u.lastAt = Math.max(u.lastAt, end);
    if (row.open && !stream) u.online = true;
    users.set(who, u);
    const c = channels.get(row.channel_id) ?? {
      channelId: row.channel_id,
      guildId: row.guild_id,
      voiceMin: 0,
      streamMin: 0,
      users: 0,
      sessions: 0,
      userSet: new Set<string>(),
    };
    if (stream) c.streamMin += minutes;
    else {
      c.voiceMin += minutes;
      c.sessions++;
      c.userSet.add(who);
    }
    channels.set(row.channel_id, c);

    // Gün ve saat dilimlerine böl
    let t = start;
    while (t < end) {
      const hourEnd = Math.min(end, Math.floor((t + shift) / HOUR) * HOUR - shift + HOUR);
      const mins = (hourEnd - t) / MINUTE;
      const local = new Date(t + shift);
      const dayIndex = Math.floor((localDayStart(t) - from) / DAY);
      const slot = perDay[dayIndex];
      if (slot) {
        if (stream) slot.streamMin += mins;
        else {
          slot.voiceMin += mins;
          slot.users.add(who);
        }
      }
      if (!stream) heatmap[(local.getUTCDay() + 6) % 7]![local.getUTCHours()]! += mins;
      t = hourEnd;
    }
    if (!stream) {
      // Aynı anda en çok kişi: gün içindeki giriş/çıkışlar
      for (let d = Math.floor((localDayStart(start) - from) / DAY); d < days; d++) {
        const slot = perDay[d];
        if (!slot || slot.day >= end) break;
        slot.events.push([Math.max(start, slot.day), 1], [Math.min(end, slot.day + DAY), -1]);
      }
    }
  }

  const round1 = (v: number): number => Math.round(v * 10) / 10;
  return {
    from,
    to: now,
    days,
    totals: {
      voiceMin: round1(totals.voiceMin),
      streamMin: round1(totals.streamMin),
      sessions: totals.sessions,
      streams: totals.streams,
      users: voiceUsers.size,
      streamers: streamers.size,
    },
    perDay: perDay.map((d) => {
      let cur = 0;
      let peak = 0;
      for (const [, delta] of d.events.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
        cur += delta;
        peak = Math.max(peak, cur);
      }
      return { day: d.day, voiceMin: round1(d.voiceMin), streamMin: round1(d.streamMin), users: d.users.size, peak };
    }),
    heatmap: heatmap.map((row) => row.map(round1)),
    users: [...users.values()]
      .map((u) => ({ ...u, voiceMin: round1(u.voiceMin), streamMin: round1(u.streamMin) }))
      .sort((a, b) => b.voiceMin - a.voiceMin || b.streamMin - a.streamMin),
    channels: [...channels.values()]
      .map(({ userSet, ...c }) => ({ ...c, users: userSet.size, voiceMin: round1(c.voiceMin), streamMin: round1(c.streamMin) }))
      .sort((a, b) => b.voiceMin - a.voiceMin)
      .slice(0, 20),
    recent: rows
      .slice(-40)
      .reverse()
      .map((row) => ({
        userId: row.user_id,
        channelId: row.channel_id,
        guildId: row.guild_id,
        kind: row.kind,
        start: row.started_at,
        end: row.ended_at,
        open: row.open === 1,
      })),
  };
}
