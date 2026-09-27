import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_EVERYONE_PERMISSIONS,
  MAX_PINS_PER_CHANNEL,
  Permission as P,
  type Channel,
  type DmChannel,
  type GuildData,
  type Message,
  type PinnedMessage,
} from '@diskort/shared';
import { MIGRATIONS, Store } from '../src/db.js';
import { connectGateway, startServer, type Account, type GatewayClient, type TestServer } from './helpers.js';

let s: TestServer;
const clients: GatewayClient[] = [];

beforeEach(async () => {
  s = await startServer();
  await s.app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await s.close();
});

const connect = async (token: string, features?: string[]): Promise<GatewayClient> => {
  const client = await connectGateway(s.app, token, features);
  clients.push(client);
  return client;
};

const send = async (token: string, channelId: string, content: string): Promise<Message> => {
  const res = await s.req(token, 'POST', `/api/channels/${channelId}/messages`, { content });
  expect(res.statusCode).toBe(201);
  return res.json() as Message;
};

const pin = (token: string, channelId: string, messageId: string) =>
  s.req(token, 'PUT', `/api/channels/${channelId}/pins/${messageId}`);
const unpin = (token: string, channelId: string, messageId: string) =>
  s.req(token, 'DELETE', `/api/channels/${channelId}/pins/${messageId}`);
const pins = async (token: string, channelId: string): Promise<PinnedMessage[]> => {
  const res = await s.req(token, 'GET', `/api/channels/${channelId}/pins`);
  expect(res.statusCode).toBe(200);
  return res.json() as PinnedMessage[];
};

