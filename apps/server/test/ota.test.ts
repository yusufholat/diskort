import { createVerify, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ReleaseService } from '../src/releases.js';

const VERSION = '0.3.0';
const RUNTIME = 'native-0123456789abcdef';
const UPDATE_ID = '1f2e3d4c-0000-4000-8000-000000000001';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const manifest = JSON.stringify({
  id: UPDATE_ID,
  createdAt: '2026-09-27T10:00:00.000Z',
  runtimeVersion: RUNTIME,
  launchAsset: { key: 'abc', contentType: 'application/javascript', url: 'https://ornek/updates/x.bundle' },
  assets: [],
  metadata: {},
  extra: { expoClient: { version: VERSION } },
});
const signature = sign('sha256', Buffer.from(manifest), privateKey).toString('base64');
const otaJson = { platform: 'android', version: VERSION, runtimeVersion: RUNTIME, manifest, signature };
const OTA_URL = `https://github.com/sahip/depo/releases/download/v${VERSION}/Diskort-${VERSION}-ota-android.json`;

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

let otaCalls = 0;
async function start(
  assetNames: string[],
  opts: { env?: Record<string, string>; ota?: unknown; otaUrl?: string } = {},
): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: '.',
    GITHUB_REPO: 'sahip/depo',
    CLIENT_UPDATE_ENFORCE: '1',
    ...opts.env,
  });
  const github = (async () =>
    json({
      tag_name: `v${VERSION}`,
      published_at: '2026-09-27T10:00:00Z',
      assets: assetNames.map((name) => ({
        name,
        size: 1000,
        browser_download_url: `https://github.com/sahip/depo/releases/download/v${VERSION}/${name}`,
      })),
    })) as unknown as typeof fetch;
  otaCalls = 0;
  const otaFetch = (async (url: string) => {
    otaCalls++;
    expect(url).toBe(opts.otaUrl ?? OTA_URL);
    return json(opts.ota ?? otaJson);
  }) as unknown as typeof fetch;
  ({ app } = await buildApp(config, {
    dbFile: ':memory:',
    logger: false,
    releases: new ReleaseService('sahip/depo', github),
    otaFetch,
  }));
  return app;
}

const ask = (server: FastifyInstance, headers: Record<string, string>, platform = 'android') =>
  server.inject({
    method: 'GET',
    url: `/updates/expo/${platform}`,
    headers: { 'expo-protocol-version': '1', 'expo-platform': platform, ...headers },
  });

describe('Android sürüm kuralı', () => {
  const version = async (server: FastifyInstance) =>
    (await server.inject({ method: 'GET', url: '/api/client/version?platform=android' })).json();

  it('OTA varsa arayüz sürümü zorunlu; APK önceki sürümden olabilir', async () => {
    const server = await start([
      'Diskort-0.2.9-android.apk',
      'Diskort-0.2.9-android-arm64-v8a.apk',
      `Diskort-${VERSION}-ota-android.json`,
    ]);
    expect(await version(server)).toEqual({ platform: 'android', latest: '0.2.9', required: VERSION });
  });

  it('OTA yoksa APK sürümü zorunlu; en düşük sürüm ayarının altına inilmez', async () => {
    let server = await start([`Diskort-${VERSION}-android.apk`]);
    expect(await version(server)).toEqual({ platform: 'android', latest: VERSION, required: VERSION });
    await app!.close();
    server = await start([`Diskort-${VERSION}-android.apk`], { env: { MIN_ANDROID_VERSION: '0.4.0' } });
    expect((await version(server)).required).toBe('0.4.0');
  });
});

