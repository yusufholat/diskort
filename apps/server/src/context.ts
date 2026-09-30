import type { FastifyReply } from 'fastify';
import type { ZodType } from 'zod';
import type { Guild } from '@diskort/shared';
import type { ErrorLog } from './activity.js';
import type { ActivityIconStore } from './activityIcons.js';
import type { ApiStats } from './apiStats.js';
import type { AuthLog } from './authLog.js';
import type { DailyCounters } from './counters.js';
import type { AttachmentService } from './attachments.js';
import type { AvatarService } from './avatars.js';
import type { AuthService } from './auth.js';
import type { ClientVersionPolicy } from './clientVersion.js';
import type { Config } from './config.js';
import type { Store } from './db.js';
import type { EmbedMediaService } from './embedMedia.js';
import type { Gateway, Visibility } from './gateway.js';
import type { GifService } from './gifs.js';
import type { LinkPreviewService } from './linkPreviews.js';
import type { LiveKitService } from './livekit.js';
import type { OtaService } from './ota.js';
import type { PermissionService } from './permissions.js';
import type { PushService } from './push.js';
import type { ReleaseService } from './releases.js';
import type { StreamPreviewStore } from './streamPreview.js';
import type { VoiceTelemetryStore } from './telemetry.js';
import type { VoiceModeration } from './voiceModeration.js';
import type { VoiceStateStore } from './voiceState.js';

export interface AppContext {
  config: Config;
  store: Store;
  auth: AuthService;
  voice: VoiceStateStore;
  livekit: LiveKitService;
  gateway: Gateway;
  releases: ReleaseService;
  clientVersions: ClientVersionPolicy;
  ota: OtaService;
  push: PushService;
  attachments: AttachmentService;
  avatars: AvatarService;
  /** Etkinlik (oyun) ikonları */
  activityIcons: ActivityIconStore;
  /** GIF araması (GIPHY) ve mesajlara GIF gömme */
  gifs: GifService;
  /** Bağlantı önizlemeleri; LINK_PREVIEWS=0 ise null */
  linkPreviews: LinkPreviewService | null;
  /** Önizleme resimlerinin imzalı adresleri ve disk önbelleği */
  embedMedia: EmbedMediaService;
  permissions: PermissionService;
  moderation: VoiceModeration;
  /** Yayın önizlemeleri (yalnızca bellekte) */
  streamPreviews: StreamPreviewStore;
  /** Son istemci ve sunucu hataları (yönetim paneli; SYSTEM_STATS açıkken <DATA_DIR>/*-errors.jsonl dosyalarında da, 14 gün) */
  errors: ErrorLog;
  /** Yönetim paneli: gün başına sayaçlar (bildirimler, indirmeler, güncelleme denetimleri…) */
  counters: DailyCounters;
  /** Yönetim paneli: giriş kayıtları */
  authLog: AuthLog;
  /** Yönetim paneli: istek sayıları, gecikmeler, sınır aşımları, sunucu günlüğündeki hatalar */
  apiStats: ApiStats;
  /** Yönetim paneli: istemcilerin ses kalitesi özetleri ve kalite sorunları */
  telemetry: VoiceTelemetryStore;
  /**
   * Ana sunucu (ilk kurulan; silinemez, ilk hesap ve yönetici davetleri ona katılır). Adı, simgesi ya da sahibi değişince
   * yerinde güncellenir. Diğer sunucular veritabanındadır.
   */
  guild: Guild;
}

export function sendError(reply: FastifyReply, status: number, error: string, message: string): FastifyReply {
  return reply.code(status).send({ error, message });
}

/** Gövdeyi doğrular; hatalıysa 400 döner ve null verir. */
export function parseBody<T>(schema: ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  void sendError(reply, 400, 'invalid_body', issue?.message ?? 'Geçersiz istek.');
  return null;
}

/** Yetki yoksa 403 */
export function forbidden(reply: FastifyReply, message = 'Bu işlem için yetkin yok.'): FastifyReply {
  return sendError(reply, 403, 'forbidden', message);
}

/**
 * Yetkileri etkileyen bir değişiklikten (rol, üyenin rolleri, kanal izinleri, sahiplik) sonra: bağlı
 * kullanıcıların kanal görünümünü günceller, seste olanların LiveKit izinlerini yeniden uygular.
 * `before`, değişiklikten önce gateway.visibility() ile alınır.
 */
export async function afterPermissionChange(
  ctx: AppContext,
  before: Visibility,
  updatedChannels: Iterable<string> = [],
): Promise<void> {
  ctx.gateway.syncVisibility(before, updatedChannels);
  await ctx.moderation.enforceAll();
}
