import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_FEATURE_DM,
  DM_GROUP_MAX_PARTICIPANTS,
  type DmChannel,
  type Message,
} from '@diskort/shared';
import { connectGateway, type Account, type GatewayClient, type TestServer, startServer } from './helpers.js';

let s: TestServer;
let dir: string;
const clients: GatewayClient[] = [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-dm-'));
  s = await startServer({ attachmentsDir: dir });
  await s.app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** DM'leri tanıyan (yeni) istemci; `legacy` ise özellik bildirmeyen eski istemci */
const connect = async (token: string, legacy = false): Promise<GatewayClient> => {
  const client = await connectGateway(s.app, token, legacy ? undefined : [CLIENT_FEATURE_DM]);
  clients.push(client);
  return client;
};

const openDm = async (from: Account, ...to: Account[]): Promise<DmChannel> => {
  const res = await s.req(from.token, 'POST', '/api/dms', { userIds: to.map((a) => a.user.id) });
  expect([200, 201]).toContain(res.statusCode);
  return res.json() as DmChannel;
};

const send = async (from: Account, channelId: string, content: string): Promise<Message> => {
  const res = await s.req(from.token, 'POST', `/api/channels/${channelId}/messages`, { content });
  expect(res.statusCode).toBe(201);
  return res.json() as Message;
};

/** Konuşma ve mesaj olayları (çevrimiçi durumu gibi diğerleri hariç) */
const chatEvents = (c: GatewayClient) =>
  c.events.filter((e) => e.t.startsWith('DM_') || e.t.startsWith('MESSAGE') || e.t === 'TYPING_START');

/** Yüklemeyi ham gövdeyle yapar (tarayıcıdaki gibi) */
const upload = (token: string, channelId: string) =>
  s.app.inject({
    method: 'POST',
    url: `/api/channels/${channelId}/attachments?name=not.txt`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
    payload: 'merhaba',
  });

describe('direkt mesajlar', () => {
  it('aynı iki kişi için tek bire bir konuşma; kendine ve üye olmayana açılamaz', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');

    const first = await s.req(ali.token, 'POST', '/api/dms', { userIds: [veli.user.id] });
    expect(first.statusCode).toBe(201);
    const dm = first.json() as DmChannel;
    expect(dm).toMatchObject({ group: false, name: null, ownerId: null, lastMessageId: null });
    expect([...dm.participantIds].sort()).toEqual([ali.user.id, veli.user.id].sort());

    const again = await s.req(ali.token, 'POST', '/api/dms', { userIds: [veli.user.id, ali.user.id] });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(dm.id);
    // Karşı taraftan açınca da aynı konuşma
    const other = await s.req(veli.token, 'POST', '/api/dms', { userIds: [ali.user.id] });
    expect(other.json().id).toBe(dm.id);

    expect((await s.req(ali.token, 'POST', '/api/dms', { userIds: [ali.user.id] })).statusCode).toBe(400);
    expect((await s.req(ali.token, 'POST', '/api/dms', { userIds: ['yok-boyle-biri'] })).statusCode).toBe(404);
    expect((await s.req(ali.token, 'POST', '/api/dms', { userIds: [] })).statusCode).toBe(400);

    // DM'ler topluluğun kanal listesinde yoktur
    const channels = (await s.req(s.owner.token, 'GET', '/api/channels')).json() as { id: string }[];
    expect(channels.map((c) => c.id)).not.toContain(dm.id);
  });

  it('yalnızca katılımcılar okur ve yazar; sahip/yönetici hiçbir yoldan erişemez', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const dm = await openDm(ali, veli);
    const message = await send(ali, dm.id, 'gizli konuşma');
    await s.req(veli.token, 'PUT', `/api/messages/${message.id}/reactions/👍`);

    // Katılımcı
    const read = await s.req(veli.token, 'GET', `/api/channels/${dm.id}/messages`);
    expect(read.statusCode).toBe(200);
    expect(read.json().map((m: Message) => m.content)).toEqual(['gizli konuşma']);
    expect((await upload(veli.token, dm.id)).statusCode).toBe(201);

    // Sahip (ADMINISTRATOR) ve başka bir üye: konuşma yokmuş gibi
    const meddler = await s.member('merakli');
    for (const outsider of [s.owner, meddler]) {
      const t = outsider.token;
      expect((await s.req(t, 'GET', `/api/channels/${dm.id}/messages`)).statusCode).toBe(404);
      expect((await s.req(t, 'POST', `/api/channels/${dm.id}/messages`, { content: 'selam' })).statusCode).toBe(404);
      expect((await s.req(t, 'POST', `/api/channels/${dm.id}/ack`, { messageId: message.id })).statusCode).toBe(404);
      expect((await s.req(t, 'PATCH', `/api/messages/${message.id}`, { content: 'x' })).statusCode).toBe(404);
      expect((await s.req(t, 'DELETE', `/api/messages/${message.id}`)).statusCode).toBe(404);
      expect((await s.req(t, 'PUT', `/api/messages/${message.id}/reactions/👍`)).statusCode).toBe(404);
      expect((await s.req(t, 'DELETE', `/api/messages/${message.id}/reactions/👍`)).statusCode).toBe(404);
      expect((await upload(t, dm.id)).statusCode).toBe(404);
      expect((await s.req(t, 'PATCH', `/api/dms/${dm.id}`, { name: 'x' })).statusCode).toBe(404);
      expect((await s.req(t, 'DELETE', `/api/dms/${dm.id}`)).statusCode).toBe(404);
      expect((await s.req(t, 'GET', '/api/dms')).json()).toEqual([]);
      // Kanal yönetimi ve ses DM'lere ulaşamaz
      expect((await s.req(t, 'PATCH', `/api/channels/${dm.id}`, { name: 'ele-gecirildi' })).statusCode).toBe(404);
      expect((await s.req(t, 'DELETE', `/api/channels/${dm.id}`)).statusCode).toBe(404);
      expect((await s.req(t, 'POST', `/api/voice/${dm.id}/join`)).statusCode).toBe(404);
    }
    expect(s.ctx.store.getDm(dm.id)).not.toBeNull();

    // Katılımcı başkasının mesajını silemez (DM'de mesaj yönetme yetkisi yok), kendisininkini siler
    expect((await s.req(veli.token, 'DELETE', `/api/messages/${message.id}`)).statusCode).toBe(403);
    expect((await s.req(ali.token, 'DELETE', `/api/messages/${message.id}`)).statusCode).toBe(204);
  });

  it('gateway: DM olayları yalnızca katılımcıların DM tanıyan istemcilerine gider; READY ayrı alanda taşır', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const dm = await openDm(ali, veli);
    await send(ali, dm.id, 'ilk');

    const a = await connect(ali.token);
    const v = await connect(veli.token);
    const vOld = await connect(veli.token, true);
    const owner = await connect(s.owner.token);

    // READY: DM kanal listesinde değil, ayrı alanda; okunmamış bilgisi ortak haritalarda
    expect(v.ready.channels.map((c) => c.id)).not.toContain(dm.id);
    expect(v.ready.dms?.map((d) => d.id)).toEqual([dm.id]);
    expect(v.ready.dms?.[0]?.lastMessageId).toBe(v.ready.lastMessageIds[dm.id]);
    expect(v.ready.mentionCounts[dm.id]).toBe(1);
    expect(a.ready.readStates[dm.id]).toBe(a.ready.lastMessageIds[dm.id]);
    // Eski istemci ve katılımcı olmayan hiçbir DM bilgisi almaz
    expect(vOld.ready.dms).toBeUndefined();
    expect(vOld.ready.lastMessageIds[dm.id]).toBeUndefined();
    expect(vOld.ready.mentionCounts[dm.id]).toBeUndefined();
    expect(owner.ready.dms).toEqual([]);
    expect(owner.ready.lastMessageIds[dm.id]).toBeUndefined();

    a.ws.send(JSON.stringify({ t: 'TYPING_START', d: { channelId: dm.id } }));
    await a.settle();
    const m = await send(ali, dm.id, 'ikinci');
    await s.req(veli.token, 'PUT', `/api/messages/${m.id}/reactions/🎉`);
    await s.req(ali.token, 'PATCH', `/api/messages/${m.id}`, { content: 'ikinci (düzeltildi)' });
    await s.req(ali.token, 'DELETE', `/api/messages/${m.id}`);
    await v.settle();

    expect(chatEvents(v).map((e) => e.t)).toEqual([
      'TYPING_START',
      'MESSAGE_CREATE',
      'MESSAGE_REACTION_ADD',
      'MESSAGE_UPDATE',
      'MESSAGE_DELETE',
    ]);
    expect(a.of('MESSAGE_REACTION_ADD')).toHaveLength(1);
    for (const outsider of [vOld, owner]) expect(chatEvents(outsider)).toEqual([]);
  });

  it('boş konuşma karşı tarafta ilk mesajla görünür; kapatılan konuşma yeni mesajla yeniden açılır', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const a = await connect(ali.token);
    const v = await connect(veli.token);

    const dm = await openDm(ali, veli);
    await v.settle();
    expect(a.of('DM_CHANNEL_CREATE').map((d) => d.id)).toEqual([dm.id]);
    expect(chatEvents(v)).toEqual([]);
    expect((await s.req(veli.token, 'GET', '/api/dms')).json()).toEqual([]);

    await send(ali, dm.id, 'selam');
    await v.settle();
    // Konuşma mesajdan önce gelir
    expect(chatEvents(v).map((e) => e.t)).toEqual(['DM_CHANNEL_CREATE', 'MESSAGE_CREATE']);
    expect(v.of('DM_CHANNEL_CREATE')[0]?.lastMessageId).toBe(v.of('MESSAGE_CREATE')[0]?.id);

    // Veli kapatır: yalnızca kendi listesinden kalkar
    expect((await s.req(veli.token, 'DELETE', `/api/dms/${dm.id}`)).statusCode).toBe(204);
    await v.settle();
    expect(v.of('DM_CHANNEL_DELETE')).toEqual([{ id: dm.id }]);
    expect(a.of('DM_CHANNEL_DELETE')).toEqual([]);
    expect((await s.req(veli.token, 'GET', '/api/dms')).json()).toEqual([]);
    // Kapalıyken de geçmişi okuyabilir (tekrar açınca aynı konuşma)
    expect((await s.req(veli.token, 'GET', `/api/channels/${dm.id}/messages`)).statusCode).toBe(200);

    v.events.length = 0;
    await send(ali, dm.id, 'orada mısın?');
    await v.settle();
    expect(chatEvents(v).map((e) => e.t)).toEqual(['DM_CHANNEL_CREATE', 'MESSAGE_CREATE']);
    expect((await s.req(veli.token, 'GET', '/api/dms')).json().map((d: DmChannel) => d.id)).toEqual([dm.id]);
  });

  it('DM mesajları karşı tarafın okunmamış sayısını artırır; okuyunca sıfırlanır', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const dm = await openDm(ali, veli);
    await send(ali, dm.id, 'bir');
    const last = await send(ali, dm.id, 'iki');
    expect(s.ctx.store.mentionCounts(veli.user.id)[dm.id]).toBe(2);
    expect(s.ctx.store.mentionCounts(ali.user.id)[dm.id]).toBeUndefined();
    expect((await s.req(veli.token, 'POST', `/api/channels/${dm.id}/ack`, { messageId: last.id })).statusCode).toBe(204);
    expect(s.ctx.store.mentionCounts(veli.user.id)[dm.id]).toBeUndefined();
    expect(s.ctx.store.listDms(veli.user.id)[0]).toMatchObject({ lastMessageId: last.id, lastActivityAt: last.createdAt });
  });

  it('grup: herkese görünür, ad değişir, kişi eklenir, ayrılınca sahiplik geçer, son kişi ayrılınca silinir', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const ayse = await s.member('ayse');
    const fatma = await s.member('fatma');
    const a = await connect(ali.token);
    const v = await connect(veli.token);
    const f = await connect(fatma.token);

    const res = await s.req(ali.token, 'POST', '/api/dms', { userIds: [veli.user.id, ayse.user.id], name: ' Hafta sonu ' });
    expect(res.statusCode).toBe(201);
    const group = res.json() as DmChannel;
    expect(group).toMatchObject({ group: true, name: 'Hafta sonu', ownerId: ali.user.id });
    expect(group.participantIds).toHaveLength(3);
    // Aynı kişilerle yeni grup ayrı bir konuşmadır
    const second = await s.req(ali.token, 'POST', '/api/dms', { userIds: [veli.user.id, ayse.user.id] });
    expect(second.json().id).not.toBe(group.id);
    await v.settle();
    expect(v.of('DM_CHANNEL_CREATE').map((d) => d.id)).toContain(group.id);
    expect(chatEvents(f)).toEqual([]);

    expect((await s.req(veli.token, 'PATCH', `/api/dms/${group.id}`, { name: 'Maç' })).json().name).toBe('Maç');
    await a.settle();
    expect(a.of('DM_CHANNEL_UPDATE').at(-1)?.name).toBe('Maç');

    // Kişi ekleme: eklenen konuşmayı ve geçmişi görür
    await send(veli, group.id, 'fatma da gelsin');
    const added = await s.req(veli.token, 'PUT', `/api/dms/${group.id}/participants/${fatma.user.id}`);
    expect(added.statusCode).toBe(200);
    await f.settle();
    expect(f.of('DM_CHANNEL_CREATE').map((d) => d.id)).toEqual([group.id]);
    expect((await s.req(fatma.token, 'GET', `/api/channels/${group.id}/messages`)).json()).toHaveLength(1);
    // Bire bir konuşmaya kişi eklenemez
    const direct = await openDm(ali, veli);
    expect((await s.req(ali.token, 'PUT', `/api/dms/${direct.id}/participants/${fatma.user.id}`)).statusCode).toBe(400);
    expect((await s.req(ali.token, 'PATCH', `/api/dms/${direct.id}`, { name: 'x' })).statusCode).toBe(400);

    // Sahip ayrılır: sıradaki katılımcıya geçer, kalanlar güncel hâlini alır
    expect((await s.req(ali.token, 'DELETE', `/api/dms/${group.id}`)).statusCode).toBe(204);
    await v.settle();
    expect(a.of('DM_CHANNEL_DELETE')).toEqual([{ id: group.id }]);
    const after = v.of('DM_CHANNEL_UPDATE').at(-1)!;
    expect(after.participantIds).not.toContain(ali.user.id);
    expect(after.ownerId).toBe(veli.user.id);
    expect((await s.req(ali.token, 'GET', `/api/channels/${group.id}/messages`)).statusCode).toBe(404);

    for (const member of [veli, ayse, fatma]) {
      expect((await s.req(member.token, 'DELETE', `/api/dms/${group.id}`)).statusCode).toBe(204);
    }
    expect(s.ctx.store.getDm(group.id)).toBeNull();
    expect(s.ctx.store.listMessages(group.id, null, 50)).toEqual([]);
  });

  it(`grup en fazla ${DM_GROUP_MAX_PARTICIPANTS} kişidir`, async () => {
    const others: Account[] = [];
    for (let i = 0; i < DM_GROUP_MAX_PARTICIPANTS; i++) others.push(await s.member(`kisi${i}`));
    const tooMany = await s.req(s.owner.token, 'POST', '/api/dms', { userIds: others.map((o) => o.user.id) });
    expect(tooMany.statusCode).toBe(400);
    const full = (
      await s.req(s.owner.token, 'POST', '/api/dms', { userIds: others.slice(1).map((o) => o.user.id) })
    ).json() as DmChannel;
    expect(full.participantIds).toHaveLength(DM_GROUP_MAX_PARTICIPANTS);
    const res = await s.req(s.owner.token, 'PUT', `/api/dms/${full.id}/participants/${others[0]!.user.id}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('group_full');
  });

  it('atılan üye: bağlanamaz; karşı taraf geçmişi okur ama yazamaz; geri dönünce konuşma kaldığı yerden sürer', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const ayse = await s.member('ayse');
    const dm = await openDm(ali, veli);
    await send(veli, dm.id, 'görüşürüz');
    const group = (
      await s.req(ali.token, 'POST', '/api/dms', { userIds: [veli.user.id, ayse.user.id] })
    ).json() as DmChannel;

    expect((await s.req(s.owner.token, 'POST', `/api/users/${veli.user.id}/kick`)).statusCode).toBe(204);
    // Atılanın oturumu geçersiz
    expect((await s.req(veli.token, 'GET', `/api/channels/${dm.id}/messages`)).statusCode).toBe(401);
    // Karşı taraf: mesajlar durur, yeni mesaj ve dosya yok, yeni konuşma açılamaz
    const history = await s.req(ali.token, 'GET', `/api/channels/${dm.id}/messages`);
    expect(history.json().map((m: Message) => m.content)).toEqual(['görüşürüz']);
    expect(history.json()[0].authorId).toBe(veli.user.id);
    expect((await s.req(ali.token, 'POST', `/api/channels/${dm.id}/messages`, { content: 'hey' })).statusCode).toBe(403);
    expect((await upload(ali.token, dm.id)).statusCode).toBe(403);
    expect((await s.req(ali.token, 'POST', '/api/dms', { userIds: [veli.user.id] })).statusCode).toBe(404);
    // Grupta diğerleri yazmaya devam eder; atılan okunmamış sayısı almaz
    await send(ali, group.id, 'biz devam');
    expect(s.ctx.store.mentionCounts(ayse.user.id)[group.id]).toBe(1);
    expect(s.ctx.store.mentionCounts(veli.user.id)[group.id]).toBeUndefined();
    // Yönetici atılanın konuşmalarına da erişemez
    expect((await s.req(s.owner.token, 'GET', `/api/channels/${dm.id}/messages`)).statusCode).toBe(404);

    // Yeni davetle geri döner: konuşmaları yerinde
    const code = (await s.req(s.owner.token, 'POST', '/api/invites', {})).json().code as string;
    const back = await s.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: code, username: 'veli', password: 'sifre12345' },
    });
    expect(back.statusCode).toBe(201);
    const veliAgain = back.json() as Account;
    expect((await s.req(veliAgain.token, 'GET', '/api/dms')).json().map((d: DmChannel) => d.id).sort()).toEqual(
      [dm.id, group.id].sort(),
    );
    expect((await s.req(ali.token, 'POST', `/api/channels/${dm.id}/messages`, { content: 'hoş geldin' })).statusCode).toBe(
      201,
    );
  });

  it('hesap silinince konuşmadan düşer; kimse kalmayan konuşma silinir', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const dm = await openDm(ali, veli);
    await send(ali, dm.id, 'selam');
    const a = await connect(ali.token);

    expect((await s.req(s.owner.token, 'DELETE', `/api/users/${veli.user.id}`)).statusCode).toBe(204);
    await a.settle();
    expect(a.of('DM_CHANNEL_UPDATE').at(-1)?.participantIds).toEqual([ali.user.id]);
    // Geçmiş okunur, yazılamaz
    expect((await s.req(ali.token, 'GET', `/api/channels/${dm.id}/messages`)).statusCode).toBe(200);
    expect((await s.req(ali.token, 'POST', `/api/channels/${dm.id}/messages`, { content: 'x' })).statusCode).toBe(403);

    expect((await s.req(s.owner.token, 'DELETE', `/api/users/${ali.user.id}`)).statusCode).toBe(204);
    expect(s.ctx.store.getDm(dm.id)).toBeNull();
    expect(s.ctx.store.listMessages(dm.id, null, 50)).toEqual([]);
  });

  it('telefon bildirimi: her DM mesajı yazar dışındaki üye katılımcılara gider', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const ayse = await s.member('ayse');
    const calls: { kind: string; recipients: string[]; channelId: string }[] = [];
    s.ctx.push.notifyDm = async (message, recipients) => {
      calls.push({ kind: 'dm', recipients, channelId: message.channelId });
    };
    s.ctx.push.notifyMention = async (message, recipients) => {
      calls.push({ kind: 'mention', recipients, channelId: message.channelId });
    };

    const dm = await openDm(ali, veli);
    await send(ali, dm.id, 'bahsetmesiz mesaj');
    await send(ali, dm.id, '@veli bahsetmeli de olsa tek bildirim');
    const group = (
      await s.req(ali.token, 'POST', '/api/dms', { userIds: [veli.user.id, ayse.user.id] })
    ).json() as DmChannel;
    await send(veli, group.id, 'gruba');
    await s.req(s.owner.token, 'POST', `/api/users/${ayse.user.id}/kick`);
    await send(veli, group.id, 'ayşe atıldı');
    // Topluluk kanalında bahsetme eski yoldan gider
    await send(ali, s.channel('text').id, '@veli genelde');

    expect(calls).toEqual([
      { kind: 'dm', recipients: [veli.user.id], channelId: dm.id },
      { kind: 'dm', recipients: [veli.user.id], channelId: dm.id },
      { kind: 'dm', recipients: [ali.user.id, ayse.user.id], channelId: group.id },
      { kind: 'dm', recipients: [ali.user.id], channelId: group.id },
      { kind: 'mention', recipients: [veli.user.id], channelId: s.channel('text').id },
    ]);
  });
});
