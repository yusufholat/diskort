import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { MESSAGE_MAX_REACTIONS, type GatewayServerMessage, type Message } from '@diskort/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { normalizeEmoji } from '../src/emoji.js';

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
  ).json() as { token: string; user: { id: string } };
  const code = (await app.inject({ method: 'POST', url: `/api/guilds/${ctx.guild.id}/invites`, headers: auth(admin.token), payload: {} })).json()
    .code as string;
  const member = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: code, username: 'uye', password: 'sifre12345' },
    })
  ).json() as { token: string; user: { id: string } };
  const text = ctx.store.listChannels(ctx.guild.id).find((c) => c.type === 'text')!;
  const message = (
    await app.inject({
      method: 'POST',
      url: `/api/channels/${text.id}/messages`,
      headers: auth(admin.token),
      payload: { content: 'tepki ver' },
    })
  ).json() as Message;
  return { admin, member, text, message };
}

const react = (method: 'PUT' | 'DELETE', token: string, messageId: string, emoji: string) =>
  app.inject({
    method,
    url: `/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
    headers: auth(token),
  });

async function list(token: string, channelId: string): Promise<Message[]> {
  return (
    await app.inject({ method: 'GET', url: `/api/channels/${channelId}/messages`, headers: auth(token) })
  ).json() as Message[];
}

describe('emoji doğrulama', () => {
  it('yalnızca tek bir Unicode emoji kabul edilir', () => {
    for (const ok of ['👍', '❤️', '👍🏽', '👨‍👩‍👧', '🇹🇷', '1️⃣']) expect(normalizeEmoji(ok)).toBe(ok);
    // Metin biçimli kalp renkli biçimine çevrilir
    expect(normalizeEmoji('❤')).toBe('❤️');
    for (const bad of ['', ' ', 'a', 'selam', '👍👍', 'x👍', '<:ozel:123>', ':thumbsup:', '1', '#', '👍'.repeat(20)]) {
      expect(normalizeEmoji(bad)).toBeNull();
    }
  });
});

describe('tepkiler', () => {
  it('eklenir, sayılır, kaldırılır; "me" isteyen kullanıcıya göredir', async () => {
    const { admin, member, text, message } = await setup();
    expect(message.reactions).toEqual([]);

    expect((await react('PUT', member.token, message.id, '👍')).statusCode).toBe(204);
    expect((await react('PUT', admin.token, message.id, '👍')).statusCode).toBe(204);
    expect((await react('PUT', admin.token, message.id, '🎉')).statusCode).toBe(204);

    const forMember = (await list(member.token, text.id)).find((m) => m.id === message.id)!;
    expect(forMember.reactions).toEqual([
      { emoji: '👍', count: 2, me: true },
      { emoji: '🎉', count: 1, me: false },
    ]);
    const forAdmin = (await list(admin.token, text.id)).find((m) => m.id === message.id)!;
    expect(forAdmin.reactions).toEqual([
      { emoji: '👍', count: 2, me: true },
      { emoji: '🎉', count: 1, me: true },
    ]);

    expect((await react('DELETE', member.token, message.id, '👍')).statusCode).toBe(204);
    expect((await react('DELETE', admin.token, message.id, '🎉')).statusCode).toBe(204);
    expect((await list(member.token, text.id)).find((m) => m.id === message.id)!.reactions).toEqual([
      { emoji: '👍', count: 1, me: false },
    ]);
  });

  it('aynı tepki iki kez sayılmaz; olmayan tepkiyi kaldırmak hata vermez', async () => {
    const { member, text, message } = await setup();
    await react('PUT', member.token, message.id, '😂');
    expect((await react('PUT', member.token, message.id, '😂')).statusCode).toBe(204);
    expect((await list(member.token, text.id))[0]!.reactions).toEqual([{ emoji: '😂', count: 1, me: true }]);
    expect((await react('DELETE', member.token, message.id, '🔥')).statusCode).toBe(204);
  });

  it('geçersiz emoji, olmayan mesaj ve oturumsuz istek reddedilir', async () => {
    const { member, message } = await setup();
    for (const bad of ['selam', '👍👍', '<:ozel:1>', 'x']) {
      const res = await react('PUT', member.token, message.id, bad);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_emoji');
    }
    expect((await react('PUT', member.token, '999999', '👍')).statusCode).toBe(404);
    expect((await react('PUT', member.token, 'abc', '👍')).statusCode).toBe(404);
    const anonymous = await app.inject({
      method: 'PUT',
      url: `/api/messages/${message.id}/reactions/${encodeURIComponent('👍')}`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it(`bir mesajda en fazla ${MESSAGE_MAX_REACTIONS} farklı emoji olur; var olana katılmak serbesttir`, async () => {
    const { admin, member, message } = await setup();
    const emojis = [...'😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😋😛😜🤪']; // 21 farklı emoji
    for (const emoji of emojis.slice(0, MESSAGE_MAX_REACTIONS)) {
      ctx.store.addReaction(Number(message.id), admin.user.id, emoji);
    }
    const over = await react('PUT', member.token, message.id, emojis[MESSAGE_MAX_REACTIONS]!);
    expect(over.statusCode).toBe(400);
    expect(over.json().error).toBe('too_many_reactions');
    expect((await react('PUT', member.token, message.id, emojis[0]!)).statusCode).toBe(204);
  });

  it('mesaj silinince tepkiler de silinir', async () => {
    const { admin, member, message } = await setup();
    await react('PUT', member.token, message.id, '👍');
    await app.inject({ method: 'DELETE', url: `/api/messages/${message.id}`, headers: auth(admin.token) });
    const left = ctx.store.db.prepare('SELECT COUNT(*) AS n FROM reactions').get() as { n: number };
    expect(left.n).toBe(0);
  });

  it('eklenen ve kaldırılan tepkiler gateway ile herkese duyurulur; düzenleme tepkileri taşımaz', async () => {
    const { admin, member, message } = await setup();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };

    const connect = (token: string) =>
      new Promise<{ ws: WebSocket; events: GatewayServerMessage[] }>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/gateway`);
        const events: GatewayServerMessage[] = [];
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as GatewayServerMessage;
          if (msg.t === 'HELLO') ws.send(JSON.stringify({ t: 'IDENTIFY', d: { token } }));
          else if (msg.t === 'READY') resolve({ ws, events });
          else events.push(msg);
        });
      });

    const a = await connect(admin.token);
    const m = await connect(member.token);
    await react('PUT', member.token, message.id, '🔥');
    await react('PUT', member.token, message.id, '🔥'); // tekrar: duyurulmaz
    await react('DELETE', member.token, message.id, '🔥');
    await react('DELETE', member.token, message.id, '🔥'); // tekrar: duyurulmaz
    await app.inject({
      method: 'PATCH',
      url: `/api/messages/${message.id}`,
      headers: auth(admin.token),
      payload: { content: 'düzenlendi' },
    });
    await new Promise((r) => setTimeout(r, 200));

    const expected = { messageId: message.id, channelId: message.channelId, userId: member.user.id, emoji: '🔥' };
    for (const client of [a, m]) {
      const reactionEvents = client.events.filter((e) => e.t.startsWith('MESSAGE_REACTION'));
      expect(reactionEvents).toEqual([
        { t: 'MESSAGE_REACTION_ADD', d: expected },
        { t: 'MESSAGE_REACTION_REMOVE', d: expected },
      ]);
      const update = client.events.find((e) => e.t === 'MESSAGE_UPDATE');
      expect(update).toMatchObject({ d: { content: 'düzenlendi' } });
      expect(update && 'reactions' in update.d).toBe(false);
    }
    a.ws.close();
    m.ws.close();
  });
});
