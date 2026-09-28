import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_FEATURE_DM, type DmChannel, type Message } from '@diskort/shared';
import { connectGateway, type Account, type GatewayClient, type TestServer, startServer } from './helpers.js';

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

const connect = async (token: string, legacy = false): Promise<GatewayClient> => {
  const client = await connectGateway(s.app, token, legacy ? undefined : [CLIENT_FEATURE_DM]);
  clients.push(client);
  return client;
};

const send = async (from: Account, channelId: string, content: string): Promise<Message> => {
  const res = await s.req(from.token, 'POST', `/api/channels/${channelId}/messages`, { content });
  expect(res.statusCode).toBe(201);
  return res.json() as Message;
};

const ack = async (from: Account, channelId: string, messageId: string): Promise<void> => {
  const res = await s.req(from.token, 'POST', `/api/channels/${channelId}/ack`, { messageId });
  expect(res.statusCode).toBe(204);
};

describe('okunma durumu cihazlar arasında (READ_STATE_UPDATE)', () => {
  it('bir cihazda okununca kullanıcının diğer oturumlarına gider, başkalarına gitmez', async () => {
    const text = s.channel('text');
    const mehmet = await s.member('mehmet');
    const phone = await connect(mehmet.token);
    const desktop = await connect(mehmet.token);
    const other = await connect(s.owner.token);

    const first = await send(s.owner, text.id, '@mehmet bir');
    const last = await send(s.owner, text.id, '@mehmet iki');
    await other.settle();
    // Yazan kendi mesajını okumuş sayılır: bu onaylar yalnızca sahibe gider
    expect(other.of('READ_STATE_UPDATE').map((d) => d.lastReadId)).toEqual([first.id, last.id]);
    expect(phone.of('READ_STATE_UPDATE')).toHaveLength(0);

    await ack(mehmet, text.id, last.id);
    await desktop.settle();
    for (const c of [phone, desktop]) {
      expect(c.of('READ_STATE_UPDATE')).toEqual([{ channelId: text.id, lastReadId: last.id, mentionCount: 0 }]);
    }
    // Başka kullanıcıya (sahibe) mehmet'in okunma durumu gitmez
    expect(other.of('READ_STATE_UPDATE')).toHaveLength(2);
  });

  it('okunma ilerlemezse olay gönderilmez; kısmi onayda bahsetme sayısı korunur', async () => {
    const text = s.channel('text');
    const mehmet = await s.member('mehmet');
    const first = await send(s.owner, text.id, '@mehmet bir');
    const last = await send(s.owner, text.id, '@mehmet iki');
    const desktop = await connect(mehmet.token);

    await ack(mehmet, text.id, first.id);
    await ack(mehmet, text.id, first.id); // tekrar: ilerlemez
    await desktop.settle();
    expect(desktop.of('READ_STATE_UPDATE')).toEqual([{ channelId: text.id, lastReadId: first.id, mentionCount: 2 }]);

    await ack(mehmet, text.id, last.id);
    await ack(mehmet, text.id, first.id); // geriye: ilerlemez
    await desktop.settle();
    expect(desktop.of('READ_STATE_UPDATE')).toEqual([
      { channelId: text.id, lastReadId: first.id, mentionCount: 2 },
      { channelId: text.id, lastReadId: last.id, mentionCount: 0 },
    ]);
  });

  it('mesaj göndermek de okundu sayar: diğer cihaza mesajdan sonra gelir (DM)', async () => {
    const mehmet = await s.member('mehmet');
    const res = await s.req(s.owner.token, 'POST', '/api/dms', { userIds: [mehmet.user.id] });
    const dm = res.json() as DmChannel;
    await send(mehmet, dm.id, 'selam');
    const desktop = await connect(s.owner.token);
    const legacy = await connect(s.owner.token, true);
    const partner = await connect(mehmet.token);

    const mine = await send(s.owner, dm.id, 'cevap');
    await desktop.settle();

    const types = desktop.events.map((e) => e.t).filter((t) => t === 'MESSAGE_CREATE' || t === 'READ_STATE_UPDATE');
    expect(types).toEqual(['MESSAGE_CREATE', 'READ_STATE_UPDATE']);
    expect(desktop.of('READ_STATE_UPDATE')).toEqual([{ channelId: dm.id, lastReadId: mine.id, mentionCount: 0 }]);
    // DM'leri tanımayan eski istemciye ve karşı tarafa gitmez
    expect(legacy.of('READ_STATE_UPDATE')).toHaveLength(0);
    expect(partner.of('READ_STATE_UPDATE')).toHaveLength(0);
  });
});
