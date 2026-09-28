import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STREAM_WATCH_MAX } from '@diskort/shared';
import { VoiceStateStore } from '../src/voiceState.js';
import { connectGateway, type GatewayClient, type TestServer, startServer } from './helpers.js';

/** u1 c1'de yayında; verilen izleyiciler de c1'de */
function stage(...viewers: string[]): VoiceStateStore {
  const voice = new VoiceStateStore();
  voice.join('u1', 'c1');
  voice.setStreaming('u1', 'c1', true);
  for (const v of viewers) voice.join(v, 'c1');
  return voice;
}

describe('yayın izleyicileri (ses durumu)', () => {
  it('aynı kanaldaki izleyici görünür; bırakınca düşer', () => {
    const voice = stage('u2', 'u3');
    const updates: string[] = [];
    voice.on('update', (s) => updates.push(`${s.userId}:${(s.watching ?? []).join(',')}`));

    voice.setWatching('u2', ['u1']);
    voice.setWatching('u3', ['u1']);
    expect(voice.get('u2')?.watching).toEqual(['u1']);
    expect(voice.viewersOf('u1')).toEqual(['u2', 'u3']);
    // Aynı liste yeniden bildirilince yeni olay yok
    voice.setWatching('u2', ['u1']);
    expect(updates).toEqual(['u2:u1', 'u3:u1']);

    voice.setWatching('u2', []);
    expect(voice.get('u2')?.watching).toBeUndefined();
    expect(voice.viewersOf('u1')).toEqual(['u3']);
  });

  it('yayıncı kendisinin izleyicisi sayılmaz; yinelenen ve geçersiz kimlikler atılır', () => {
    const voice = stage('u2');
    voice.setWatching('u1', ['u1']);
    expect(voice.get('u1')?.watching).toBeUndefined();
    voice.setWatching('u2', ['u1', 'u1', 42, null, '', 'x'.repeat(200)]);
    expect(voice.get('u2')?.watching).toEqual(['u1']);
    expect(voice.viewersOf('u1')).toEqual(['u2']);
  });

  it('ses kanalında olmayan ya da başka kanaldaki kişi izleyici olamaz', () => {
    const voice = stage();
    voice.join('u4', 'c2');
    voice.setWatching('u4', ['u1']);
    voice.setWatching('dışarıdaki', ['u1']);
    expect(voice.get('u4')?.watching).toBeUndefined();
    expect(voice.viewersOf('u1')).toEqual([]);
  });

  it('izleyici sesten ayrılınca düşer; başka kanala geçince görünmez', () => {
    const voice = stage('u2', 'u3');
    voice.setWatching('u2', ['u1']);
    voice.setWatching('u3', ['u1']);
    expect(voice.leave('u2', 'c1')).toBe(true);
    expect(voice.viewersOf('u1')).toEqual(['u3']);
    voice.join('u3', 'c2');
    expect(voice.get('u3')?.watching).toBeUndefined();
    expect(voice.viewersOf('u1')).toEqual([]);
  });

  it('yayın bitince izleyiciler temizlenir; yeniden başlayınca eski izleyiciler geri gelmez', () => {
    const voice = stage('u2');
    voice.setWatching('u2', ['u1']);
    voice.setStreaming('u1', 'c1', false);
    expect(voice.get('u2')?.watching).toBeUndefined();
    voice.setStreaming('u1', 'c1', true);
    expect(voice.viewersOf('u1')).toEqual([]);
  });

  it('yayıncı ayrılınca izleyicilerin listesinden çıkar', () => {
    const voice = stage('u2');
    voice.setWatching('u2', ['u1']);
    voice.leave('u1', 'c1');
    expect(voice.get('u2')?.watching).toBeUndefined();
    voice.join('u1', 'c1', true);
    expect(voice.viewersOf('u1')).toEqual([]);
  });

  it('izleme bildirimi yayın ya da katılma webhookundan önce gelirse, webhook gelince görünür', () => {
    const voice = new VoiceStateStore();
    voice.join('u1', 'c1');
    // Başka kanaldan geçip hemen yayını açtı: istek önce, katılma webhooku sonra
    voice.setWatching('u2', ['u1']);
    voice.join('u2', 'c1');
    expect(voice.get('u2')?.watching).toBeUndefined();
    // Yayın webhooku izleme isteğinden sonra geldi
    voice.setStreaming('u1', 'c1', true);
    expect(voice.get('u2')?.watching).toEqual(['u1']);
  });

  it('en fazla STREAM_WATCH_MAX yayın izlenebilir', () => {
    const voice = new VoiceStateStore();
    voice.join('v', 'c1');
    for (let i = 0; i < STREAM_WATCH_MAX + 5; i++) {
      voice.join(`s${i}`, 'c1');
      voice.setStreaming(`s${i}`, 'c1', true);
    }
    voice.setWatching(
      'v',
      Array.from({ length: STREAM_WATCH_MAX + 5 }, (_, i) => `s${i}`),
    );
    expect(voice.get('v')?.watching).toHaveLength(STREAM_WATCH_MAX);
  });
});