describe('mesaj sabitleme', () => {
  it('@everyone varsayılan olarak sabitleyemez; PIN_MESSAGES yetkili rol ve sahip sabitler', async () => {
    expect(DEFAULT_EVERYONE_PERMISSIONS & P.PIN_MESSAGES).toBe(0);
    const member = await s.member('uye');
    const mod = await s.member('mod');
    const text = s.channel('text');
    const msg = await send(member.token, text.id, 'önemli');

    expect((await pin(member.token, text.id, msg.id)).statusCode).toBe(403);
    // MANAGE_MESSAGES tek başına sabitlemeye yetmez (ayrı yetki)
    const deleter = await s.createRole(s.owner.token, { name: 'Silici', permissions: P.MANAGE_MESSAGES });
    await s.giveRole(s.owner.token, member.user.id, deleter.id);
    expect((await pin(member.token, text.id, msg.id)).statusCode).toBe(403);

    const role = await s.createRole(s.owner.token, { name: 'Sabitleyici', permissions: P.PIN_MESSAGES });
    await s.giveRole(s.owner.token, mod.user.id, role.id);
    expect((await pin(mod.token, text.id, msg.id)).statusCode).toBe(204);
    // Tekrar sabitlemek zararsız
    expect((await pin(mod.token, text.id, msg.id)).statusCode).toBe(204);

    const list = await pins(member.token, text.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: msg.id, content: 'önemli', pinned: true, pinnedBy: mod.user.id });
    expect(typeof list[0]!.pinnedAt).toBe('number');
    // Mesaj listesinde de sabitli görünür
    const page = (await s.req(member.token, 'GET', `/api/channels/${text.id}/messages`)).json() as Message[];
    expect(page.find((m) => m.id === msg.id)?.pinned).toBe(true);

    // Üye kaldıramaz; sahip kaldırır
    expect((await unpin(member.token, text.id, msg.id)).statusCode).toBe(403);
    expect((await unpin(s.owner.token, text.id, msg.id)).statusCode).toBe(204);
    expect((await unpin(s.owner.token, text.id, msg.id)).statusCode).toBe(204);
    expect(await pins(member.token, text.id)).toEqual([]);
    const after = (await s.req(member.token, 'GET', `/api/channels/${text.id}/messages`)).json() as Message[];
    expect(after.find((m) => m.id === msg.id)?.pinned).toBe(false);
  });

  it('kanal izniyle sabitleme verilir ya da alınır', async () => {
    const member = await s.member('uye');
    const text = s.channel('text');
    const msg = await send(s.owner.token, text.id, 'x');
    await s.req(s.owner.token, 'PATCH', `/api/channels/${text.id}`, {
      overwrites: [{ roleId: s.guildId, allow: P.PIN_MESSAGES, deny: 0 }],
    });
    expect((await pin(member.token, text.id, msg.id)).statusCode).toBe(204);
  });

  it('liste en son sabitlenenle başlar; kanal başına en fazla 50 sabit mesaj', async () => {
    const text = s.channel('text');
    const sent: Message[] = [];
    for (let i = 0; i <= MAX_PINS_PER_CHANNEL; i++) {
      sent.push(s.ctx.store.createMessage(text.id, s.owner.user.id, `m${i}`)!);
    }
    for (const m of sent.slice(0, MAX_PINS_PER_CHANNEL)) expect((await pin(s.owner.token, text.id, m.id)).statusCode).toBe(204);
    const extra = await pin(s.owner.token, text.id, sent.at(-1)!.id);
    expect(extra.statusCode).toBe(400);
    expect(extra.json().error).toBe('too_many_pins');
    expect(extra.json().message).toContain(String(MAX_PINS_PER_CHANNEL));

    const list = await pins(s.owner.token, text.id);
    expect(list).toHaveLength(MAX_PINS_PER_CHANNEL);
    expect(list[0]!.id).toBe(sent[MAX_PINS_PER_CHANNEL - 1]!.id);
    expect(list.at(-1)!.id).toBe(sent[0]!.id);

    // Biri kaldırılınca yer açılır; sonradan sabitlenen en başta
    await unpin(s.owner.token, text.id, sent[3]!.id);
    expect((await pin(s.owner.token, text.id, sent.at(-1)!.id)).statusCode).toBe(204);
    expect((await pins(s.owner.token, text.id))[0]!.id).toBe(sent.at(-1)!.id);
  });

  it('sabit mesaj silinince sabitlemesi de gider ve duyurulur', async () => {
    const text = s.channel('text');
    const member = await s.member('uye');
    const msg = await send(member.token, text.id, 'sil beni');
    await pin(s.owner.token, text.id, msg.id);
    const m = await connect(member.token);
    expect((await s.req(member.token, 'DELETE', `/api/messages/${msg.id}`)).statusCode).toBe(204);
    await m.settle();
    expect(m.of('CHANNEL_PINS_UPDATE')).toEqual([{ channelId: text.id, lastPinAt: null }]);
    expect(await pins(s.owner.token, text.id)).toEqual([]);
    expect(s.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM message_pins').get()).toEqual({ n: 0 });
  });

  it('başka kanalın mesajı, görülemeyen kanal ve başka sunucu yalıtılır (404)', async () => {
    const outsider = await s.member('yabanci');
    const member = await s.member('uye');
    const text = s.channel('text');
    const second = (await s.req(s.owner.token, 'POST', `/api/guilds/${s.guildId}/channels`, { name: 'ikinci', type: 'text' }))
      .json() as Channel;
    const msg = await send(s.owner.token, text.id, 'x');
    // Mesaj başka kanaldan sabitlenemez
    expect((await pin(s.owner.token, second.id, msg.id)).statusCode).toBe(404);
    expect((await pin(s.owner.token, text.id, '99999')).statusCode).toBe(404);
    // Ses kanalında sabit mesaj yok
    expect((await s.req(s.owner.token, 'GET', `/api/channels/${s.channel('voice').id}/pins`)).statusCode).toBe(404);

    await pin(s.owner.token, text.id, msg.id);
    // Gizli kanal: görmeyen için yok
    await s.req(s.owner.token, 'PATCH', `/api/channels/${text.id}`, {
      overwrites: [{ roleId: s.guildId, allow: P.PIN_MESSAGES, deny: P.VIEW_CHANNEL }],
    });
    expect((await s.req(member.token, 'GET', `/api/channels/${text.id}/pins`)).statusCode).toBe(404);
    expect((await pin(member.token, text.id, msg.id)).statusCode).toBe(404);
    expect((await unpin(member.token, text.id, msg.id)).statusCode).toBe(404);

    // Başka sunucu: bu sunucunun sahibi orada üye değil
    const other = (await s.req(outsider.token, 'POST', '/api/guilds', { name: 'Diğer' })).json() as GuildData;
    const otherText = other.channels.find((c) => c.type === 'text')!;
    const otherMsg = await send(outsider.token, otherText.id, 'benim sunucum');
    // Bu sunucunun sahibi o sunucunun üyesi değil
    expect((await pin(s.owner.token, otherText.id, otherMsg.id)).statusCode).toBe(404);
    expect((await s.req(s.owner.token, 'GET', `/api/channels/${otherText.id}/pins`)).statusCode).toBe(404);
    expect((await pin(outsider.token, otherText.id, otherMsg.id)).statusCode).toBe(204);
  });

  it('gateway: MESSAGE_UPDATE (pinned) ve CHANNEL_PINS_UPDATE yalnızca kanalı görenlere gider', async () => {
    const member = await s.member('uye');
    const vip = await s.member('vip');
    const role = await s.createRole(s.owner.token, { name: 'VIP' });
    await s.giveRole(s.owner.token, vip.user.id, role.id);
    const text = s.channel('text');
    await s.req(s.owner.token, 'PATCH', `/api/channels/${text.id}`, {
      overwrites: [
        { roleId: s.guildId, allow: 0, deny: P.VIEW_CHANNEL },
        { roleId: role.id, allow: P.VIEW_CHANNEL, deny: 0 },
      ],
    });
    const msg = await send(vip.token, text.id, 'gizli');
    const m = await connect(member.token);
    const v = await connect(vip.token);
    expect((await pin(s.owner.token, text.id, msg.id)).statusCode).toBe(204);
    await v.settle();
    await m.settle();
    expect(v.of('MESSAGE_UPDATE').map((u) => [u.id, u.pinned])).toEqual([[msg.id, true]]);
    const update = v.of('CHANNEL_PINS_UPDATE');
    expect(update).toHaveLength(1);
    expect(update[0]!.channelId).toBe(text.id);
    expect(typeof update[0]!.lastPinAt).toBe('number');
    expect(m.of('MESSAGE_UPDATE')).toEqual([]);
    expect(m.of('CHANNEL_PINS_UPDATE')).toEqual([]);

    await unpin(s.owner.token, text.id, msg.id);
    await v.settle();
    expect(v.of('MESSAGE_UPDATE').at(-1)?.pinned).toBe(false);
    expect(v.of('CHANNEL_PINS_UPDATE').at(-1)).toEqual({ channelId: text.id, lastPinAt: null });
  });
});

