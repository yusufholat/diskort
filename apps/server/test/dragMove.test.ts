import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Permission as P, type Channel, type GuildData } from '@diskort/shared';
import { connectGateway, startServer, type TestServer } from './helpers.js';

// Sürükle-bırak ile taşıma ve kanal sıralama: sunucudaki yetki denetimleri

let s: TestServer;

beforeEach(async () => {
  s = await startServer();
});

afterEach(async () => {
  await s.close();
});

const voiceChannels = (): Channel[] => s.ctx.store.listChannels(s.guildId).filter((c) => c.type === 'voice');
const moveReq = (token: string, userId: string, channelId: string | null, guildId = s.guildId) =>
  s.req(token, 'PATCH', `/api/guilds/${guildId}/members/${userId}/voice`, { channelId });

describe('seste taşıma yetkileri', () => {
  it('hedef kanal aynı sunucuda, ses kanalı ve taşıyanın görebildiği bir kanal olmalı', async () => {
    const member = await s.member('uye');
    const mover = await s.member('tasiyici');
    const role = await s.createRole(s.owner.token, { name: 'DJ', permissions: P.MOVE_MEMBERS });
    await s.giveRole(s.owner.token, mover.user.id, role.id);
    const [a, b] = voiceChannels();
    s.ctx.voice.join(member.user.id, a!.id);

    // Başka sunucunun ses kanalı
    const other = (await s.req(mover.token, 'POST', '/api/guilds', { name: 'Diger' })).json() as GuildData;
    const otherVoice = other.channels.find((c) => c.type === 'voice')!;
    expect((await moveReq(mover.token, member.user.id, otherVoice.id)).statusCode).toBe(404);
    // Kendi sunucusunda olmayan üyeyi taşıyamaz (üye diğer sunucuda değil)
    expect((await moveReq(mover.token, member.user.id, otherVoice.id, other.guild.id)).statusCode).toBe(404);

    // Metin kanalına taşınamaz
    expect((await moveReq(mover.token, member.user.id, s.channel('text').id)).statusCode).toBe(404);

    // Taşıyanın göremediği kanal yok sayılır (üye görebilse bile)
    await s.req(s.owner.token, 'PATCH', `/api/channels/${b!.id}`, {
      overwrites: [{ roleId: role.id, allow: 0, deny: P.VIEW_CHANNEL }],
    });
    expect((await moveReq(mover.token, member.user.id, b!.id)).statusCode).toBe(404);

    // Hedefte taşıma yetkisi yoksa olmaz
    await s.req(s.owner.token, 'PATCH', `/api/channels/${b!.id}`, {
      overwrites: [{ roleId: role.id, allow: 0, deny: P.MOVE_MEMBERS }],
    });
    expect((await moveReq(mover.token, member.user.id, b!.id)).statusCode).toBe(403);

    await s.req(s.owner.token, 'PATCH', `/api/channels/${b!.id}`, { overwrites: [] });
    expect((await moveReq(mover.token, member.user.id, b!.id)).statusCode).toBe(204);
  });

  it('yetkisiz üye başkasını taşıyamaz; kendinden üstteki rolü taşıyamaz; taşıma VOICE_MOVE gönderir', async () => {
    const low = await s.member('alt');
    const high = await s.member('ust');
    // Yeni rol en alta eklenir: önce üstteki
    const highRole = await s.createRole(s.owner.token, { name: 'Ust', permissions: P.MOVE_MEMBERS });
    const lowRole = await s.createRole(s.owner.token, { name: 'Alt', permissions: P.MOVE_MEMBERS });
    await s.giveRole(s.owner.token, low.user.id, lowRole.id);
    await s.giveRole(s.owner.token, high.user.id, highRole.id);
    const [a, b] = voiceChannels();
    s.ctx.voice.join(low.user.id, a!.id);
    s.ctx.voice.join(high.user.id, a!.id);

    const plain = await s.member('sade');
    expect((await moveReq(plain.token, low.user.id, b!.id)).statusCode).toBe(403);
    // Discord gibi: seste taşımada rol hiyerarşisine bakılmaz (alt rol de üsttekini taşıyabilir)
    expect((await moveReq(low.token, high.user.id, b!.id)).statusCode).toBe(204);

    await s.app.listen({ port: 0, host: '127.0.0.1' });
    const client = await connectGateway(s.app, low.token);
    expect((await moveReq(high.token, low.user.id, b!.id)).statusCode).toBe(204);
    await client.settle();
    expect(client.of('VOICE_MOVE')).toEqual([{ channelId: b!.id }]);
    client.ws.close();
  });
});

