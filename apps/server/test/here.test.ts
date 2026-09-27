import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_FEATURE_DM, mentionsEveryone, mentionsHere, Permission as P, type Message } from '@diskort/shared';
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

/** Çevrimiçi olur (gateway'e bağlanır) */
const online = async (account: Account, features?: string[]): Promise<GatewayClient> => {
  const client = await connectGateway(s.app, account.token, features);
  clients.push(client);
  return client;
};

const post = async (account: Account, channelId: string, content: string): Promise<Message> => {
  const res = await s.req(account.token, 'POST', `/api/channels/${channelId}/messages`, { content });
  expect(res.statusCode).toBe(201);
  return res.json() as Message;
};

const counts = (account: Account): Record<string, number> => s.ctx.store.mentionCounts(account.user.id);

/** @everyone rolünden MENTION_EVERYONE yetkisini alır */
const revokeFromEveryone = async (): Promise<void> => {
  const everyone = s.ctx.store.getRole(s.ctx.guild.id)!;
  const res = await s.req(s.owner.token, 'PATCH', `/api/roles/${everyone.id}`, {
    permissions: everyone.permissions & ~P.MENTION_EVERYONE,
  });
  expect(res.statusCode).toBe(200);
};

describe('@here algılama', () => {
  it('kod içindeki ve sözcüğe yapışık @here/@everyone sayılmaz', () => {
    expect(mentionsHere('@here akşam?')).toBe(true);
    expect(mentionsHere('millet @HERE.')).toBe(true);
    expect(mentionsHere('`@here`')).toBe(false);
    expect(mentionsHere('```\n@here\n```')).toBe(false);
    expect(mentionsHere('```js\nconst x = "@here";\n``` ama burada @here')).toBe(true);
    expect(mentionsHere('mail@here.com @heres')).toBe(false);
    expect(mentionsEveryone('`@everyone` diye yazılır')).toBe(false);
    expect(mentionsEveryone('```@everyone```')).toBe(false);
    expect(mentionsEveryone('@everyone `kod`')).toBe(true);
  });
});

