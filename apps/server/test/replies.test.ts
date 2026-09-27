import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission as P, REPLY_EXCERPT_LENGTH, type Channel, type Message } from '@diskort/shared';
import { connectGateway, startServer, type TestServer } from './helpers.js';

let s: TestServer;

beforeEach(async () => {
  s = await startServer();
});

afterEach(async () => {
  await s.close();
});

const send = (token: string, channelId: string, body: Record<string, unknown>) =>
  s.req(token, 'POST', `/api/channels/${channelId}/messages`, body);

const list = async (token: string, channelId: string): Promise<Message[]> =>
  (await s.req(token, 'GET', `/api/channels/${channelId}/messages`)).json() as Message[];

describe('yanıtlar', () => {
  it('yanıt asıl mesajın özetini taşır ve asıl yazarı bildirir (varsayılan: @ AÇIK)', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const text = s.channel('text');
    const original = (await send(ali.token, text.id, { content: 'akşam oyun var mı?' })).json() as Message;
    const notify = vi.spyOn(s.ctx.push, 'notifyMention');

    const res = await send(veli.token, text.id, { content: 'bence var', replyToId: original.id });
    expect(res.statusCode).toBe(201);
    const reply = res.json() as Message;
    expect(reply).toMatchObject({
      replyToId: original.id,
      replyMentionUserId: ali.user.id,
      referencedMessage: { id: original.id, authorId: ali.user.id, content: 'akşam oyun var mı?', hasAttachments: false },
    });
    // Asıl yazar için bahsetme: okunmamış sayacı ve telefon bildirimi
    expect(s.ctx.store.mentionCounts(ali.user.id)).toEqual({ [text.id]: 1 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: reply.id }), [ali.user.id], text.name);

    // Listede de aynı özet; yanıt olmayan mesajlarda alanlar boş
    const [first, second] = await list(veli.token, text.id);
    expect(first).toMatchObject({ replyToId: null, referencedMessage: null, replyMentionUserId: null });
    expect(second!.referencedMessage).toEqual(reply.referencedMessage);
  });

  it('@ KAPALI yanıt ve kendi mesajına yanıt kimseyi bildirmez', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const text = s.channel('text');
    const original = (await send(ali.token, text.id, { content: 'selam' })).json() as Message;

    const quiet = (await send(veli.token, text.id, { content: 'sessiz', replyToId: original.id, replyMention: false })).json();
    expect(quiet).toMatchObject({ replyToId: original.id, replyMentionUserId: null });
    const own = (await send(ali.token, text.id, { content: 'kendime', replyToId: original.id })).json();
    expect(own).toMatchObject({ replyToId: original.id, replyMentionUserId: null });
    expect(s.ctx.store.mentionCounts(ali.user.id)).toEqual({});
    expect(s.ctx.store.mentionCounts(veli.user.id)).toEqual({});
  });

  it('metinde de bahsedilen asıl yazar bir kez sayılır', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const text = s.channel('text');
    const original = (await send(ali.token, text.id, { content: 'selam' })).json() as Message;
    await send(veli.token, text.id, { content: '@ali aynen', replyToId: original.id });
    expect(s.ctx.store.mentionCounts(ali.user.id)).toEqual({ [text.id]: 1 });
  });

  it('asıl mesaj aynı kanalda ve duruyor olmalı; göremediği kanaldaki mesaja yanıt verilemez', async () => {
    const ali = await s.member('ali');
    const text = s.channel('text');
    const other = (await s.req(s.owner.token, 'POST', '/api/channels', { name: 'diger', type: 'text' })).json() as Channel;
    const elsewhere = (await send(s.owner.token, other.id, { content: 'başka kanal' })).json() as Message;

    for (const replyToId of [elsewhere.id, '999999']) {
      const res = await send(ali.token, text.id, { content: 'x', replyToId });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_reply');
    }
    expect((await send(ali.token, text.id, { content: 'x', replyToId: 'abc' })).statusCode).toBe(400);

    // Gizli kanaldaki mesaj: kanala yazamaz (404), kendi kanalından da ona yanıt veremez (400, varlığı sızmaz)
    await s.req(s.owner.token, 'PATCH', `/api/channels/${other.id}`, {
      overwrites: [{ roleId: s.ctx.guild.id, allow: 0, deny: P.VIEW_CHANNEL }],
    });
    expect((await send(ali.token, other.id, { content: 'x', replyToId: elsewhere.id })).statusCode).toBe(404);
    expect((await send(ali.token, text.id, { content: 'x', replyToId: elsewhere.id })).statusCode).toBe(400);

    // Yazma izni olmayan kanalda yanıt da yok
    const original = (await send(s.owner.token, text.id, { content: 'duyuru' })).json() as Message;
    await s.req(s.owner.token, 'PATCH', `/api/channels/${text.id}`, {
      overwrites: [{ roleId: s.ctx.guild.id, allow: 0, deny: P.SEND_MESSAGES }],
    });
    expect((await send(ali.token, text.id, { content: 'x', replyToId: original.id })).statusCode).toBe(403);
  });

  it('özet her okumada asıl mesajdan üretilir: düzenleme yansır, silinince yanıt "silindi" olarak kalır', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const text = s.channel('text');
    const original = (await send(ali.token, text.id, { content: 'ilk hâli' })).json() as Message;
    const reply = (await send(veli.token, text.id, { content: 'cevap', replyToId: original.id })).json() as Message;

    await s.req(ali.token, 'PATCH', `/api/messages/${original.id}`, { content: 'düzenlenmiş' });
    let after = (await list(veli.token, text.id)).find((m) => m.id === reply.id)!;
    expect(after.referencedMessage?.content).toBe('düzenlenmiş');

    // Yanıtın kendisi düzenlenince de yanıt bilgisi korunur
    const edited = (await s.req(veli.token, 'PATCH', `/api/messages/${reply.id}`, { content: 'cevap 2' })).json();
    expect(edited).toMatchObject({ replyToId: original.id, referencedMessage: { content: 'düzenlenmiş' } });

    expect((await s.req(ali.token, 'DELETE', `/api/messages/${original.id}`)).statusCode).toBe(204);
    after = (await list(veli.token, text.id)).find((m) => m.id === reply.id)!;
    expect(after).toMatchObject({ replyToId: original.id, referencedMessage: null, replyMentionUserId: ali.user.id });
    // Silinmiş mesaja yeni yanıt verilemez
    expect((await send(veli.token, text.id, { content: 'geç kaldım', replyToId: original.id })).statusCode).toBe(400);
  });

  it('özet kısaltılır; yalnızca dosyalı mesajda boş metin ve ek bilgisi', async () => {
    const ali = await s.member('ali');
    const text = s.channel('text');
    const long = (await send(ali.token, text.id, { content: 'ç'.repeat(1500) })).json() as Message;
    const r1 = (await send(s.owner.token, text.id, { content: 'uzun', replyToId: long.id })).json() as Message;
    expect(r1.referencedMessage!.content).toBe('ç'.repeat(REPLY_EXCERPT_LENGTH));

    s.ctx.store.createAttachment({
      id: 'a'.repeat(32),
      channelId: text.id,
      uploaderId: ali.user.id,
      name: 'resim.png',
      size: 10,
      contentType: 'image/png',
      width: 1,
      height: 1,
    });
    const file = s.ctx.store.createMessage(text.id, ali.user.id, '', ['a'.repeat(32)])!;
    const r2 = (await send(s.owner.token, text.id, { content: 'güzel', replyToId: file.id })).json() as Message;
    expect(r2.referencedMessage).toEqual({ id: file.id, authorId: ali.user.id, content: '', hasAttachments: true });
  });

  it('eski istemciler: yanıt alanı olmadan (ya da null) gönderilen mesaj normal mesajdır', async () => {
    const text = s.channel('text');
    const plain = (await send(s.owner.token, text.id, { content: 'eski' })).json();
    expect(plain).toMatchObject({ replyToId: null, referencedMessage: null, replyMentionUserId: null });
    expect((await send(s.owner.token, text.id, { content: 'null', replyToId: null })).statusCode).toBe(201);
  });

  it('yanıt gateway üzerinden özetiyle gelir', async () => {
    const ali = await s.member('ali');
    const text = s.channel('text');
    const original = (await send(ali.token, text.id, { content: 'soru' })).json() as Message;
    await s.app.listen({ port: 0, host: '127.0.0.1' });
    const gw = await connectGateway(s.app, ali.token);
    try {
      await send(s.owner.token, text.id, { content: 'yanıt', replyToId: original.id });
      await gw.settle();
      const [created] = gw.of('MESSAGE_CREATE');
      expect(created).toMatchObject({
        replyToId: original.id,
        replyMentionUserId: ali.user.id,
        referencedMessage: { id: original.id, content: 'soru' },
      });
    } finally {
      gw.ws.close();
    }
  });
});
