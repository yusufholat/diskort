import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { decodeJwt } from 'jose';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { PushService } from '../src/push.js';

const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: '.' });

function serviceAccountFile(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dir = mkdtempSync(join(tmpdir(), 'diskort-fcm-'));
  const file = join(dir, 'fcm.json');
  writeFileSync(
    file,
    JSON.stringify({
      project_id: 'diskort-test',
      client_email: 'fcm@diskort-test.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      token_uri: 'https://oauth2.test/token',
    }),
  );
  return file;
}

/** Google'ın erişim jetonu ve FCM uçlarını taklit eder; istekleri kaydeder. */
function fakeGoogle(fcmStatus = 200, fcmBody = '{}') {
  const requests: { url: string; body: string; auth?: string }[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    requests.push({
      url: u,
      body: String(init?.body ?? ''),
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    });
    if (u === 'https://oauth2.test/token') {
      return new Response(JSON.stringify({ access_token: 'erisim-jetonu', expires_in: 3600 }), { status: 200 });
    }
    return new Response(fcmBody, { status: fcmStatus });
  }) as typeof fetch;
  return { fn, requests };
}

let app: FastifyInstance | undefined;
let ctx: AppContext;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function start(google: ReturnType<typeof fakeGoogle>) {
  const built = await buildApp(config, { dbFile: ':memory:', logger: false });
  app = built.app;
  ctx = built.ctx;
  // Sahte Google ile çalışan bildirim servisi (testler doğrudan çağırır)
  const push = new PushService(ctx.store, serviceAccountFile(), { warn: () => undefined, info: () => undefined }, google.fn);

  const bootstrap = ctx.store.ensureBootstrapInvite()!;
  const admin = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: bootstrap.code, username: 'ayse', password: 'sifre12345' },
    })
  ).json() as { token: string; user: { id: string } };
  const code = (await app.inject({ method: 'POST', url: '/api/invites', headers: auth(admin.token), payload: {} })).json()
    .code as string;
  const member = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { inviteCode: code, username: 'mehmet', password: 'sifre12345', displayName: 'Mehmet' },
    })
  ).json() as { token: string; user: { id: string } };
  const text = ctx.store.listChannels(ctx.guild.id).find((c) => c.type === 'text')!;
  return { admin, member, text, push };
}

describe('telefon bildirimleri', () => {
  it('cihaz jetonu kaydedilir, başka hesaba taşınır ve silinir', async () => {
    const { admin, member } = await start(fakeGoogle());
    const save = (token: string) =>
      app!.inject({
        method: 'POST',
        url: '/api/me/push-tokens',
        headers: auth(token),
        payload: { token: 'cihaz-jetonu-123456', platform: 'android' },
      });
    expect((await save(member.token)).statusCode).toBe(204);
    expect(ctx.store.pushTokens([member.user.id])).toHaveLength(1);
    // Aynı telefonda başka hesapla giriş: jeton yeni hesaba geçer
    await save(admin.token);
    expect(ctx.store.pushTokens([member.user.id])).toHaveLength(0);
    expect(ctx.store.pushTokens([admin.user.id])).toHaveLength(1);

    const del = await app!.inject({
      method: 'DELETE',
      url: '/api/me/push-tokens',
      headers: auth(admin.token),
      payload: { token: 'cihaz-jetonu-123456' },
    });
    expect(del.statusCode).toBe(204);
    expect(ctx.store.pushTokens([admin.user.id])).toHaveLength(0);
  });

  it('bahsedilen kullanıcının telefonuna FCM ile bildirim gider', async () => {
    const google = fakeGoogle();
    const { admin, member, text, push } = await start(google);
    ctx.store.savePushToken(member.user.id, 'mehmetin-telefonu', 'android');
    const message = ctx.store.createMessage(text.id, admin.user.id, '@mehmet bakar mısın?');
    await push.notifyMention(message, ctx.store.resolveMentions(message.content, admin.user.id), text.name);

    const token = google.requests.find((r) => r.url === 'https://oauth2.test/token')!;
    const assertion = decodeJwt(new URLSearchParams(token.body).get('assertion')!);
    expect(assertion).toMatchObject({
      iss: 'fcm@diskort-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    });

    const send = google.requests.find((r) => r.url.includes('fcm.googleapis.com'))!;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/diskort-test/messages:send');
    expect(send.auth).toBe('Bearer erisim-jetonu');
    const body = JSON.parse(send.body) as { message: Record<string, any> };
    expect(body.message.token).toBe('mehmetin-telefonu');
    expect(body.message.notification.body).toBe('@Mehmet bakar mısın?');
    expect(body.message.data).toEqual({ type: 'mention', channelId: text.id, messageId: message.id });
    expect(body.message.android.notification.channel_id).toBe('diskort-mentions');
  });

  it('uygulama kaldırılmışsa (UNREGISTERED) jeton silinir; erişim jetonu önbelleklenir', async () => {
    const google = fakeGoogle(404, '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}');
    const { admin, member, text, push } = await start(google);
    ctx.store.savePushToken(member.user.id, 'eski-telefon-jetonu', 'android');
    const m1 = ctx.store.createMessage(text.id, admin.user.id, '@mehmet bir');
    await push.notifyMention(m1, [member.user.id], text.name);
    expect(ctx.store.pushTokens([member.user.id])).toHaveLength(0);

    ctx.store.savePushToken(member.user.id, 'yeni-telefon-jetonu', 'android');
    await push.notifyMention(m1, [member.user.id], text.name);
    expect(google.requests.filter((r) => r.url === 'https://oauth2.test/token')).toHaveLength(1);
  });

  it('hizmet hesabı yoksa hiçbir şey gönderilmez', async () => {
    const google = fakeGoogle();
    const built = await buildApp(config, { dbFile: ':memory:', logger: false });
    app = built.app;
    const push = new PushService(built.ctx.store, null, { warn: () => undefined, info: () => undefined }, google.fn);
    expect(push.enabled).toBe(false);
    await push.notifyMention(
      { id: '1', channelId: 'c', authorId: null, content: '@x', createdAt: 0, editedAt: null, reactions: [] },
      ['u'],
      'genel',
    );
    expect(google.requests).toHaveLength(0);
  });
});
