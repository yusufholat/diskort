import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Permission as P, type Channel } from '@diskort/shared';
import { connectGateway, startServer, type GatewayClient, type TestServer } from './helpers.js';

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

const connect = async (token: string): Promise<GatewayClient> => {
  const client = await connectGateway(s.app, token);
  clients.push(client);
  return client;
};

/** @everyone görmez, verilen rol görür */
async function hideChannel(channel: Channel, roleId?: string): Promise<void> {
  const overwrites = [{ roleId: s.ctx.guild.id, allow: 0, deny: P.VIEW_CHANNEL }];
  if (roleId) overwrites.push({ roleId, allow: P.VIEW_CHANNEL, deny: 0 });
  const res = await s.req(s.owner.token, 'PATCH', `/api/channels/${channel.id}`, { overwrites });
  expect(res.statusCode).toBe(200);
}

describe('gateway süzgeci', () => {
  it('READY yalnızca görülebilen kanalları, onların ses durumlarını ve okunmamış bilgisini taşır', async () => {
    const member = await s.member('uye');
    const text = s.channel('text');
    const voice = s.channel('voice');
    await s.req(s.owner.token, 'POST', `/api/channels/${text.id}/messages`, { content: 'gizli' });
    s.ctx.voice.join(s.owner.user.id, voice.id);
    await hideChannel(text);
    await hideChannel(voice);

    const m = await connect(member.token);
    expect(m.ready.guilds).toHaveLength(1);
    const [guild] = m.ready.guilds;
    const ids = guild!.channels.map((c) => c.id);
    expect(ids).not.toContain(text.id);
    expect(ids).not.toContain(voice.id);
    expect(m.ready.voiceStates).toEqual([]);
    expect(m.ready.lastMessageIds[text.id]).toBeUndefined();
    expect(guild!.roles.map((r) => r.name)).toEqual(['Yönetici', '@everyone']);
    expect(guild!.guild.ownerId).toBe(s.owner.user.id);
    expect(guild!.members.find((u) => u.userId === s.owner.user.id)?.roles).toHaveLength(1);
    expect(m.ready.users.map((u) => u.id).sort()).toEqual([s.owner.user.id, member.user.id].sort());

    const o = await connect(s.owner.token);
    expect(o.ready.guilds[0]!.channels.map((c) => c.id)).toEqual(expect.arrayContaining([text.id, voice.id]));
    expect(o.ready.voiceStates).toHaveLength(1);
  });

  it('görülemeyen kanalın mesajları, tepkileri, "yazıyor" ve ses olayları gitmez', async () => {
    const member = await s.member('uye');
    const vip = await s.member('vip');
    const role = await s.createRole(s.owner.token, { name: 'VIP' });
    await s.giveRole(s.owner.token, vip.user.id, role.id);
    const text = s.channel('text');
    const voice = s.channel('voice');
    await hideChannel(text, role.id);
    await hideChannel(voice, role.id);

    const m = await connect(member.token);
    const v = await connect(vip.token);
    v.ws.send(JSON.stringify({ t: 'TYPING_START', d: { channelId: text.id } }));
    const msg = (await s.req(vip.token, 'POST', `/api/channels/${text.id}/messages`, { content: 'sır' })).json();
    await s.req(vip.token, 'PUT', `/api/messages/${msg.id}/reactions/👍`);
    s.ctx.voice.join(vip.user.id, voice.id);
    // Görünen kanalda mesaj (ikisi de görür)
    const open = (await s.req(s.owner.token, 'POST', `/api/guilds/${s.guildId}/channels`, { name: 'acik', type: 'text' })).json() as Channel;
    await s.req(s.owner.token, 'POST', `/api/channels/${open.id}/messages`, { content: 'herkese' });
    await m.settle();

    const types = (c: GatewayClient) => c.events.map((e) => e.t);
    expect(types(m)).not.toContain('TYPING_START');
    expect(types(m)).not.toContain('MESSAGE_REACTION_ADD');
    expect(types(m)).not.toContain('VOICE_STATE_UPDATE');
    expect(m.of('MESSAGE_CREATE').map((x) => x.content)).toEqual(['herkese']);
    expect(v.of('MESSAGE_CREATE').map((x) => x.content)).toEqual(['sır', 'herkese']);
    expect(types(v)).toContain('MESSAGE_REACTION_ADD');
    expect(types(v)).toContain('VOICE_STATE_UPDATE');
  });

  it('rol verilip alınınca kanal görünümü canlı güncellenir; izin değişikliği görenlere CHANNEL_UPDATE olarak gider', async () => {
    const member = await s.member('uye');
    const role = await s.createRole(s.owner.token, { name: 'VIP' });
    const text = s.channel('text');
    const voice = s.channel('voice');
    s.ctx.voice.join(s.owner.user.id, voice.id);
    await hideChannel(text, role.id);
    await hideChannel(voice, role.id);

    const m = await connect(member.token);
    const o = await connect(s.owner.token);
    await s.giveRole(s.owner.token, member.user.id, role.id);
    await m.settle();
    expect(m.of('GUILD_MEMBER_UPDATE').at(-1)).toEqual({
      guildId: s.guildId,
      member: expect.objectContaining({ userId: member.user.id, roles: [role.id] }),
    });
    expect(m.of('CHANNEL_CREATE').map((c) => c.id).sort()).toEqual([text.id, voice.id].sort());
    expect(m.of('VOICE_STATE_UPDATE').map((v) => v.userId)).toEqual([s.owner.user.id]);

    // Kanal izni değişince görmeye devam edenler güncel kanalı alır
    await s.req(s.owner.token, 'PATCH', `/api/channels/${text.id}`, {
      overwrites: [
        { roleId: s.ctx.guild.id, allow: 0, deny: P.VIEW_CHANNEL },
        { roleId: role.id, allow: P.VIEW_CHANNEL, deny: P.SEND_MESSAGES },
      ],
    });
    await m.settle();
    expect(m.of('CHANNEL_UPDATE').at(-1)?.overwrites).toHaveLength(2);
    expect(o.of('CHANNEL_UPDATE').at(-1)?.id).toBe(text.id);

    m.events.length = 0;
    await s.req(s.owner.token, 'DELETE', `/api/guilds/${s.guildId}/members/${member.user.id}/roles/${role.id}`);
    await m.settle();
    expect(m.of('CHANNEL_DELETE').map((c) => c.id).sort()).toEqual([text.id, voice.id].sort());
    expect(m.of('VOICE_STATE_DELETE')).toEqual([{ userId: s.owner.user.id, channelId: voice.id }]);
    // Sahip hiçbir şey kaybetmedi
    expect(o.of('CHANNEL_DELETE')).toEqual([]);
  });

  it('rol değişiklikleri ROLES_UPDATE, sunucu değişiklikleri GUILD_UPDATE ile duyurulur; atılan üye sunucuyu kaybeder', async () => {
    const member = await s.member('uye');
    const m = await connect(member.token);
    const o = await connect(s.owner.token);
    const role = await s.createRole(s.owner.token, { name: 'Yeni', color: '#123456', hoist: true });
    await s.req(s.owner.token, 'PATCH', `/api/guilds/${s.guildId}`, { name: 'Arkadaşlar' });
    await m.settle();
    expect(m.of('ROLES_UPDATE').at(-1)?.roles.map((r) => r.id)).toContain(role.id);
    expect(m.of('ROLES_UPDATE').at(-1)?.guildId).toBe(s.guildId);
    expect(m.of('GUILD_UPDATE').at(-1)?.name).toBe('Arkadaşlar');

    await s.req(s.owner.token, 'DELETE', `/api/guilds/${s.guildId}/members/${member.user.id}`);
    await m.settle();
    // Bağlantı açık kalır (hesap başka sunuculara katılabilir), sunucu listeden kalkar
    expect(m.ws.readyState).toBe(m.ws.OPEN);
    expect(m.of('GUILD_DELETE')).toEqual([{ id: s.guildId, reason: expect.stringContaining('çıkarıldın') }]);
    expect(o.of('GUILD_MEMBER_REMOVE')).toEqual([{ guildId: s.guildId, userId: member.user.id }]);
    // Artık o sunucunun hiçbir olayı gelmez
    m.events.length = 0;
    await s.req(s.owner.token, 'POST', `/api/channels/${s.channel('text').id}/messages`, { content: 'yok' });
    await s.req(s.owner.token, 'PATCH', `/api/guilds/${s.guildId}`, { name: 'Başka' });
    await m.settle();
    expect(m.events).toEqual([]);
  });

  it('kanal silinince yalnızca onu görenler haber alır', async () => {
    const member = await s.member('uye');
    const hidden = (await s.req(s.owner.token, 'POST', `/api/guilds/${s.guildId}/channels`, { name: 'gizli', type: 'text' })).json() as Channel;
    await hideChannel(hidden);
    const m = await connect(member.token);
    const o = await connect(s.owner.token);
    await s.req(s.owner.token, 'DELETE', `/api/channels/${hidden.id}`);
    await m.settle();
    expect(m.of('CHANNEL_DELETE')).toEqual([]);
    expect(o.of('CHANNEL_DELETE')).toEqual([{ id: hidden.id, guildId: s.guildId }]);
  });
});