describe('yayın izleyicileri (gateway)', () => {
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

  const connect = async (token: string): Promise<GatewayClient> => {
    const client = await connectGateway(s.app, token);
    clients.push(client);
    return client;
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const watch = (c: GatewayClient, userIds: unknown) => c.ws.send(JSON.stringify({ t: 'STREAM_WATCH_SET', d: { userIds } }));

  it('izleyici bildirir, kanalı görenlere duyurulur; bağlantısı kopunca hayalet kalmaz', async () => {
    const ali = await s.member('ali');
    const voice = s.channel('voice').id;
    s.ctx.voice.join(s.owner.user.id, voice);
    s.ctx.voice.setStreaming(s.owner.user.id, voice, true);
    s.ctx.voice.join(ali.user.id, voice);

    const owner = await connect(s.owner.token);
    const ca = await connect(ali.token);
    watch(ca, [s.owner.user.id]);
    await owner.settle();
    expect(s.ctx.voice.viewersOf(s.owner.user.id)).toEqual([ali.user.id]);
    const seen = owner.of('VOICE_STATE_UPDATE').filter((v) => v.userId === ali.user.id);
    expect(seen.at(-1)?.watching).toEqual([s.owner.user.id]);

    // Uygulama çöktü / ağ koptu: gateway bağlantısı kapanınca izleme silinir (LiveKit'te henüz seste olsa da)
    ca.ws.terminate();
    await owner.settle();
    expect(s.ctx.voice.get(ali.user.id)?.channelId).toBe(voice);
    expect(s.ctx.voice.viewersOf(s.owner.user.id)).toEqual([]);
    expect(owner.of('VOICE_STATE_UPDATE').filter((v) => v.userId === ali.user.id).at(-1)?.watching).toBeUndefined();

    // Yeniden bağlanıp bildirince geri gelir
    const again = await connect(ali.token);
    watch(again, [s.owner.user.id]);
    await owner.settle();
    expect(s.ctx.voice.viewersOf(s.owner.user.id)).toEqual([ali.user.id]);
  });

  it('seste olmayan üye izleyici olarak görünmez; başka bağlantısının kapanması izlemeyi silmez', async () => {
    const ali = await s.member('ali');
    const veli = await s.member('veli');
    const voice = s.channel('voice').id;
    s.ctx.voice.join(s.owner.user.id, voice);
    s.ctx.voice.setStreaming(s.owner.user.id, voice, true);

    const cv = await connect(veli.token);
    watch(cv, [s.owner.user.id]);
    await cv.settle();
    expect(s.ctx.voice.viewersOf(s.owner.user.id)).toEqual([]);

    // Ali seste ve izliyor; telefonundaki (seste olmayan) bağlantı kapanınca izleme sürer
    s.ctx.voice.join(ali.user.id, voice);
    const desktop = await connect(ali.token);
    const phone = await connect(ali.token);
    watch(desktop, [s.owner.user.id]);
    await desktop.settle();
    phone.ws.close();
    await wait(150);
    expect(s.ctx.voice.viewersOf(s.owner.user.id)).toEqual([ali.user.id]);

    // Geçersiz yük bağlantıyı düşürmez, izlemeyi bırakır
    watch(desktop, 'yanlış');
    await desktop.settle();
    expect(s.ctx.voice.viewersOf(s.owner.user.id)).toEqual([]);
    expect(desktop.ws.readyState).toBe(desktop.ws.OPEN);
  });
});
