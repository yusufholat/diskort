import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_FEATURE_DM,
  DEFAULT_EVERYONE_PERMISSIONS,
  Permission as P,
  type Channel,
  type GuildData,
  type Message,
} from '@diskort/shared';
import { TrackSource } from '../src/livekit.js';
import { connectGateway, type Account, type GatewayClient, type TestServer, startServer } from './helpers.js';

let s: TestServer;
let dir: string;
const clients: GatewayClient[] = [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-sunucu-'));
  s = await startServer({ avatarsDir: dir, attachmentsDir: path.join(dir, 'ekler') });
  await s.app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const connect = async (account: Account): Promise<GatewayClient> => {
  const client = await connectGateway(s.app, account.token, [CLIENT_FEATURE_DM]);
  clients.push(client);
  return client;
};

const register = async (inviteCode: string, username: string, password = 'sifre12345'): Promise<Account> => {
  const res = await s.app.inject({ method: 'POST', url: '/api/auth/register', payload: { inviteCode, username, password } });
  expect(res.statusCode).toBe(201);
  return res.json() as Account;
};

/** Hesap daveti (sunucuya katılmadan) ile yeni hesap */
const accountOnly = async (username: string): Promise<Account> => {
  const code = (await s.req(s.owner.token, 'POST', '/api/invites', {})).json().code as string;
  return register(code, username);
};

const createGuild = async (account: Account, name: string): Promise<GuildData> => {
  const res = await s.req(account.token, 'POST', '/api/guilds', { name });
  expect(res.statusCode).toBe(201);
  return res.json() as GuildData;
};

const inviteTo = async (account: Account, guildId: string): Promise<string> => {
  const res = await s.req(account.token, 'POST', `/api/guilds/${guildId}/invites`, {});
  expect(res.statusCode).toBe(201);
  return res.json().code as string;
};

const channelOf = (guild: GuildData, type: 'text' | 'voice'): Channel => guild.channels.find((c) => c.type === type)!;

/**
 * İki sunucu: A (ana sunucu; sahip + alice), B (bob'un kurduğu; bob + carol). Kimse diğer sunucunun
 * üyesi değil.
 */
async function twoGuilds() {
  const alice = await s.member('alice');
  const bob = await accountOnly('bob');
  const b = await createGuild(bob, 'Bob Grubu');
  const carol = await register(await inviteTo(bob, b.guild.id), 'carol');
  return { alice, bob, carol, a: s.guildId, b };
}

describe('sunucu kurma ve katılma', () => {
  it('hesap davetiyle gelen sunucusuz başlar; sunucu kurunca sahibi olur, varsayılan rol ve kanallar gelir', async () => {
    const bob = await accountOnly('bob');
    const g = await connect(bob);
    expect(g.ready.guilds).toEqual([]);
    expect(g.ready.users.map((u) => u.id)).toEqual([bob.user.id]);
    expect((await s.req(bob.token, 'GET', '/api/guilds')).json()).toEqual([]);

    const created = await createGuild(bob, '  Hafta Sonu  ');
    expect(created.guild).toMatchObject({ name: 'Hafta Sonu', ownerId: bob.user.id, iconUrl: null });
    expect(created.channels.map((c) => [c.name, c.type])).toEqual([
      ['genel-sohbet', 'text'],
      ['Genel', 'voice'],
    ]);
    expect(created.roles).toEqual([expect.objectContaining({ id: created.guild.id, name: '@everyone', permissions: DEFAULT_EVERYONE_PERMISSIONS })]);
    expect(DEFAULT_EVERYONE_PERMISSIONS & P.CREATE_INVITE).toBe(P.CREATE_INVITE);
    expect(created.members).toEqual([expect.objectContaining({ userId: bob.user.id, roles: [], removed: false })]);
    // Başka sunucunun sahibi hesap yöneticisi olmaz
    expect(s.ctx.store.getUser(bob.user.id)!.isAdmin).toBe(false);

    await g.settle();
    expect(g.of('GUILD_CREATE').map((d) => d.guild.id)).toEqual([created.guild.id]);
    expect((await s.req(bob.token, 'GET', '/api/guilds')).json().map((x: { id: string }) => x.id)).toEqual([created.guild.id]);
    expect((await s.req(bob.token, 'POST', '/api/guilds', { name: ' ' })).statusCode).toBe(400);
  });

  it('davet bağlantısı önizlenir; davetle katılana GUILD_CREATE, üyelere GUILD_MEMBER_ADD gider', async () => {
    const { bob, b, alice } = await twoGuilds();
    const code = await inviteTo(bob, b.guild.id);
    const preview = await s.app.inject({ method: 'GET', url: `/api/invites/${code.toLowerCase()}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({
      code,
      guild: { id: b.guild.id, name: 'Bob Grubu', iconUrl: null },
      memberCount: 2,
      expiresAt: null,
    });
    expect((await s.app.inject({ method: 'GET', url: '/api/invites/YOKBOYLE' })).statusCode).toBe(404);

    const bobClient = await connect(bob);
    const aliceClient = await connect(alice);
    const joined = await s.req(alice.token, 'POST', `/api/invites/${code}/accept`);
    expect(joined.statusCode).toBe(200);
    expect(joined.json()).toMatchObject({ alreadyMember: false, guild: { id: b.guild.id } });
    await aliceClient.settle();
    const created = aliceClient.of('GUILD_CREATE')[0]!;
    expect(created.guild.id).toBe(b.guild.id);
    expect(created.users.map((u) => u.username).sort()).toEqual(['alice', 'bob', 'carol']);
    expect(created.online).toEqual(expect.arrayContaining([bob.user.id]));
    expect(bobClient.of('GUILD_MEMBER_ADD')).toEqual([
      expect.objectContaining({ guildId: b.guild.id, user: expect.objectContaining({ id: alice.user.id }) }),
    ]);
    // Tekrar kabul davet hakkı harcamaz
    expect((await s.req(alice.token, 'POST', `/api/invites/${code}/accept`)).json().alreadyMember).toBe(true);
    expect(s.ctx.store.getInvite(code)!.uses).toBe(1);
  });

  it('sunucu davetiyle kayıt olan o sunucuya katılır', async () => {
    const bob = await accountOnly('bob');
    const b = await createGuild(bob, 'B');
    const dave = await register(await inviteTo(bob, b.guild.id), 'dave');
    expect(s.ctx.store.userGuildIds(dave.user.id)).toEqual([b.guild.id]);
  });
});

describe('sunucular arası yalıtım', () => {
  it('üyesi olunmayan sunucunun hiçbir ucu yoktur (404)', async () => {
    const { alice, bob, carol, b } = await twoGuilds();
    const text = channelOf(b, 'text');
    const voice = channelOf(b, 'voice');
    const message = (await s.req(carol.token, 'POST', `/api/channels/${text.id}/messages`, { content: 'B içi' })).json() as Message;
    const bRole = (await s.req(bob.token, 'POST', `/api/guilds/${b.guild.id}/roles`, { name: 'B rolü' })).json();

    const g = `/api/guilds/${b.guild.id}`;
    const denied: [string, string, unknown?][] = [
      ['GET', g],
      ['PATCH', g, { name: 'ele geçir' }],
      ['DELETE', g],
      ['GET', `${g}/roles`],
      ['POST', `${g}/roles`, { name: 'x' }],
      ['PATCH', `${g}/roles/${bRole.id}`, { name: 'x' }],
      ['GET', `${g}/members`],
      ['GET', `${g}/invites`],
      ['POST', `${g}/invites`, {}],
      ['GET', `${g}/bans`],
      ['PUT', `${g}/bans/${carol.user.id}`, {}],
      ['DELETE', `${g}/members/${carol.user.id}`],
      ['DELETE', `${g}/members/me`],
      ['PATCH', `${g}/members/${carol.user.id}/voice`, { mute: true }],
      ['PUT', `${g}/members/${carol.user.id}/roles/${bRole.id}`],
      ['GET', `${g}/channels`],
      ['POST', `${g}/channels`, { name: 'x', type: 'text' }],
      ['GET', `/api/channels/${text.id}/messages`],
      ['POST', `/api/channels/${text.id}/messages`, { content: 'sızma' }],
      ['POST', `/api/channels/${text.id}/ack`, { messageId: message.id }],
      ['PATCH', `/api/channels/${text.id}`, { name: 'x' }],
      ['DELETE', `/api/channels/${text.id}`],
      ['PATCH', `/api/messages/${message.id}`, { content: 'x' }],
      ['DELETE', `/api/messages/${message.id}`],
      ['PUT', `/api/messages/${message.id}/reactions/👍`],
      ['POST', `/api/voice/${voice.id}/join`],
    ];
    for (const [method, url, body] of denied) {
      const res = await s.req(alice.token, method, url, body);
      expect([method, url, res.statusCode]).toEqual([method, url, 404]);
    }
    const upload = await s.app.inject({
      method: 'POST',
      url: `/api/channels/${text.id}/attachments?name=a.txt`,
      headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(upload.statusCode).toBe(404);
    // Tüm kanal listesinde yalnızca kendi sunucusu
    const all = (await s.req(alice.token, 'GET', '/api/channels')).json() as Channel[];
    expect(all.every((c) => c.guildId === s.guildId)).toBe(true);
    // Hiçbir şey değişmedi
    expect(s.ctx.store.getGuild(b.guild.id)!.name).toBe('Bob Grubu');
    expect(s.ctx.store.getMessage(Number(message.id))!.content).toBe('B içi');
  });

  it('başka sunucunun rolü ve üyesi yönetilemez; kanal izninde başka sunucunun rolü kullanılamaz', async () => {
    const { carol, bob, b } = await twoGuilds();
    const a = s.guildId;
    const aRole = await s.createRole(s.owner.token, { name: 'A rolü' });
    const bRole = (await s.req(bob.token, 'POST', `/api/guilds/${b.guild.id}/roles`, { name: 'B rolü' })).json();
    // A'nın sahibi carol'a (A üyesi değil) rol veremez, atamaz, susturamaz
    expect((await s.req(s.owner.token, 'PUT', `/api/guilds/${a}/members/${carol.user.id}/roles/${aRole.id}`)).statusCode).toBe(404);
    expect((await s.req(s.owner.token, 'DELETE', `/api/guilds/${a}/members/${carol.user.id}`)).statusCode).toBe(404);
    expect((await s.req(s.owner.token, 'PATCH', `/api/guilds/${a}/members/${carol.user.id}/voice`, { mute: true })).statusCode).toBe(404);
    // B'nin rolü A üzerinden kullanılamaz
    expect((await s.req(s.owner.token, 'PATCH', `/api/guilds/${a}/roles/${bRole.id}`, { name: 'x' })).statusCode).toBe(404);
    expect((await s.req(s.owner.token, 'DELETE', `/api/guilds/${a}/roles/${bRole.id}`)).statusCode).toBe(404);
    const aText = s.channel('text');
    const overwrite = await s.req(s.owner.token, 'PATCH', `/api/channels/${aText.id}`, {
      overwrites: [{ roleId: bRole.id, allow: P.VIEW_CHANNEL, deny: 0 }],
    });
    expect(overwrite.statusCode).toBe(400);
    // Sıralama yalnızca kendi rolleri
    expect((await s.req(bob.token, 'PUT', `/api/guilds/${b.guild.id}/roles/order`, { roleIds: [bRole.id] })).statusCode).toBe(200);
    expect(
      (await s.req(bob.token, 'PUT', `/api/guilds/${b.guild.id}/roles/order`, { roleIds: [bRole.id, aRole.id] })).statusCode,
    ).toBe(400);
  });

  it('bahsetmeler, @everyone ve DM yalnızca ortak sunucu içinde', async () => {
    const { alice, carol, b } = await twoGuilds();
    const aText = s.channel('text');
    await s.req(alice.token, 'POST', `/api/channels/${aText.id}/messages`, { content: '@carol @everyone selam' });
    expect(s.ctx.store.mentionCounts(carol.user.id)).toEqual({});
    expect(s.ctx.store.mentionCounts(s.owner.user.id)).toEqual({ [aText.id]: 1 });
    // Ortak sunucu yok: DM başlatılamaz, gruba eklenemez
    expect((await s.req(alice.token, 'POST', '/api/dms', { userIds: [carol.user.id] })).statusCode).toBe(404);
    const extra = await s.member('ekstra');
    const group = (await s.req(alice.token, 'POST', '/api/dms', { userIds: [s.owner.user.id, extra.user.id] })).json();
    expect((await s.req(alice.token, 'PUT', `/api/dms/${group.id}/participants/${carol.user.id}`)).statusCode).toBe(404);
    // Ortak sunucu olunca açılır
    await s.req(alice.token, 'POST', `/api/invites/${await inviteTo(carol, b.guild.id)}/accept`);
    expect((await s.req(alice.token, 'POST', '/api/dms', { userIds: [carol.user.id] })).statusCode).toBe(201);
  });

  it('gateway: READY ve olaylar yalnızca kendi sunucularından; profil ve çevrimiçi bilgisi sızmaz', async () => {
    const { alice, bob, carol, b } = await twoGuilds();
    const aText = s.channel('text');
    const aVoice = s.channel('voice');
    const bText = channelOf(b, 'text');
    const bVoice = channelOf(b, 'voice');
    s.ctx.voice.join(bob.user.id, bVoice.id);
    await s.req(carol.token, 'POST', `/api/channels/${bText.id}/messages`, { content: 'B mesajı' });

    const al = await connect(alice);
    const ca = await connect(carol);
    expect(al.ready.guilds.map((g) => g.guild.id)).toEqual([s.guildId]);
    expect(al.ready.users.map((u) => u.username).sort()).toEqual(['alice', 'sahip']);
    expect(al.ready.voiceStates).toEqual([]);
    expect(al.ready.lastMessageIds[bText.id]).toBeUndefined();
    expect(al.ready.online).not.toContain(carol.user.id);
    expect(ca.ready.guilds.map((g) => g.guild.id)).toEqual([b.guild.id]);
    expect(ca.ready.users.map((u) => u.username).sort()).toEqual(['bob', 'carol']);
    expect(ca.ready.online).not.toContain(alice.user.id);
    expect(ca.ready.voiceStates.map((v) => v.userId)).toEqual([bob.user.id]);

    // A'daki her şey: mesaj, tepki, yazıyor, ses, profil, sunucu, rol
    al.ws.send(JSON.stringify({ t: 'TYPING_START', d: { channelId: aText.id } }));
    const m = (await s.req(alice.token, 'POST', `/api/channels/${aText.id}/messages`, { content: 'A mesajı' })).json();
    await s.req(alice.token, 'PUT', `/api/messages/${m.id}/reactions/👍`);
    s.ctx.voice.join(alice.user.id, aVoice.id);
    await s.req(alice.token, 'PATCH', '/api/me', { displayName: 'Alice Yeni' });
    await s.req(s.owner.token, 'PATCH', `/api/guilds/${s.guildId}`, { name: 'A Yeni' });
    await s.createRole(s.owner.token, { name: 'A rolü' });
    const late = await s.member('gec');
    await ca.settle();
    expect(ca.events).toEqual([]);

    // B'deki olaylar A'ya gitmez
    await s.req(carol.token, 'POST', `/api/channels/${bText.id}/messages`, { content: 'B yine' });
    await s.req(bob.token, 'PATCH', `/api/guilds/${b.guild.id}`, { name: 'B Yeni' });
    s.ctx.voice.leave(bob.user.id, bVoice.id);
    await al.settle();
    expect(al.of('GUILD_UPDATE').map((x) => x.id)).toEqual([s.guildId]);
    expect(al.of('MESSAGE_CREATE').map((x) => x.content)).toEqual(['A mesajı']);
    expect(al.of('VOICE_STATE_DELETE')).toEqual([]);
    expect(al.of('GUILD_MEMBER_ADD').map((x) => x.user.id)).toEqual([late.user.id]);
  });

  it('sunucuda susturma o sunucuya özeldir; başka sunucunun kanalına taşınamaz', async () => {
    const { bob, b } = await twoGuilds();
    // bob A'ya da katılır
    await s.req(bob.token, 'POST', `/api/invites/${await inviteTo(s.owner, s.guildId)}/accept`);
    const aVoice = s.channel('voice');
    const bVoice = channelOf(b, 'voice');
    s.ctx.voice.join(bob.user.id, aVoice.id);
    expect((await s.req(s.owner.token, 'PATCH', `/api/guilds/${s.guildId}/members/${bob.user.id}/voice`, { mute: true })).statusCode).toBe(204);
    expect(s.ctx.voice.get(bob.user.id)!.serverMute).toBe(true);
    // A'nın sahibi bob'u B'nin kanalına taşıyamaz
    const move = await s.req(s.owner.token, 'PATCH', `/api/guilds/${s.guildId}/members/${bob.user.id}/voice`, {
      channelId: bVoice.id,
    });
    expect(move.statusCode).toBe(404);
    // B'ye geçince susturma yok; A'ya dönünce sürer
    s.ctx.voice.join(bob.user.id, bVoice.id);
    expect(s.ctx.voice.get(bob.user.id)!.serverMute).toBe(false);
    expect(s.ctx.moderation.sources(bob.user.id, bVoice.id)).toContain(TrackSource.MICROPHONE);
    expect(s.ctx.moderation.sources(bob.user.id, aVoice.id)).not.toContain(TrackSource.MICROPHONE);
    // A'nın sahibi B'de seste olan bob'u sesten çıkaramaz
    const kick = await s.req(s.owner.token, 'PATCH', `/api/guilds/${s.guildId}/members/${bob.user.id}/voice`, { channelId: null });
    expect(kick.statusCode).toBe(400);
    expect(s.ctx.voice.get(bob.user.id)!.channelId).toBe(bVoice.id);
    s.ctx.voice.join(bob.user.id, aVoice.id);
    expect(s.ctx.voice.get(bob.user.id)!.serverMute).toBe(true);
  });
});

describe('sunucu yönetimi', () => {
  it('ayrılma, sahiplik, silme; ana sunucu silinemez', async () => {
    const { bob, carol, b } = await twoGuilds();
    const bobClient = await connect(bob);
    const carolClient = await connect(carol);
    // Sahip ayrılamaz; üye ayrılır
    expect((await s.req(bob.token, 'DELETE', `/api/guilds/${b.guild.id}/members/me`)).statusCode).toBe(400);
    expect((await s.req(carol.token, 'DELETE', `/api/guilds/${b.guild.id}/members/me`)).statusCode).toBe(204);
    await carolClient.settle();
    expect(carolClient.of('GUILD_DELETE')).toEqual([{ id: b.guild.id }]);
    expect(bobClient.of('GUILD_MEMBER_REMOVE')).toEqual([{ guildId: b.guild.id, userId: carol.user.id }]);
    expect(s.ctx.store.getMember(b.guild.id, carol.user.id)).toMatchObject({ removed: true });

    // Geri döner, sahiplik devredilir
    await s.req(carol.token, 'POST', `/api/invites/${await inviteTo(bob, b.guild.id)}/accept`);
    expect((await s.req(carol.token, 'PATCH', `/api/guilds/${b.guild.id}`, { ownerId: carol.user.id })).statusCode).toBe(403);
    expect((await s.req(bob.token, 'PATCH', `/api/guilds/${b.guild.id}`, { ownerId: s.owner.user.id })).statusCode).toBe(404);
    const transfer = await s.req(bob.token, 'PATCH', `/api/guilds/${b.guild.id}`, { ownerId: carol.user.id });
    expect(transfer.json().ownerId).toBe(carol.user.id);
    // Sahip hesabını silemez
    const del = await s.req(carol.token, 'DELETE', '/api/me', { password: 'sifre12345' });
    expect(del.json().error).toBe('owner');

    // Silme: yalnızca sahip; üyeler GUILD_DELETE alır, her şey gider
    const message = (await s.req(bob.token, 'POST', `/api/channels/${channelOf(b, 'text').id}/messages`, { content: 'x' })).json();
    expect((await s.req(bob.token, 'DELETE', `/api/guilds/${b.guild.id}`)).statusCode).toBe(403);
    bobClient.events.length = 0;
    expect((await s.req(carol.token, 'DELETE', `/api/guilds/${b.guild.id}`)).statusCode).toBe(204);
    await bobClient.settle();
    expect(bobClient.of('GUILD_DELETE')).toEqual([{ id: b.guild.id, reason: 'Sunucu silindi.' }]);
    expect(s.ctx.store.getGuild(b.guild.id)).toBeNull();
    expect(s.ctx.store.getMessage(Number(message.id))).toBeNull();
    expect(s.ctx.store.listChannels(b.guild.id)).toEqual([]);
    expect(s.ctx.store.userGuildIds(bob.user.id)).toEqual([]);
    expect(s.ctx.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    // Ana sunucu silinemez
    const primary = await s.req(s.owner.token, 'DELETE', `/api/guilds/${s.guildId}`);
    expect(primary.statusCode).toBe(400);
    expect(primary.json().error).toBe('primary_guild');
  });

  it('ad ve simge MANAGE_GUILD ister; simge küçültülüp herkese açık adresten sunulur', async () => {
    const { bob, carol, b } = await twoGuilds();
    const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const upload = (token: string) =>
      s.app.inject({
        method: 'POST',
        url: `/api/guilds/${b.guild.id}/icon`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' },
        payload: png,
      });
    expect((await upload(carol.token)).statusCode).toBe(403);
    expect((await s.req(carol.token, 'PATCH', `/api/guilds/${b.guild.id}`, { name: 'x' })).statusCode).toBe(403);
    const carolClient = await connect(carol);
    const res = await upload(bob.token);
    expect(res.statusCode).toBe(200);
    const iconUrl = res.json().iconUrl as string;
    expect(iconUrl).toMatch(new RegExp(`^/api/guild-icons/${b.guild.id}/[0-9a-f]{32}\\.webp$`));
    const served = await s.app.inject({ method: 'GET', url: iconUrl });
    expect(served.statusCode).toBe(200);
    expect(await sharp(served.rawPayload).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
    await carolClient.settle();
    expect(carolClient.of('GUILD_UPDATE').at(-1)?.iconUrl).toBe(iconUrl);

    expect((await s.req(bob.token, 'DELETE', `/api/guilds/${b.guild.id}/icon`)).json().iconUrl).toBeNull();
    expect((await s.app.inject({ method: 'GET', url: iconUrl })).statusCode).toBe(404);
  });
});
