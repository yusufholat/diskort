import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Permission as P,
  parseSearchQuery,
  searchSnippet,
  type Channel,
  type DmChannel,
  type GuildData,
  type Message,
  type SearchResponse,
} from '@diskort/shared';
import { MIGRATIONS, Store } from '../src/db.js';
import { ftsMatch } from '../src/routes/search.js';
import { startServer, type Account, type TestServer } from './helpers.js';

let s: TestServer;

beforeEach(async () => {
  s = await startServer();
});

afterEach(async () => {
  await s.close();
});

const send = async (from: Account, channelId: string, content: string): Promise<Message> => {
  const res = await s.req(from.token, 'POST', `/api/channels/${channelId}/messages`, { content });
  expect(res.statusCode).toBe(201);
  return res.json() as Message;
};

const search = async (account: Account, params: Record<string, string>) => {
  const res = await s.req(account.token, 'GET', `/api/search?${new URLSearchParams(params).toString()}`);
  return { status: res.statusCode, body: res.json() as SearchResponse };
};

/** Aramada bulunan mesajların metinleri (yeniden eskiye) */
const found = async (account: Account, params: Record<string, string>): Promise<string[]> => {
  const r = await search(account, params);
  expect(r.status).toBe(200);
  return r.body.results.map((x) => x.message.content);
};

describe('arama sorgusu çözümleme', () => {
  it('işleçleri, tırnaklı ifadeleri ve Türkçe yazımları ayırır', () => {
    const p = parseSearchQuery('from:@ali in:#genel-sohbet has:resim içerir:bağlantı "tam ifade" kitap önce:01.02.2026 sonra:2026-01-01 kimden:"Veli Can"');
    expect(p.from).toEqual(['ali', 'Veli Can']);
    expect(p.in).toEqual(['genel-sohbet']);
    expect(p.has).toEqual(['image', 'link']);
    expect(p.before).toBe('01.02.2026');
    expect(p.after).toBe('2026-01-01');
    expect(p.words).toEqual([
      { text: 'tam ifade', phrase: true },
      { text: 'kitap', phrase: false },
    ]);
    expect(ftsMatch(p.words)).toBe('"tam ifade" "kitap"*');
    // Bilinmeyen işleç ve tek harf: metin, tek harfte önek yok
    expect(ftsMatch(parseSearchQuery('saat:12 a').words)).toBe('"saat 12"* "a"');
  });

  it('özet eşleşmeyi vurgular (büyük/küçük harf, ı/i, aksan duyarsız)', () => {
    const snip = searchSnippet('Işık ve ÇİÇEK kitaplar', ['isik', 'cicek', 'kitap']);
    expect(snip.highlights.map(([a, b]) => snip.text.slice(a, b))).toEqual(['Işık', 'ÇİÇEK', 'kitaplar']);
    const long = `${'a '.repeat(200)}hedef sözcük ${'b '.repeat(200)}`;
    const cut = searchSnippet(long, ['hedef']);
    expect(cut.text.startsWith('…')).toBe(true);
    expect(cut.text.endsWith('…')).toBe(true);
    const [[a, b]] = cut.highlights as [[number, number]];
    expect(cut.text.slice(a, b)).toBe('hedef');
  });
});

