import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { GatewayServerMessage, Message, ReadyPayload } from '@diskort/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';

const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: '.' });

let app: FastifyInstance;
let ctx: AppContext;

beforeEach(async () => {
  ({ app, ctx } = await buildApp(config, { dbFile: ':memory:', logger: false }));
});

afterEach(async () => {
  await app.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function setup() {
  const bootstrap = ctx.store.ensureBootstrapInvite()!;
  const admin = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: bootstrap.code, username: 'admin', password: 'sifre12345' },
    })
  ).json();
  const code = (await app.inject({ method: 'POST', url: `/api/guilds/${ctx.guild.id}/invites`, headers: auth(admin.token), payload: {} })).json()
    .code as string;
  const member = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: code, username: 'uye', password: 'sifre12345' },
    })
  ).json();
  const channels = ctx.store.listChannels(ctx.guild.id);
  const text = channels.find((c) => c.type === 'text')!;
  const voice = channels.find((c) => c.type === 'voice')!;
  return {
    admin: admin as { token: string; user: { id: string } },
    member: member as { token: string; user: { id: string } },
    text,
    voice,
  };
}

const post = (token: string, channelId: string, content: string) =>
  app.inject({ method: 'POST', url: `/api/channels/${channelId}/messages`, headers: auth(token), payload: { content } });

