import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Permission as P } from '@diskort/shared';
import { TrackSource } from '../src/livekit.js';
import { startServer, type TestServer } from './helpers.js';

let s: TestServer;

beforeEach(async () => {
  s = await startServer();
});

afterEach(async () => {
  await s.close();
});

const login = (username: string, password = 'sifre12345') =>
  s.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });

const register = async (username: string, password = 'sifre12345') => {
  const code = (await s.req(s.owner.token, 'POST', '/api/invites', {})).json().code as string;
  return s.app.inject({ method: 'POST', url: '/api/auth/register', payload: { inviteCode: code, username, password } });
};

/** Oturum jetonları saniye hassasiyetinde: atma anı ile yeni jeton aynı saniyeye düşmesin */
const nextSecond = () => new Promise((r) => setTimeout(r, 1100 - (Date.now() % 1000)));

describe('atma ve yasaklama', () => {
  it('atılan üyenin oturumu kapanır; yeni davetle kendi şifresiyle geri döner (roller gelmez)', async () => {
    const member = await s.member('uye');
    const role = await s.createRole(s.owner.token, { name: 'Oyuncu' });
    await s.giveRole(s.owner.token, member.user.id, role.id);
    const text = s.channel('text');
    await s.req(member.token, 'POST', `/api/channels/${text.id}/messages`, { content: 'merhaba' });

    expect((await s.req(member.token, 'POST', `/api/users/${s.owner.user.id}/kick`)).statusCode).toBe(403);
    expect((await s.req(s.owner.token, 'POST', `/api/users/${member.user.id}/kick`)).statusCode).toBe(204);
    expect((await s.req(member.token, 'GET', '/api/me')).statusCode).toBe(401);
    const kicked = s.ctx.store.getUser(member.user.id)!;
    expect(kicked).toMatchObject({ removed: true, roles: [] });
    // Mesajı adıyla kalır
    expect(s.ctx.store.listMessages(text.id, null, 10).at(-1)!.authorId).toBe(member.user.id);

    const denied = await login('uye');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe('kicked');
    // Yanlış şifreyle ne olduğu anlaşılmaz
    expect((await login('uye', 'yanlis-sifre')).statusCode).toBe(401);
    expect((await register('uye', 'yanlis-sifre')).statusCode).toBe(409);

    await nextSecond();
    const back = await register('uye');
    expect(back.statusCode).toBe(201);
    expect(back.json().user).toMatchObject({ id: member.user.id, removed: false, roles: [] });
    expect((await s.req(back.json().token, 'GET', '/api/me')).statusCode).toBe(200);
  });

  it('yasaklanan geri dönemez ve giriş yapamaz; yasak kalkınca davetle döner', async () => {
    const member = await s.member('uye');
    const mod = await s.member('mod');
    const modRole = await s.createRole(s.owner.token, { name: 'Mod', permissions: P.BAN_MEMBERS });
    await s.giveRole(s.owner.token, mod.user.id, modRole.id);

    expect((await s.req(mod.token, 'POST', `/api/users/${s.owner.user.id}/ban`, {})).statusCode).toBe(403);
    expect((await s.req(mod.token, 'POST', `/api/users/${member.user.id}/ban`, { reason: 'spam' })).statusCode).toBe(204);
    expect((await login('uye')).json().error).toBe('banned');
    const again = await register('uye');
    expect(again.statusCode).toBe(403);
    expect(again.json().error).toBe('banned');

    const bans = (await s.req(mod.token, 'GET', '/api/bans')).json();
    expect(bans).toEqual([expect.objectContaining({ reason: 'spam', user: expect.objectContaining({ id: member.user.id }) })]);
    expect((await s.req(member.token, 'GET', '/api/bans')).statusCode).toBe(401);

    expect((await s.req(mod.token, 'DELETE', `/api/bans/${member.user.id}`)).statusCode).toBe(204);
    expect((await login('uye')).json().error).toBe('kicked');
    await nextSecond();
    expect((await register('uye')).statusCode).toBe(201);
  });

  it('atılan üye seste ise sesten çıkarılır; bahsedilemez', async () => {
    const member = await s.member('uye');
    const voice = s.channel('voice');
    s.ctx.voice.join(member.user.id, voice.id);
    await s.req(s.owner.token, 'POST', `/api/users/${member.user.id}/kick`);
    expect(s.ctx.voice.get(member.user.id)).toBeUndefined();
    expect(s.livekit.of('removeParticipant')).toContainEqual([voice.id, member.user.id]);
    expect(s.ctx.store.resolveMentions('@uye', s.owner.user.id)).toEqual([]);
  });
});

