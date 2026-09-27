import type { FastifyReply } from 'fastify';
import type { ZodType } from 'zod';
import type { Guild } from '@diskort/shared';
import type { AuthService } from './auth.js';
import type { ClientVersionPolicy } from './clientVersion.js';
import type { Config } from './config.js';
import type { Store } from './db.js';
import type { Gateway } from './gateway.js';
import type { LiveKitService } from './livekit.js';
import type { OtaService } from './ota.js';
import type { PushService } from './push.js';
import type { ReleaseService } from './releases.js';
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