describe('OTA güncelleme adresi', () => {
  it('yerel kısmı aynı telefona imzalı bildirimi verir', async () => {
    const server = await start([`Diskort-${VERSION}-ota-android.json`]);
    const res = await ask(server, { 'expo-runtime-version': RUNTIME, 'expo-current-update-id': 'gomulu' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['expo-protocol-version']).toBe('1');
    expect(res.headers['expo-sfv-version']).toBe('0');
    expect(res.headers['cache-control']).toBe('private, max-age=0');
    const contentType = String(res.headers['content-type']);
    expect(contentType).toMatch(/^multipart\/mixed; boundary=/);
    const boundary = contentType.split('boundary=')[1]!;

    // Çok parçalı gövde: bildirim (imzalı) + eklentiler
    expect(res.body.endsWith(`--${boundary}--\r\n`)).toBe(true);
    const parts = res.body.split(`--${boundary}`).slice(1, -1);
    expect(parts).toHaveLength(2);
    const [head, body] = parts[0]!.slice(2, -2).split('\r\n\r\n') as [string, string];
    expect(head).toContain('content-disposition: form-data; name="manifest"');
    expect(body).toBe(manifest);
    const sig = /expo-signature: sig="([^"]+)", keyid="main"/.exec(head)?.[1];
    expect(sig).toBe(signature);
    expect(createVerify('RSA-SHA256').update(body).verify(publicKey, sig!, 'base64')).toBe(true);
    expect(parts[1]).toContain('content-disposition: form-data; name="extensions"');
    expect(parts[1]).toContain('{"assetRequestHeaders":{}}');

    // Bildirim bir kez indirilir, sonrakiler önbellekten
    await ask(server, { 'expo-runtime-version': RUNTIME });
    expect(otaCalls).toBe(1);
  });

  it('güncelleme yoksa 204 döner', async () => {
    let server = await start([`Diskort-${VERSION}-ota-android.json`]);
    // zaten bu güncellemede
    const current = await ask(server, { 'expo-runtime-version': RUNTIME, 'expo-current-update-id': UPDATE_ID });
    expect(current.statusCode).toBe(204);
    expect(current.headers['expo-protocol-version']).toBe('1');
    // yerel kısmı farklı: önce yeni APK kurulmalı
    expect((await ask(server, { 'expo-runtime-version': 'native-baska' })).statusCode).toBe(204);
    // iOS'un bu sürümde OTA'sı yok; bilinmeyen platform 404
    expect((await ask(server, { 'expo-runtime-version': RUNTIME }, 'ios')).statusCode).toBe(204);
    expect((await ask(server, { 'expo-runtime-version': RUNTIME }, 'web')).statusCode).toBe(404);
    await app!.close();

    // sürümde OTA yok
    server = await start([`Diskort-${VERSION}-android.apk`]);
    expect((await ask(server, { 'expo-runtime-version': RUNTIME })).statusCode).toBe(204);
    expect(otaCalls).toBe(0);
    await app!.close();

    // bildirim başka sürüme ait (yanlış yüklenmiş)
    server = await start([`Diskort-${VERSION}-ota-android.json`], { ota: { ...otaJson, version: '0.2.0' } });
    expect((await ask(server, { 'expo-runtime-version': RUNTIME })).statusCode).toBe(204);
  });
});

describe('iOS', () => {
  const IOS_OTA_URL = `https://github.com/sahip/depo/releases/download/v${VERSION}/Diskort-${VERSION}-ota-ios.json`;
  const iosOta = { ...otaJson, platform: 'ios' };

  it('iOS bildirimini yalnızca iOS adresinden verir', async () => {
    const server = await start([`Diskort-${VERSION}-ota-ios.json`], { ota: iosOta, otaUrl: IOS_OTA_URL });
    const res = await ask(server, { 'expo-runtime-version': RUNTIME }, 'ios');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(manifest);
    // Android'e iOS bildirimi gitmez
    expect((await ask(server, { 'expo-runtime-version': RUNTIME })).statusCode).toBe(204);
    // Adres ile başlık uyuşmalı
    const mismatch = await server.inject({
      method: 'GET',
      url: '/updates/expo/ios',
      headers: { 'expo-protocol-version': '1', 'expo-platform': 'android', 'expo-runtime-version': RUNTIME },
    });
    expect(mismatch.statusCode).toBe(404);
  });

  it('platformu uyuşmayan bildirim reddedilir', async () => {
    const server = await start([`Diskort-${VERSION}-ota-ios.json`], { ota: otaJson, otaUrl: IOS_OTA_URL });
    expect((await ask(server, { 'expo-runtime-version': RUNTIME }, 'ios')).statusCode).toBe(204);
  });

  it('sürüm kuralı: IPA ve iOS OTA\'sına göre', async () => {
    const version = async (server: FastifyInstance) =>
      (await server.inject({ method: 'GET', url: '/api/client/version?platform=ios' })).json();
    let server = await start([`Diskort-${VERSION}-android.apk`]);
    // IPA yok: iOS için kural yok
    expect(await version(server)).toEqual({ platform: 'ios', latest: null, required: null });
    await app!.close();
    server = await start(['Diskort-0.2.9-ios.ipa', `Diskort-${VERSION}-ota-ios.json`], {
      ota: iosOta,
      otaUrl: IOS_OTA_URL,
    });
    expect(await version(server)).toEqual({ platform: 'ios', latest: '0.2.9', required: VERSION });
  });
});
