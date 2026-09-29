import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractMessageUrls,
  Permission as P,
  type Attachment,
  type Channel,
  type ChannelLinkItem,
  type ChannelMediaItem,
  type ChannelPanelPage,
  type DmChannel,
  type Message,
} from '@diskort/shared';
import { startServer, type Account, type TestServer } from './helpers.js';

let s: TestServer;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-panel-'));
  s = await startServer({ attachmentsDir: dir });
});

afterEach(async () => {
  await s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Yalnızca başlığı gerçek olan küçük bir PNG (sunucu resmi çözmez, başlığı okur) */
function png(width = 8, height = 8): Buffer {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const upload = async (who: Account, channelId: string, name: string, body: Buffer, contentType: string): Promise<Attachment> => {
  const res = await s.app.inject({
    method: 'POST',
    url: `/api/channels/${channelId}/attachments?name=${encodeURIComponent(name)}`,
    headers: { authorization: `Bearer ${who.token}`, 'content-type': contentType },
    payload: body,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Attachment;
};

const send = async (who: Account, channelId: string, payload: { content?: string; attachmentIds?: string[] }): Promise<Message> => {
  const res = await s.req(who.token, 'POST', `/api/channels/${channelId}/messages`, payload);
  expect(res.statusCode).toBe(201);
  return res.json() as Message;
};

const media = (who: Account, channelId: string, query = '') => s.req(who.token, 'GET', `/api/channels/${channelId}/media${query}`);
const links = (who: Account, channelId: string, query = '') => s.req(who.token, 'GET', `/api/channels/${channelId}/links${query}`);

describe('kanal paneli: medya', () => {
  it('resim ve videolar yeniden eskiye, dosyalar ve metin mesajları hariç; sayfalı', async () => {
    const text = s.channel('text');
    const a = await upload(s.owner, text.id, 'bir.png', png(), 'image/png');
    const first = await send(s.owner, text.id, { attachmentIds: [a.id] });
    await send(s.owner, text.id, { content: 'yalnızca metin' });
    const doc = await upload(s.owner, text.id, 'not.txt', Buffer.from('merhaba'), 'text/plain');
    await send(s.owner, text.id, { attachmentIds: [doc.id] });
    const b = await upload(s.owner, text.id, 'iki.png', png(), 'image/png');
    const c = await upload(s.owner, text.id, 'uc.png', png(), 'image/png');
    const both = await send(s.owner, text.id, { content: 'iki resim', attachmentIds: [b.id, c.id] });
    // Mesaja eklenmemiş (bekleyen) dosya listelenmez
    await upload(s.owner, text.id, 'bekleyen.png', png(), 'image/png');

    const all = (await media(s.owner, text.id)).json() as ChannelPanelPage<ChannelMediaItem>;
    expect(all.items.map((i) => i.attachment.name)).toEqual(['iki.png', 'uc.png', 'bir.png']);
    expect(all.items[0]).toMatchObject({ messageId: both.id, authorId: s.owner.user.id, createdAt: both.createdAt });
    expect(all.items[0]!.attachment.url).toMatch(/^\/api\/attachments\//);
    expect(all.nextCursor).toBeNull();

    // Sayfa sınırı aynı mesajın dosyalarının arasına düşse de atlama/tekrar yok
    const p1 = (await media(s.owner, text.id, '?limit=1')).json() as ChannelPanelPage<ChannelMediaItem>;
    expect(p1.items.map((i) => i.attachment.name)).toEqual(['iki.png']);
    expect(p1.nextCursor).toBe(`${both.id}_0`);
    const p2 = (await media(s.owner, text.id, `?limit=1&before=${p1.nextCursor}`)).json() as ChannelPanelPage<ChannelMediaItem>;
    expect(p2.items.map((i) => i.attachment.name)).toEqual(['uc.png']);
    const p3 = (await media(s.owner, text.id, `?limit=1&before=${p2.nextCursor}`)).json() as ChannelPanelPage<ChannelMediaItem>;
    expect(p3.items.map((i) => i.messageId)).toEqual([first.id]);
    expect(p3.nextCursor).toBeNull();

    expect((await media(s.owner, text.id, '?before=abc')).statusCode).toBe(400);
    expect((await media(s.owner, text.id, '?limit=1000')).statusCode).toBe(400);
  });

  it('kanalı göremeyen, başka sunucudaki ya da ses kanalı: 404', async () => {
    const text = s.channel('text');
    const alice = await s.member('alice');
    const secret = (await s.req(s.owner.token, 'POST', `/api/guilds/${s.guildId}/channels`, { name: 'gizli', type: 'text' })).json() as Channel;
    const deny = await s.req(s.owner.token, 'PATCH', `/api/channels/${secret.id}`, {
      overwrites: [{ roleId: s.guildId, allow: 0, deny: P.VIEW_CHANNEL }],
    });
    expect(deny.statusCode).toBe(200);
    const a = await upload(s.owner, secret.id, 'gizli.png', png(), 'image/png');
    await send(s.owner, secret.id, { content: 'https://ornek.com/gizli', attachmentIds: [a.id] });

    expect((await media(s.owner, secret.id)).statusCode).toBe(200);
    expect((await media(alice, secret.id)).statusCode).toBe(404);
    expect((await links(alice, secret.id)).statusCode).toBe(404);
    expect((await media(alice, text.id)).statusCode).toBe(200);
    expect((await media(alice, s.channel('voice').id)).statusCode).toBe(404);
    expect((await links(alice, 'yok')).statusCode).toBe(404);
    // Oturumsuz
    expect((await s.app.inject({ method: 'GET', url: `/api/channels/${text.id}/media` })).statusCode).toBe(401);

    // Başka sunucunun kanalı: üye olmayan göremez
    const other = (await s.req(alice.token, 'POST', '/api/guilds', { name: 'Alice sunucusu' })).json() as { guild: { id: string } };
    const otherText = s.ctx.store.listChannels(other.guild.id).find((c) => c.type === 'text')!;
    expect((await media(s.owner, otherText.id)).statusCode).toBe(404);
    expect((await links(s.owner, otherText.id)).statusCode).toBe(404);
  });
});

describe('kanal paneli: bağlantılar', () => {
  it('mesajlardaki bağlantılar, önizleme başlığıyla; kod içindekiler hariç; sayfalı', async () => {
    const text = s.channel('text');
    const old = await send(s.owner, text.id, { content: 'bak https://ornek.com/a ve <https://ornek.com/b>' });
    await send(s.owner, text.id, { content: 'bağlantısız mesaj' });
    await send(s.owner, text.id, { content: '`https://kod.com/x` yazılmış' });
    const fresh = await send(s.owner, text.id, { content: 'yeni: https://ornek.com/c' });
    // Önizleme başlığı mesajın gömülü içeriğinden gelir
    s.ctx.store.setMessageEmbeds(Number(fresh.id), [
      {
        type: 'link',
        kind: 'article',
        url: 'https://ornek.com/c',
        siteName: 'Örnek',
        title: 'Başlık C',
        description: null,
        author: null,
        color: null,
        image: null,
        largeImage: false,
      } as never,
    ]);

    const all = (await links(s.owner, text.id)).json() as ChannelPanelPage<ChannelLinkItem>;
    expect(all.items.map((i) => i.url)).toEqual(['https://ornek.com/c', 'https://ornek.com/a', 'https://ornek.com/b']);
    expect(all.items[0]).toMatchObject({ messageId: fresh.id, title: 'Başlık C', siteName: 'Örnek', authorId: s.owner.user.id });
    expect(all.items[1]).toMatchObject({ messageId: old.id, title: null, siteName: null, createdAt: old.createdAt });
    expect(all.nextCursor).toBeNull();

    // Sayfa mesaj sayısıyla: ilk sayfada yalnızca en yeni mesaj
    const p1 = (await links(s.owner, text.id, '?limit=1')).json() as ChannelPanelPage<ChannelLinkItem>;
    expect(p1.items.map((i) => i.url)).toEqual(['https://ornek.com/c']);
    expect(p1.nextCursor).toBe(fresh.id);
    const rest: string[] = [];
    let cursor: string | null = p1.nextCursor;
    while (cursor) {
      const page = (await links(s.owner, text.id, `?limit=1&before=${cursor}`)).json() as ChannelPanelPage<ChannelLinkItem>;
      rest.push(...page.items.map((i) => i.url));
      cursor = page.nextCursor;
    }
    expect(rest).toEqual(['https://ornek.com/a', 'https://ornek.com/b']);
    expect((await links(s.owner, text.id, '?before=x')).statusCode).toBe(400);
  });

  it('bir istekte sınırlı sayıda mesaj taranır; bağlantısız pencerede boş sayfa ve alt sınır imleci döner', async () => {
    const text = s.channel('text');
    const withLink = await send(s.owner, text.id, { content: 'eski https://ornek.com/eski' });
    const plain: Message[] = [];
    for (let i = 0; i < 5; i++) plain.push(await send(s.owner, text.id, { content: `düz ${i}` }));
    const store = s.ctx.store;

    // Pencere 2 mesaj: en yeni iki düz mesaj taranır, bağlantı yok ama daha eskisi var
    const first = store.listChannelLinks(text.id, null, 30, 2);
    expect(first).toEqual({ items: [], more: true, last: Number(plain[3]!.id) });
    const second = store.listChannelLinks(text.id, first.last, 30, 2);
    expect(second).toEqual({ items: [], more: true, last: Number(plain[1]!.id) });
    const third = store.listChannelLinks(text.id, second.last, 30, 2);
    expect(third.items.map((i) => i.url)).toEqual(['https://ornek.com/eski']);
    expect(third.items[0]!.messageId).toBe(withLink.id);
    expect(third).toMatchObject({ more: true, last: Number(withLink.id) });
    // Pencere dolmadı: sonu
    expect(store.listChannelLinks(text.id, third.last, 30, 2)).toEqual({ items: [], more: false, last: null });
    // Pencere yeterince büyükse tek istekte biter
    expect(store.listChannelLinks(text.id, null, 30, 100)).toMatchObject({ more: false, last: null });

    // HTTP üzerinden: boş sayfa da imleç taşıyabilir; istemci imleç bitene kadar sürer
    const res = (await links(s.owner, text.id)).json() as ChannelPanelPage<ChannelLinkItem>;
    expect(res.items.map((i) => i.url)).toEqual(['https://ornek.com/eski']);
    expect(res.nextCursor).toBeNull();
  });

  it('mesaj başına bağlantı sınırı; <…> biçimindekiler de sayılır', () => {
    expect(extractMessageUrls('<https://a.com/1> https://a.com/2 https://a.com/1')).toEqual(['https://a.com/1', 'https://a.com/2']);
    const many = Array.from({ length: 20 }, (_, i) => `https://a.com/${i}`).join(' ');
    expect(extractMessageUrls(many)).toHaveLength(10);
  });
});

describe('kanal paneli: direkt mesaj', () => {
  it('katılımcılar konuşmanın medyasını ve bağlantılarını görür; diğerleri 404', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const dm = (await s.req(ali.token, 'POST', '/api/dms', { userIds: [veli.user.id] })).json() as DmChannel;
    const a = await upload(ali, dm.id, 'foto.png', png(), 'image/png');
    await send(ali, dm.id, { content: 'https://ornek.com/dm', attachmentIds: [a.id] });

    for (const who of [ali, veli]) {
      const m = (await media(who, dm.id)).json() as ChannelPanelPage<ChannelMediaItem>;
      expect(m.items.map((i) => i.attachment.name)).toEqual(['foto.png']);
      const l = (await links(who, dm.id)).json() as ChannelPanelPage<ChannelLinkItem>;
      expect(l.items.map((i) => i.url)).toEqual(['https://ornek.com/dm']);
    }
    // Sunucu sahibi de başkasının konuşmasını göremez
    expect((await media(s.owner, dm.id)).statusCode).toBe(404);
    expect((await links(s.owner, dm.id)).statusCode).toBe(404);
  });
});