describe('metin kanalları', () => {
  it('yeni toplulukta varsayılan bir metin kanalı vardır', () => {
    const text = ctx.store.listChannels(ctx.guild.id).filter((c) => c.type === 'text');
    expect(text.map((c) => c.name)).toEqual(['genel-sohbet']);
  });

  it('mesaj gönderilir, sayfalanır; ses kanalına mesaj gönderilemez', async () => {
    const { member, text, voice } = await setup();
    const first = await post(member.token, text.id, '  merhaba  ');
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ content: 'merhaba', authorId: member.user.id, editedAt: null });

    for (let i = 1; i <= 5; i++) await post(member.token, text.id, `mesaj ${i}`);
    const all = (
      await app.inject({ method: 'GET', url: `/api/channels/${text.id}/messages`, headers: auth(member.token) })
    ).json() as Message[];
    expect(all.map((m) => m.content)).toEqual(['merhaba', 'mesaj 1', 'mesaj 2', 'mesaj 3', 'mesaj 4', 'mesaj 5']);

    const older = (
      await app.inject({
        method: 'GET',
        url: `/api/channels/${text.id}/messages?before=${all[3]!.id}&limit=2`,
        headers: auth(member.token),
      })
    ).json() as Message[];
    expect(older.map((m) => m.content)).toEqual(['mesaj 1', 'mesaj 2']);

    expect((await post(member.token, voice.id, 'selam')).statusCode).toBe(404);
  });

  it('boş, çok uzun ve kontrol karakterli içerik doğru işlenir', async () => {
    const { member, text } = await setup();
    expect((await post(member.token, text.id, '   ')).statusCode).toBe(400);
    expect((await post(member.token, text.id, 'x'.repeat(2001))).statusCode).toBe(400);
    const res = await post(member.token, text.id, 'satır 1\nsatır\u0007 2');
    expect(res.json().content).toBe('satır 1\nsatır 2');
  });

  it('yalnızca yazar düzenler; üye başkasının mesajını silemez, yönetici silebilir', async () => {
    const { admin, member, text } = await setup();
    const msg = (await post(member.token, text.id, 'ilk hâli')).json() as Message;

    const byAdmin = await app.inject({
      method: 'PATCH',
      url: `/api/messages/${msg.id}`,
      headers: auth(admin.token),
      payload: { content: 'başkası' },
    });
    expect(byAdmin.statusCode).toBe(403);

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/messages/${msg.id}`,
      headers: auth(member.token),
      payload: { content: 'düzenlendi' },
    });
    expect(edited.json()).toMatchObject({ content: 'düzenlendi' });
    expect(edited.json().editedAt).toBeGreaterThan(0);

    const adminMsg = (await post(admin.token, text.id, 'yönetici mesajı')).json() as Message;
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/messages/${adminMsg.id}`, headers: auth(member.token) }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/messages/${msg.id}`, headers: auth(admin.token) })).statusCode,
    ).toBe(204);
    expect(ctx.store.getMessage(Number(msg.id))).toBeNull();
  });

  it('kısa sürede çok fazla mesaj gönderilemez', async () => {
    const { member, text } = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await post(member.token, text.id, `m${i}`)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('okunma durumu yalnızca ileri gider; kanal silinince mesajlar, hesap silinince yazar bilgisi kalkar', async () => {
    const { admin, member, text } = await setup();
    const a = (await post(admin.token, text.id, 'a')).json() as Message;
    const b = (await post(admin.token, text.id, 'b')).json() as Message;
    const ack = (id: string) =>
      app.inject({
        method: 'POST',
        url: `/api/channels/${text.id}/ack`,
        headers: auth(member.token),
        payload: { messageId: id },
      });
    expect((await ack(b.id)).statusCode).toBe(204);
    await ack(a.id);
    expect(ctx.store.readStates(member.user.id)[text.id]).toBe(b.id);
    // Yazar kendi mesajını okumuş sayılır
    expect(ctx.store.readStates(admin.user.id)[text.id]).toBe(b.id);

    await post(member.token, text.id, 'üyeden');
    await app.inject({ method: 'DELETE', url: `/api/users/${member.user.id}`, headers: auth(admin.token) });
    const afterUserDelete = ctx.store.listMessages(text.id, null, 50);
    expect(afterUserDelete.at(-1)).toMatchObject({ content: 'üyeden', authorId: null });

    await app.inject({ method: 'DELETE', url: `/api/channels/${text.id}`, headers: auth(admin.token) });
    expect(ctx.store.listMessages(text.id, null, 50)).toEqual([]);
  });
});

describe('bahsetmeler', () => {
  it('bahsedilen kullanıcının sayacı artar, kanal sonuna kadar okununca sıfırlanır', async () => {
    const { admin, member, text } = await setup();
    await post(admin.token, text.id, '@uye bak');
    await post(admin.token, text.id, 'mail@uye.com @UYE. ve @admin @yok');
    const last = (await post(admin.token, text.id, 'bahsetmesiz')).json() as Message;

    expect(ctx.store.mentionCounts(member.user.id)).toEqual({ [text.id]: 2 });
    // Yazar kendinden bahsetse de sayılmaz
    expect(ctx.store.mentionCounts(admin.user.id)).toEqual({});

    const ack = (id: string) =>
      app.inject({
        method: 'POST',
        url: `/api/channels/${text.id}/ack`,
        headers: auth(member.token),
        payload: { messageId: id },
      });
    await ack(String(Number(last.id) - 1));
    expect(ctx.store.mentionCounts(member.user.id)).toEqual({ [text.id]: 2 });
    await ack(last.id);
    expect(ctx.store.mentionCounts(member.user.id)).toEqual({});
  });
});

describe('gateway üzerinden mesajlar', () => {
  it('READY okunmamış bilgisini taşır; yeni mesaj ve "yazıyor" diğer istemcilere iletilir', async () => {
    const { admin, member, text } = await setup();
    const a = (await post(admin.token, text.id, 'önceden')).json() as Message;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as { port: number };

    const connect = (token: string) =>
      new Promise<{ ws: WebSocket; ready: ReadyPayload; events: GatewayServerMessage[] }>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${address.port}/gateway`);
        const events: GatewayServerMessage[] = [];
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as GatewayServerMessage;
          if (msg.t === 'HELLO') ws.send(JSON.stringify({ t: 'IDENTIFY', d: { token } }));
          else if (msg.t === 'READY') resolve({ ws, ready: msg.d, events });
          else events.push(msg);
        });
      });

    const m = await connect(member.token);
    const ad = await connect(admin.token);
    expect(m.ready.lastMessageIds[text.id]).toBe(a.id);
    expect(m.ready.readStates[text.id]).toBeUndefined();
    expect(ad.ready.readStates[text.id]).toBe(a.id);

    ad.ws.send(JSON.stringify({ t: 'TYPING_START', d: { channelId: text.id } }));
    await post(admin.token, text.id, 'canlı');
    await new Promise((r) => setTimeout(r, 200));

    expect(m.events.some((e) => e.t === 'TYPING_START' && e.d.userId === admin.user.id)).toBe(true);
    expect(ad.events.some((e) => e.t === 'TYPING_START')).toBe(false);
    expect(m.events.some((e) => e.t === 'MESSAGE_CREATE' && e.d.content === 'canlı')).toBe(true);
    m.ws.close();
    ad.ws.close();
  });
});