describe('@here bahsetmesi', () => {
  it('yalnızca kanalı gören ve çevrimiçi olanlara gider; yazar ve çevrimdışılar sayılmaz', async () => {
    const author = await s.member('yazar');
    const on = await s.member('acik');
    const off = await s.member('kapali');
    const text = s.channel('text');
    await online(author);
    const listener = await online(on);
    const notify = vi.spyOn(s.ctx.push, 'notifyMention');

    const message = await post(author, text.id, '@here akşam oyun?');
    expect(message).toMatchObject({ mentionHere: true, mentionEveryone: false });
    expect(counts(on)).toEqual({ [text.id]: 1 });
    expect(counts(off)).toEqual({});
    expect(counts(author)).toEqual({});
    // Sahip çevrimdışı
    expect(counts(s.owner)).toEqual({});
    // Telefon bildirimi yalnızca hedeflenenlere
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: message.id }), [on.user.id], text.name);

    // Gateway'den gelen mesaj bayrağı taşır; okunan ve yeniden yüklenen mesajda da kalır
    await listener.settle();
    expect(listener.of('MESSAGE_CREATE').find((m) => m.id === message.id)).toMatchObject({ mentionHere: true });
    const list = (await s.req(off.token, 'GET', `/api/channels/${text.id}/messages`)).json() as Message[];
    expect(list.find((m) => m.id === message.id)).toMatchObject({ mentionHere: true, mentionEveryone: false });
  });

  it('bağlantısı kopan artık çevrimiçi sayılmaz', async () => {
    const author = await s.member('yazar');
    const gone = await s.member('giden');
    const text = s.channel('text');
    const client = await online(gone);
    client.ws.close();
    await vi.waitFor(() => expect(s.ctx.gateway.isOnline(gone.user.id)).toBe(false));

    await post(author, text.id, '@here kimse yok mu');
    expect(counts(gone)).toEqual({});
  });

  it('@everyone ile birlikteyse çevrimdışılar da bahsedilir; adıyla bahsedilen çevrimdışı da sayılır', async () => {
    const author = await s.member('yazar');
    const off = await s.member('kapali');
    const named = await s.member('adli');
    const text = s.channel('text');

    const both = await post(author, text.id, '@everyone @here toplantı');
    expect(both).toMatchObject({ mentionEveryone: true, mentionHere: true });
    expect(counts(off)).toEqual({ [text.id]: 1 });

    const withName = await post(author, text.id, '@here ve @adli');
    expect(withName.mentionHere).toBe(true);
    expect(counts(named)).toEqual({ [text.id]: 2 });
    expect(counts(off)).toEqual({ [text.id]: 1 });
  });

  it('yetkisi olmayan yazarda düz metindir; yetkiyi bir rol verirse çalışır', async () => {
    const author = await s.member('yazar');
    const on = await s.member('acik');
    const text = s.channel('text');
    await online(on);
    await revokeFromEveryone();

    const plain = await post(author, text.id, '@here bakar mısınız');
    expect(plain).toMatchObject({ mentionHere: false, mentionEveryone: false });
    expect(counts(on)).toEqual({});

    // Yetkiler birleşir: @everyone'da kapalı ama rolde açık
    const role = await s.createRole(s.owner.token, { name: 'Duyurucu', permissions: P.MENTION_EVERYONE });
    expect(await s.giveRole(s.owner.token, author.user.id, role.id)).toBe(200);
    const real = await post(author, text.id, '@here şimdi oldu');
    expect(real.mentionHere).toBe(true);
    expect(counts(on)).toEqual({ [text.id]: 1 });

    // Kanal izniyle yalnızca bu kanalda alınabilir
    await s.req(s.owner.token, 'PATCH', `/api/channels/${text.id}`, {
      overwrites: [{ roleId: role.id, allow: 0, deny: P.MENTION_EVERYONE }],
    });
    expect((await post(author, text.id, '@here yine')).mentionHere).toBe(false);
    expect(counts(on)).toEqual({ [text.id]: 1 });
  });

  it('kanalı göremeyen çevrimiçi üye bahsedilmez', async () => {
    const author = await s.member('yazar');
    const insider = await s.member('icerde');
    const outsider = await s.member('disarida');
    const text = s.channel('text');
    const role = await s.createRole(s.owner.token, { name: 'Özel' });
    await s.giveRole(s.owner.token, author.user.id, role.id);
    await s.giveRole(s.owner.token, insider.user.id, role.id);
    await s.req(s.owner.token, 'PATCH', `/api/channels/${text.id}`, {
      overwrites: [
        { roleId: s.ctx.guild.id, allow: 0, deny: P.VIEW_CHANNEL },
        { roleId: role.id, allow: P.VIEW_CHANNEL, deny: 0 },
      ],
    });
    await online(insider);
    await online(outsider);
    const notify = vi.spyOn(s.ctx.push, 'notifyMention');

    const message = await post(author, text.id, '@here gizli toplantı');
    expect(message.mentionHere).toBe(true);
    expect(counts(insider)).toEqual({ [text.id]: 1 });
    expect(counts(outsider)).toEqual({});
    expect(notify).toHaveBeenCalledWith(expect.anything(), [insider.user.id], text.name);
  });

  it('direkt mesajda @here/@everyone yoktur; karşı taraf her mesajda olduğu gibi bildirilir', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const ayse = await s.member('ayse');
    await online(veli, [CLIENT_FEATURE_DM]);
    await online(ayse, [CLIENT_FEATURE_DM]);
    const dm = (await s.req(ali.token, 'POST', '/api/dms', { userIds: [veli.user.id] })).json() as { id: string };

    const message = await post(ali, dm.id, '@here @everyone selam');
    expect(message).toMatchObject({ mentionHere: false, mentionEveryone: false });
    expect(counts(veli)).toEqual({ [dm.id]: 1 });
    // Konuşmada olmayan çevrimiçi üye bahsedilmez
    expect(counts(ayse)).toEqual({});
  });
});
