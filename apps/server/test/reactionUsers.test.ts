import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Permission as P, type Message, type ReactionUsersPage } from '@diskort/shared';
import { type Account, type TestServer, startServer } from './helpers.js';

let s: TestServer;

beforeEach(async () => {
  s = await startServer();
});

afterEach(async () => {
  await s.close();
});

const url = (messageId: string, emoji: string, query = '') =>
  `/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}${query}`;

const send = async (account: Account, channelId: string, content = 'tepki ver'): Promise<Message> => {
  const res = await s.req(account.token, 'POST', `/api/channels/${channelId}/messages`, { content });
  expect(res.statusCode).toBe(201);
  return res.json() as Message;
};

const react = async (account: Account, messageId: string, emoji: string): Promise<void> => {
  expect((await s.req(account.token, 'PUT', url(messageId, emoji))).statusCode).toBe(204);
};

/** Tepkiler aynı milisaniyeye düşebilir; sırayı sınamak için verilme zamanları elle açılır */
const spreadTimes = (messageId: string, userIds: string[]): void => {
  userIds.forEach((id, i) =>
    s.ctx.store.db
      .prepare('UPDATE reactions SET created_at = ? WHERE message_id = ? AND user_id = ?')
      .run(1_000 + i, Number(messageId), id),
  );
};

const reactors = (account: Account, messageId: string, emoji: string, query = '') =>
  s.req(account.token, 'GET', url(messageId, emoji, query));

describe('tepki verenler', () => {
  it('tepki verme sırasıyla listelenir, profil bilgisiyle gelir ve geri alınan tepki listeden çıkar', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const text = s.channel('text');
    const message = await send(s.owner, text.id);
    await react(veli, message.id, '👍');
    await react(s.owner, message.id, '👍');
    await react(ali, message.id, '👍');
    await react(ali, message.id, '🎉');
    spreadTimes(message.id, [veli.user.id, s.owner.user.id, ali.user.id]);

    const res = await reactors(ali, message.id, '👍');
    expect(res.statusCode).toBe(200);
    const page = res.json() as ReactionUsersPage;
    expect(page.users.map((u) => u.username)).toEqual(['veli', 'sahip', 'ali']);
    expect(page.users[0]).toMatchObject({ id: veli.user.id, displayName: veli.user.displayName });
    expect(page.next).toBeNull();

    expect((await reactors(ali, message.id, '🎉')).json().users.map((u: { id: string }) => u.id)).toEqual([ali.user.id]);
    // Kimsenin vermediği tepki boş liste döner
    expect((await reactors(ali, message.id, '🔥')).json()).toEqual({ users: [], next: null });

    await s.req(s.owner.token, 'DELETE', url(message.id, '👍'));
    expect((await reactors(ali, message.id, '👍')).json().users.map((u: { username: string }) => u.username)).toEqual([
      'veli',
      'ali',
    ]);
  });

  it('sayfalanır; imleç sonraki sayfayı tekrarsız verir', async () => {
    const members = [s.owner];
    for (let i = 0; i < 4; i++) members.push(await s.member(`uye${i}`));
    const message = await send(s.owner, s.channel('text').id);
    for (const m of members) await react(m, message.id, '😂');

    const seen: string[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=2${after ? `&after=${encodeURIComponent(after)}` : ''}`;
      const res = await reactors(s.owner, message.id, '😂', query);
      expect(res.statusCode).toBe(200);
      const page = res.json() as ReactionUsersPage;
      expect(page.users.length).toBeLessThanOrEqual(2);
      seen.push(...page.users.map((u) => u.id));
      after = page.next;
      pages++;
    } while (after && pages < 10);
    expect(pages).toBe(3);
    // Aynı milisaniyedeki tepkiler kullanıcı kimliğine göre sıralanır; hepsi bir kez gelir
    expect([...seen].sort()).toEqual(members.map((m) => m.user.id).sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('geçersiz emoji, sorgu ve oturumsuz istek reddedilir', async () => {
    const message = await send(s.owner, s.channel('text').id);
    const bad = await reactors(s.owner, message.id, 'selam');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_emoji');
    for (const q of ['?limit=0', '?limit=101', '?limit=abc', '?after=xyz', '?after=12']) {
      expect((await reactors(s.owner, message.id, '👍', q)).statusCode).toBe(400);
    }
    expect((await reactors(s.owner, '999999', '👍')).statusCode).toBe(404);
    expect((await reactors(s.owner, 'abc', '👍')).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'GET', url: url(message.id, '👍') })).statusCode).toBe(401);
  });

  it('kanalı göremeyen (özel kanal) listeyi göremez: mesaj yokmuş gibi 404', async () => {
    const ali = await s.member('ali');
    const text = s.channel('text');
    const message = await send(s.owner, text.id);
    await react(s.owner, message.id, '👍');
    expect((await reactors(ali, message.id, '👍')).statusCode).toBe(200);

    const patch = await s.req(s.owner.token, 'PATCH', `/api/channels/${text.id}`, {
      overwrites: [{ roleId: s.guildId, allow: 0, deny: P.VIEW_CHANNEL }],
    });
    expect(patch.statusCode).toBe(200);
    expect((await reactors(ali, message.id, '👍')).statusCode).toBe(404);
    expect((await reactors(s.owner, message.id, '👍')).statusCode).toBe(200);
  });

  it('başka sunucunun ve katılmadığı DM konuşmasının mesajlarındaki tepkiler görülmez', async () => {
    const ali = await s.member('ali');
    // Hesap daveti ile açılan, ana sunucuya katılmayan bob kendi sunucusunu kurar
    const code = (await s.req(s.owner.token, 'POST', '/api/invites', {})).json().code as string;
    const bob = (
      await s.app.inject({ method: 'POST', url: '/api/auth/register', payload: { inviteCode: code, username: 'bob', password: 'sifre12345' } })
    ).json() as Account;
    const guild = (await s.req(bob.token, 'POST', '/api/guilds', { name: 'Bob Grubu' })).json();
    const bobText = guild.channels.find((c: { type: string }) => c.type === 'text');
    const bobMessage = await send(bob, bobText.id);
    await react(bob, bobMessage.id, '👍');
    expect((await reactors(bob, bobMessage.id, '👍')).statusCode).toBe(200);
    expect((await reactors(ali, bobMessage.id, '👍')).statusCode).toBe(404);
    expect((await reactors(s.owner, bobMessage.id, '👍')).statusCode).toBe(404);

    // Sahip ile ali arasındaki DM: yalnızca katılanlar görür
    const veli = await s.member('veli');
    const dm = (await s.req(s.owner.token, 'POST', '/api/dms', { userIds: [ali.user.id] })).json();
    const dmMessage = await send(s.owner, dm.id, 'gizli');
    await react(ali, dmMessage.id, '❤️');
    const res = await reactors(s.owner, dmMessage.id, '❤️');
    expect(res.statusCode).toBe(200);
    expect(res.json().users.map((u: { id: string }) => u.id)).toEqual([ali.user.id]);
    expect((await reactors(veli, dmMessage.id, '❤️')).statusCode).toBe(404);
    expect((await reactors(bob, dmMessage.id, '❤️')).statusCode).toBe(404);
  });
});