describe('kanal sıralama', () => {
  const order = (token: string, channelIds: string[]) =>
    s.req(token, 'PUT', `/api/guilds/${s.guildId}/channels/order`, { channelIds });
  const ids = (): string[] => s.ctx.store.listChannels(s.guildId).map((c) => c.id);

  it('KANALLARI_YÖNET ister, tüm görünen kanallar birer kez olmalı; sıra kaydedilir ve yayınlanır', async () => {
    const extra = (await s.req(s.owner.token, 'POST', `/api/guilds/${s.guildId}/channels`, { name: 'ek', type: 'text' })).json() as Channel;
    const start = ids();
    expect(start.at(-1)).toBe(extra.id);
    const reversed = [...start].reverse();

    const member = await s.member('uye');
    expect((await order(member.token, reversed)).statusCode).toBe(403);
    // Değişiklik yoksa yetki gerekmez
    expect((await order(member.token, start)).statusCode).toBe(200);

    expect((await order(s.owner.token, reversed.slice(1))).statusCode).toBe(400);
    expect((await order(s.owner.token, [...reversed, reversed[0]!])).statusCode).toBe(400);
    expect((await order(s.owner.token, [...reversed.slice(1), 'yok'])).statusCode).toBe(400);

    await s.app.listen({ port: 0, host: '127.0.0.1' });
    const client = await connectGateway(s.app, member.token);
    const res = await order(s.owner.token, reversed);
    expect(res.statusCode).toBe(200);
    expect((res.json() as Channel[]).map((c) => c.id)).toEqual(reversed);
    expect(ids()).toEqual(reversed);
    expect(s.ctx.store.listChannels(s.guildId).map((c) => c.position)).toEqual(reversed.map((_, i) => i));
    await client.settle();
    const updates = client.of('CHANNEL_UPDATE') as Channel[];
    expect(updates.find((c) => c.id === extra.id)?.position).toBe(0);
    client.ws.close();
  });

  it('görünmeyen kanallar yerini korur ve sıralamaya yazılamaz', async () => {
    const manager = await s.member('yonetici');
    const role = await s.createRole(s.owner.token, { name: 'Kanalci', permissions: P.MANAGE_CHANNELS });
    await s.giveRole(s.owner.token, manager.user.id, role.id);
    const hidden = (await s.req(s.owner.token, 'POST', `/api/guilds/${s.guildId}/channels`, { name: 'gizli', type: 'text' })).json() as Channel;
    await s.req(s.owner.token, 'POST', `/api/guilds/${s.guildId}/channels`, { name: 'son', type: 'text' });
    await s.req(s.owner.token, 'PATCH', `/api/channels/${hidden.id}`, {
      overwrites: [{ roleId: s.guildId, allow: 0, deny: P.VIEW_CHANNEL }],
    });
    const all = ids();
    const hiddenIndex = all.indexOf(hidden.id);
    const visible = all.filter((id) => id !== hidden.id);

    // Gizli kanalı içeren sıralama geçersiz (görebildiklerinden fazlası)
    expect((await order(manager.token, [...all].reverse())).statusCode).toBe(400);

    const res = await order(manager.token, [...visible].reverse());
    expect(res.statusCode).toBe(200);
    const after = ids();
    expect(after.indexOf(hidden.id)).toBe(hiddenIndex);
    expect(after.filter((id) => id !== hidden.id)).toEqual([...visible].reverse());

  });
});