describe('direkt mesajda sabitleme', () => {
  async function openDm(a: Account, b: Account): Promise<DmChannel> {
    const res = await s.req(a.token, 'POST', '/api/dms', { userIds: [b.user.id] });
    return res.json() as DmChannel;
  }

  it('iki katılımcı da sabitler ve kaldırır; dışarıdakiler (sahip dahil) erişemez', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const dm = await openDm(ali, veli);
    const msg = await send(ali.token, dm.id, 'unutma');
    const v = await connect(veli.token, ['dm']);
    const oldClient = await connect(veli.token);

    expect((await pin(veli.token, dm.id, msg.id)).statusCode).toBe(204);
    expect((await pins(ali.token, dm.id)).map((p) => [p.id, p.pinnedBy])).toEqual([[msg.id, veli.user.id]]);
    await v.settle();
    expect(v.of('CHANNEL_PINS_UPDATE')).toHaveLength(1);
    expect(v.of('MESSAGE_UPDATE').at(-1)?.pinned).toBe(true);
    // DM'i tanımayan eski istemciye DM olayları hiç gitmez
    expect(oldClient.of('CHANNEL_PINS_UPDATE')).toEqual([]);

    for (const t of [s.owner.token]) {
      expect((await s.req(t, 'GET', `/api/channels/${dm.id}/pins`)).statusCode).toBe(404);
      expect((await pin(t, dm.id, msg.id)).statusCode).toBe(404);
      expect((await unpin(t, dm.id, msg.id)).statusCode).toBe(404);
    }
    expect((await unpin(ali.token, dm.id, msg.id)).statusCode).toBe(204);
    expect(await pins(veli.token, dm.id)).toEqual([]);
  });
});

describe('göç 18: sabitlenmiş mesajlar', () => {
  it('PIN_MESSAGES yalnızca MANAGE_MESSAGES yetkili rollere ve kanal izinlerine yansır; tekrar çalışması zararsız', () => {
    const now = Date.now();
    // Şema 16 veritabanı (göç 17 yer tutucudur, 18 ondan bağımsızdır)
    const check = new DatabaseSync(':memory:');
    for (const sql of MIGRATIONS.slice(0, 16)) check.exec(sql);
    check.exec(`INSERT INTO guilds (id, name, created_at) VALUES ('g', 'G', ${now})`);
    check.exec(`INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES ('c', 'g', 'genel', 'text', 0, ${now})`);
    const addRole = (id: string, permissions: number, position: number) =>
      check.exec(
        `INSERT INTO roles (id, guild_id, name, position, permissions, created_at) VALUES ('${id}', 'g', '${id}', ${position}, ${permissions}, ${now})`,
      );
    addRole('g', DEFAULT_EVERYONE_PERMISSIONS, 0);
    addRole('mod', P.MANAGE_MESSAGES | P.KICK_MEMBERS, 1);
    addRole('dj', P.CONNECT, 2);
    check.exec(
      `INSERT INTO channel_overwrites (channel_id, role_id, allow, deny) VALUES ('c', 'g', ${P.MANAGE_MESSAGES}, 0), ('c', 'dj', 0, ${P.MANAGE_MESSAGES})`,
    );
    for (const sql of MIGRATIONS.slice(16)) check.exec(sql);
    // İkinci kez çalışsa da sonuç aynı
    check.exec(MIGRATIONS[17]!);
    const perms = Object.fromEntries(
      (check.prepare('SELECT id, permissions FROM roles').all() as { id: string; permissions: number }[]).map((r) => [
        r.id,
        r.permissions,
      ]),
    );
    expect(perms.g).toBe(DEFAULT_EVERYONE_PERMISSIONS);
    expect(perms.mod).toBe(P.MANAGE_MESSAGES | P.KICK_MEMBERS | P.PIN_MESSAGES);
    expect(perms.dj).toBe(P.CONNECT);
    const ow = check.prepare('SELECT role_id, allow, deny FROM channel_overwrites ORDER BY role_id').all();
    expect(ow).toEqual([
      { role_id: 'dj', allow: 0, deny: P.MANAGE_MESSAGES | P.PIN_MESSAGES },
      { role_id: 'g', allow: P.MANAGE_MESSAGES | P.PIN_MESSAGES, deny: 0 },
    ]);
    check.close();

    // Yeni veritabanı son sürüme göçer, sabitleme tablosu vardır
    const store = new Store(':memory:');
    try {
      expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
      expect(MIGRATIONS.length).toBeGreaterThanOrEqual(18);
      expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'message_pins'").get()).toEqual({
        name: 'message_pins',
      });
    } finally {
      store.close();
    }
  });
});