describe('GET /api/search', () => {
  it('metin araması: Türkçe harfler, önek, düzenleme ve silme dizine yansır', async () => {
    const text = s.channel('text');
    const alice = await s.member('alice');
    await send(alice, text.id, 'Işıklar söndü mü?');
    await send(alice, text.id, 'İstanbul çok güzel');
    const kitap = await send(s.owner, text.id, 'Yeni kitaplar geldi');
    await send(s.owner, text.id, 'alakasız mesaj');

    expect(await found(s.owner, { guildId: s.guildId, q: 'isik' })).toEqual(['Işıklar söndü mü?']);
    expect(await found(s.owner, { guildId: s.guildId, q: 'ISIKLAR' })).toEqual(['Işıklar söndü mü?']);
    expect(await found(s.owner, { guildId: s.guildId, q: 'istanbul guzel' })).toEqual(['İstanbul çok güzel']);
    expect(await found(s.owner, { guildId: s.guildId, q: 'kitap' })).toEqual(['Yeni kitaplar geldi']);
    expect(await found(s.owner, { guildId: s.guildId, q: '"kitap"' })).toEqual([]);

    const r = await search(s.owner, { guildId: s.guildId, q: 'kitap' });
    expect(r.body.total).toBe(1);
    expect(r.body.results[0]!.channel).toEqual({ id: text.id, name: text.name, guildId: s.guildId });
    expect(r.body.results[0]!.snippet).toEqual({ text: 'Yeni kitaplar geldi', highlights: [[5, 13]] });
    expect(r.body.users.map((u) => u.id)).toEqual([s.owner.user.id]);

    // Düzenleme ve silme
    expect((await s.req(s.owner.token, 'PATCH', `/api/messages/${kitap.id}`, { content: 'Yeni dergiler geldi' })).statusCode).toBe(200);
    expect(await found(s.owner, { guildId: s.guildId, q: 'kitap' })).toEqual([]);
    expect(await found(s.owner, { guildId: s.guildId, q: 'dergi' })).toEqual(['Yeni dergiler geldi']);
    expect((await s.req(s.owner.token, 'DELETE', `/api/messages/${kitap.id}`)).statusCode).toBe(204);
    expect(await found(s.owner, { guildId: s.guildId, q: 'dergi' })).toEqual([]);
  });

  it('işleçler: from:, in:, has:, tarih; parametreler ve sayfalama', async () => {
    const text = s.channel('text');
    const alice = await s.member('alice');
    const other = (await s.req(s.owner.token, 'POST', `/api/guilds/${s.guildId}/channels`, { name: 'duyurular', type: 'text' })).json() as Channel;
    await send(alice, text.id, 'selam herkese');
    await send(s.owner, text.id, 'selam alice https://example.com');
    await send(s.owner, other.id, 'selam duyuru');

    expect(await found(s.owner, { guildId: s.guildId, q: 'selam from:alice' })).toEqual(['selam herkese']);
    expect(await found(s.owner, { guildId: s.guildId, q: 'from:ALİCE' })).toEqual(['selam herkese']);
    expect(await found(s.owner, { guildId: s.guildId, q: 'selam', authorId: alice.user.id })).toEqual(['selam herkese']);
    expect(await found(s.owner, { guildId: s.guildId, q: 'selam from:yok' })).toEqual([]);
    expect(await found(s.owner, { guildId: s.guildId, q: 'selam in:#duyurular' })).toEqual(['selam duyuru']);
    expect(await found(s.owner, { guildId: s.guildId, q: 'selam', channelId: other.id })).toEqual(['selam duyuru']);
    expect(await found(s.owner, { channelId: other.id, q: 'selam' })).toEqual(['selam duyuru']);
    expect(await found(s.owner, { guildId: s.guildId, q: 'has:bağlantı' })).toEqual(['selam alice https://example.com']);
    expect(await found(s.owner, { guildId: s.guildId, q: 'selam', has: 'link' })).toEqual(['selam alice https://example.com']);
    expect(await found(s.owner, { guildId: s.guildId, q: 'has:dosya' })).toEqual([]);
    // Tarihler (bugün hepsi var): önce:bugün boş, sonra:dün hepsi, tarih:bugün hepsi
    expect(await found(s.owner, { guildId: s.guildId, q: 'selam önce:bugün' })).toEqual([]);
    expect(await found(s.owner, { guildId: s.guildId, q: 'selam sonra:dün' })).toHaveLength(3);
    expect(await found(s.owner, { guildId: s.guildId, q: 'selam tarih:bugün' })).toHaveLength(3);
    expect((await search(s.owner, { guildId: s.guildId, q: 'selam önce:32.13.2026' })).status).toBe(400);
  });

  it('sayfalama ve geçersiz aramalar', async () => {
    const text = s.channel('text');
    const other = (await s.req(s.owner.token, 'POST', `/api/guilds/${s.guildId}/channels`, { name: 'duyurular', type: 'text' })).json() as Channel;
    await send(s.owner, text.id, 'selam herkese');
    await send(s.owner, text.id, 'selam alice https://example.com');
    await send(s.owner, other.id, 'selam duyuru');
    // Sayfalama: yeniden eskiye, imleçle devam
    const first = await search(s.owner, { guildId: s.guildId, q: 'selam', limit: '2' });
    expect(first.body.total).toBe(3);
    expect(first.body.results.map((x) => x.message.content)).toEqual(['selam duyuru', 'selam alice https://example.com']);
    expect(first.body.nextCursor).toBe(first.body.results[1]!.message.id);
    const second = await search(s.owner, { guildId: s.guildId, q: 'selam', limit: '2', cursor: first.body.nextCursor! });
    expect(second.body.results.map((x) => x.message.content)).toEqual(['selam herkese']);
    expect(second.body.nextCursor).toBeNull();

    // Boş arama ve bozuk parametre
    expect((await search(s.owner, { guildId: s.guildId, q: '  ' })).status).toBe(400);
    expect((await search(s.owner, { guildId: s.guildId, q: 'x', has: 'hepsi' })).status).toBe(400);
  });

  it('yalnızca görülebilen kanallar: özel kanal, başka sunucu', async () => {
    const text = s.channel('text');
    const alice = await s.member('alice');
    const secret = (await s.req(s.owner.token, 'POST', `/api/guilds/${s.guildId}/channels`, { name: 'gizli', type: 'text' })).json() as Channel;
    const deny = await s.req(s.owner.token, 'PATCH', `/api/channels/${secret.id}`, {
      overwrites: [{ roleId: s.guildId, allow: 0, deny: P.VIEW_CHANNEL }],
    });
    expect(deny.statusCode).toBe(200);
    await send(s.owner, secret.id, 'parola gizlidir');
    await send(s.owner, text.id, 'parola açıktır');

    // Sahip ikisini de görür; alice özel kanalı göremez (ne kapsamla ne kanal kimliğiyle)
    expect(await found(s.owner, { guildId: s.guildId, q: 'parola' })).toHaveLength(2);
    expect(await found(alice, { guildId: s.guildId, q: 'parola' })).toEqual(['parola açıktır']);
    expect((await search(alice, { guildId: s.guildId, channelId: secret.id, q: 'parola' })).status).toBe(404);
    expect((await search(alice, { channelId: secret.id, q: 'parola' })).status).toBe(404);
    expect(await found(alice, { guildId: s.guildId, q: 'parola in:gizli' })).toEqual([]);

    // Başka sunucu: bob'un sunucusunu sahip aratamaz; bob da ana sunucuyu
    const bob = await s.member('bob');
    const b = (await s.req(bob.token, 'POST', '/api/guilds', { name: 'B' })).json() as GuildData;
    const bText = b.channels.find((c) => c.type === 'text')!;
    await send(bob, bText.id, 'parola B sunucusunda');
    expect((await search(alice, { guildId: b.guild.id, q: 'parola' })).status).toBe(404);
    expect((await search(alice, { channelId: bText.id, q: 'parola' })).status).toBe(404);
    expect(await found(bob, { guildId: b.guild.id, q: 'parola' })).toEqual(['parola B sunucusunda']);
    // Ana sunucuda bob, B'nin mesajını görmez
    expect(await found(bob, { guildId: s.guildId, q: 'parola' })).toEqual(['parola açıktır']);
    // Sunucudan atılınca ana sunucu aranamaz
    expect((await s.req(s.owner.token, 'DELETE', `/api/guilds/${s.guildId}/members/${bob.user.id}`)).statusCode).toBe(204);
    expect((await search(bob, { guildId: s.guildId, q: 'parola' })).status).toBe(404);
  });

  it('direkt mesajlar: yalnızca katılımcılar; gruptan ayrılan arayamaz', async () => {
    const alice = await s.member('alice');
    const bob = await s.member('bob');
    const dm = (await s.req(s.owner.token, 'POST', '/api/dms', { userIds: [alice.user.id, bob.user.id] })).json() as DmChannel;
    await send(alice, dm.id, 'grupta gizli plan');
    await send(s.owner, s.channel('text').id, 'kanalda plan');

    expect(await found(bob, { dmId: dm.id, q: 'plan' })).toEqual(['grupta gizli plan']);
    expect(await found(bob, { channelId: dm.id, q: 'plan' })).toEqual(['grupta gizli plan']);
    const r = await search(bob, { dmId: dm.id, q: 'plan' });
    expect(r.body.results[0]!.channel).toEqual({ id: dm.id, name: '', guildId: null });
    // Sunucu araması DM'yi içermez
    expect(await found(bob, { guildId: s.guildId, q: 'plan' })).toEqual(['kanalda plan']);
    // Katılımcı olmayan
    const carol = await s.member('carol');
    expect((await search(carol, { dmId: dm.id, q: 'plan' })).status).toBe(404);
    expect((await search(carol, { channelId: dm.id, q: 'plan' })).status).toBe(404);
    // Sunucu ve konuşma birlikte olmaz
    expect((await search(bob, { dmId: dm.id, guildId: s.guildId, q: 'plan' })).status).toBe(400);
    // Gruptan ayrılan
    expect((await s.req(bob.token, 'DELETE', `/api/dms/${dm.id}`)).statusCode).toBe(204);
    expect((await search(bob, { dmId: dm.id, q: 'plan' })).status).toBe(404);
  });

  it('istek sınırı', async () => {
    await send(s.owner, s.channel('text').id, 'x');
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await search(s.owner, { guildId: s.guildId, q: 'x' })).status);
    expect(statuses.slice(0, 20).every((st) => st === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('kanal silinince mesajları dizinden de çıkar', async () => {
    const extra = (await s.req(s.owner.token, 'POST', `/api/guilds/${s.guildId}/channels`, { name: 'gecici', type: 'text' })).json() as Channel;
    await send(s.owner, extra.id, 'silinecek içerik');
    const count = () => (s.ctx.store.db.prepare(`SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'silinecek'`).get() as { n: number }).n;
    expect(count()).toBe(1);
    expect((await s.req(s.owner.token, 'DELETE', `/api/channels/${extra.id}`)).statusCode).toBe(204);
    expect(count()).toBe(0);
  });
});

describe('göç 19: arama dizini', () => {
  it('var olan mesajları dizinler', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-arama-'));
    try {
      const file = path.join(dir, 'diskort.db');
      const db = new DatabaseSync(file);
      db.exec('PRAGMA foreign_keys = OFF');
      for (const sql of MIGRATIONS.slice(0, 16)) db.exec(sql);
      db.exec('PRAGMA user_version = 16');
      db.exec(`INSERT INTO guilds (id, name, created_at) VALUES ('g1', 'Eski', 1)`);
      db.exec(`INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES ('t1', 'g1', 'genel', 'text', 0, 1)`);
      db.exec(`INSERT INTO messages (channel_id, author_id, content, created_at) VALUES ('t1', NULL, 'Eski mesajda ılık su', 1)`);
      db.close();

      const store = new Store(file);
      try {
        expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
        const found = store.searchMessages({
          channelIds: ['t1'],
          match: ftsMatch(parseSearchQuery('ILIK').words),
          authorIds: null,
          has: [],
          before: null,
          after: null,
          cursor: null,
          limit: 10,
          viewerId: 'x',
        });
        expect(found.messages.map((m) => m.content)).toEqual(['Eski mesajda ılık su']);
      } finally {
        store.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