describe('seste yönetim', () => {
  it('sunucuda susturma: mikrofon susturulur, izni alınır, durum herkese görünür ve yeniden katılınca sürer', async () => {
    const member = await s.member('uye');
    const voice = s.channel('voice');
    s.ctx.voice.join(member.user.id, voice.id);

    // Yetkisiz üye susturamaz
    expect((await s.req(member.token, 'PATCH', `/api/users/${s.owner.user.id}/voice`, { mute: true })).statusCode).toBe(403);

    expect((await s.req(s.owner.token, 'PATCH', `/api/users/${member.user.id}/voice`, { mute: true })).statusCode).toBe(204);
    expect(s.ctx.voice.get(member.user.id)).toMatchObject({ serverMute: true, serverDeaf: false });
    expect(s.livekit.of('muteMicrophone')).toEqual([[voice.id, member.user.id]]);
    expect(s.livekit.of('setPublishSources').at(-1)).toEqual([
      voice.id,
      member.user.id,
      [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    ]);
    // Yeni jetonda da mikrofon yok
    expect(s.ctx.moderation.sources(member.user.id, voice.id)).not.toContain(TrackSource.MICROPHONE);

    // Kanaldan çıkıp girince sürer; veritabanında da saklı
    s.ctx.voice.leave(member.user.id, voice.id);
    s.ctx.voice.join(member.user.id, voice.id);
    expect(s.ctx.voice.get(member.user.id)!.serverMute).toBe(true);
    expect(s.ctx.store.serverVoiceFlags().get(member.user.id)).toEqual({ serverMute: true, serverDeaf: false });

    await s.req(s.owner.token, 'PATCH', `/api/users/${member.user.id}/voice`, { mute: false, deaf: true });
    expect(s.ctx.voice.get(member.user.id)).toMatchObject({ serverMute: false, serverDeaf: true });
    await s.req(s.owner.token, 'PATCH', `/api/users/${member.user.id}/voice`, { deaf: false });
    expect(s.livekit.of('setPublishSources').at(-1)![2]).toContain(TrackSource.MICROPHONE);
  });

  it('taşıma ve sesten çıkarma MOVE_MEMBERS ister; hedef kanala bağlanamayan taşınamaz', async () => {
    const member = await s.member('uye');
    const mover = await s.member('tasiyici');
    const [a, b] = s.ctx.store.listChannels(s.ctx.guild.id).filter((c) => c.type === 'voice');
    s.ctx.voice.join(member.user.id, a!.id);

    expect((await s.req(mover.token, 'PATCH', `/api/users/${member.user.id}/voice`, { channelId: b!.id })).statusCode).toBe(
      403,
    );
    const role = await s.createRole(s.owner.token, { name: 'DJ', permissions: P.MOVE_MEMBERS });
    await s.giveRole(s.owner.token, mover.user.id, role.id);
    expect((await s.req(mover.token, 'PATCH', `/api/users/${member.user.id}/voice`, { channelId: b!.id })).statusCode).toBe(
      204,
    );
    expect(s.livekit.of('moveParticipant')).toEqual([[a!.id, member.user.id, b!.id]]);
    expect(s.ctx.voice.get(member.user.id)!.channelId).toBe(b!.id);

    // Üye A kanalına bağlanamıyorsa oraya taşınamaz
    await s.req(s.owner.token, 'PATCH', `/api/channels/${a!.id}`, {
      overwrites: [{ roleId: s.ctx.guild.id, allow: 0, deny: P.CONNECT }, { roleId: role.id, allow: P.CONNECT, deny: 0 }],
    });
    const blocked = await s.req(mover.token, 'PATCH', `/api/users/${member.user.id}/voice`, { channelId: a!.id });
    expect(blocked.statusCode).toBe(403);

    // Sesten çıkarma; eski istemcilerin yolu da çalışır
    expect((await s.req(mover.token, 'PATCH', `/api/users/${member.user.id}/voice`, { channelId: null })).statusCode).toBe(
      204,
    );
    expect(s.ctx.voice.get(member.user.id)).toBeUndefined();
    s.ctx.voice.join(member.user.id, b!.id);
    expect((await s.req(mover.token, 'POST', `/api/users/${member.user.id}/voice-kick`)).statusCode).toBe(204);
    expect(s.ctx.voice.get(member.user.id)).toBeUndefined();
    // Hiyerarşi: sahibi taşıyamaz
    s.ctx.voice.join(s.owner.user.id, b!.id);
    expect((await s.req(mover.token, 'PATCH', `/api/users/${s.owner.user.id}/voice`, { channelId: null })).statusCode).toBe(
      403,
    );
  });

  it('yetkiler değişince seste olanların izinleri güncellenir, bağlanma yetkisini kaybeden çıkarılır', async () => {
    const member = await s.member('uye');
    const voice = s.channel('voice');
    s.ctx.voice.join(member.user.id, voice.id);
    s.livekit.calls = [];

    await s.req(s.owner.token, 'PATCH', `/api/channels/${voice.id}`, {
      overwrites: [{ roleId: s.ctx.guild.id, allow: 0, deny: P.SPEAK }],
    });
    expect(s.livekit.of('setPublishSources')).toContainEqual([
      voice.id,
      member.user.id,
      [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    ]);

    await s.req(s.owner.token, 'PATCH', `/api/channels/${voice.id}`, {
      overwrites: [{ roleId: s.ctx.guild.id, allow: 0, deny: P.CONNECT }],
    });
    expect(s.livekit.of('removeParticipant')).toContainEqual([voice.id, member.user.id]);
    expect(s.ctx.voice.get(member.user.id)).toBeUndefined();
    // Sahip etkilenmez
    expect(s.ctx.moderation.canConnect(s.owner.user.id, voice.id)).toBe(true);
  });
});
