import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { Channel, GatewayServerMessage, ReadyPayload, Role, User } from '@diskort/shared';
import { buildApp, type BuildOptions } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { LiveKitService, type PublishSources } from '../src/livekit.js';

export const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: '.' });

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** LiveKit'e gitmeden çağrıları kaydeder */
export class FakeLiveKit extends LiveKitService {
  calls: { method: string; args: unknown[] }[] = [];

  constructor() {
    super(config);
  }

  override async setPublishSources(channelId: string, userId: string, sources: PublishSources): Promise<void> {
    this.calls.push({ method: 'setPublishSources', args: [channelId, userId, sources] });
  }

  override async muteMicrophone(channelId: string, userId: string): Promise<void> {
    this.calls.push({ method: 'muteMicrophone', args: [channelId, userId] });
  }

  override async removeParticipant(channelId: string, userId: string): Promise<void> {
    this.calls.push({ method: 'removeParticipant', args: [channelId, userId] });
  }

  override async closeChannelRoom(channelId: string): Promise<void> {
    this.calls.push({ method: 'closeChannelRoom', args: [channelId] });
  }

  of(method: string): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }
}

export interface InjectResponse {
  statusCode: number;
  body: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(): any;
}

export interface Account {
  token: string;
  user: User;
}

export interface TestServer {
  app: FastifyInstance;
  ctx: AppContext;
  livekit: FakeLiveKit;
  owner: Account;
  /** Ana sunucunun kimliği (sahibi `owner`) */
  guildId: string;
  /** Davet koduyla yeni üye */
  member(username: string, password?: string): Promise<Account>;
  req(token: string, method: string, url: string, payload?: unknown): Promise<InjectResponse>;
  createRole(token: string, body: Record<string, unknown>): Promise<Role>;
  giveRole(token: string, userId: string, roleId: string): Promise<number>;
  /** Üyenin ana sunucudaki rolleri */
  rolesOf(userId: string): string[];
  /** Ana sunucunun ilk metin/ses kanalı */
  channel(type: 'text' | 'voice'): Channel;
  close(): Promise<void>;
}

/** Sahip (ilk kayıt) hazır bir sunucu */
export async function startServer(opts: BuildOptions = {}): Promise<TestServer> {
  const livekit = new FakeLiveKit();
  const { app, ctx } = await buildApp(config, { dbFile: ':memory:', logger: false, livekit, ...opts });
  const register = async (inviteCode: string, username: string, password = 'sifre12345'): Promise<Account> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { inviteCode, username, password } });
    if (res.statusCode !== 201) throw new Error(`kayıt başarısız: ${res.body}`);
    return res.json() as Account;
  };
  const owner = await register(ctx.store.ensureBootstrapInvite()!.code, 'sahip');
  const req: TestServer['req'] = (token, method, url, payload) =>
    app.inject({
      method: method as 'GET',
      url,
      headers: auth(token),
      ...(payload === undefined ? {} : { payload: payload as string }),
    });
  return {
    app,
    ctx,
    livekit,
    owner,
    guildId: ctx.guild.id,
    req,
    async member(username, password) {
      const code = (await req(owner.token, 'POST', `/api/guilds/${ctx.guild.id}/invites`, {})).json().code as string;
      return register(code, username, password);
    },
    async createRole(token, body) {
      const res = await req(token, 'POST', `/api/guilds/${ctx.guild.id}/roles`, body);
      if (res.statusCode !== 201) throw new Error(`rol oluşturulamadı: ${res.body}`);
      return res.json() as Role;
    },
    async giveRole(token, userId, roleId) {
      return (await req(token, 'PUT', `/api/guilds/${ctx.guild.id}/members/${userId}/roles/${roleId}`)).statusCode;
    },
    rolesOf(userId) {
      return ctx.store.getMember(ctx.guild.id, userId)?.roles ?? [];
    },
    channel(type) {
      return ctx.store.listChannels(ctx.guild.id).find((c) => c.type === type)!;
    },
    close: () => app.close(),
  };
}

export interface GatewayClient {
  ws: WebSocket;
  ready: ReadyPayload;
  events: GatewayServerMessage[];
  /** Bekleyen olayların gelmesi için kısa bir süre bekler */
  settle(): Promise<void>;
  of<T extends GatewayServerMessage['t']>(t: T): EventData<T>[];
}

type EventData<T extends GatewayServerMessage['t']> =
  Extract<GatewayServerMessage, { t: T }> extends { d: infer D } ? D : never;

/**
 * Gateway'e bağlanır, READY'yi bekler; sunucu önceden app.listen ile açılmış olmalı. `features` verilmezse
 * IDENTIFY'da özellik bildirmeyen eski istemci gibi davranır.
 */
export function connectGateway(
  app: FastifyInstance,
  token: string,
  features?: string[],
  identify: Record<string, unknown> = {},
): Promise<GatewayClient> {
  const { port } = app.server.address() as { port: number };
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/gateway`);
    const events: GatewayServerMessage[] = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as GatewayServerMessage;
      if (msg.t === 'HELLO') ws.send(JSON.stringify({ t: 'IDENTIFY', d: { token, ...identify, ...(features ? { features } : {}) } }));
      else if (msg.t === 'READY') {
        resolve({
          ws,
          ready: msg.d,
          events,
          settle: () => new Promise((r) => setTimeout(r, 150)),
          of: (t) => events.filter((e) => e.t === t).map((e) => (e as unknown as { d: never }).d),
        });
      } else events.push(msg);
    });
  });
}
