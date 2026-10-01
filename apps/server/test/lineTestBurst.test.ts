import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { Outage } from '../src/netOutages.js';
import { ADMIN_PROFILES, BURST_DOWN_MBPS, BURST_UP_MBPS, USER_PROFILES, buildPlan, reservedBps, type LineMode } from '../src/lineTest/plan.js';
import { LineTokens, type LineToken, type SecondStat } from '../src/lineTest/protocol.js';
import { LineTestService } from '../src/lineTest/service.js';
import { LineTestServer } from '../src/lineTest/udpServer.js';
import { classify, type RunOutage, type VerdictRun } from '../src/lineTest/verdict.js';
import { startServer, type TestServer } from './helpers.js';

// Hat testi: patlama profili (ani hız artışını sese girmeden yeniden üretir), kim neyi açabilir, sunucu
// kesintileriyle ilişkilendirme, kodların kalıcılığı ve gönderim zamanlayıcısının yalnızca oturum varken çalışması.

const SECRET = 'test-secret-0123456789abcdef';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const tokenOf = (over: Partial<LineToken> = {}): LineToken => ({ s: 4242, i: 'u:alice', n: 'Alice', t: 'udp', p: 'burst', m: 'down', x: Date.now() + 60_000, ...over });

describe('patlama profili: plan', () => {
  it('taban 3 Mbps, 2 sn\'lik basamaklı patlamalar; aşağı 10-40 Mbps, yukarı 6-12 Mbps; tek yönlü', () => {
    const down = buildPlan('burst', 'down');
    const bursts = down.steps.filter((s) => s.kind === 'burst');
    expect(bursts.map((s) => Math.round(s.rateBps / 1e6))).toEqual([...BURST_DOWN_MBPS]);
    expect(bursts.every((s) => s.secs === 2)).toBe(true);
    expect(down.steps.filter((s) => s.kind === 'base').map((s) => [Math.round(s.rateBps / 1e6), s.secs])).toEqual(Array.from({ length: 5 }, () => [3, 3]));
    // taban, patlama, taban, … sırasıyla; ilk ve son adım taban
    expect(down.steps.map((s) => s.kind)).toEqual(['base', 'burst', 'base', 'burst', 'base', 'burst', 'base', 'burst', 'base']);
    expect(down.durationMs).toBe(23_000);
    expect(Math.round(down.peakBps / 1e6)).toBe(40);
    expect(reservedBps(down)).toBe(down.peakBps);
    const up = buildPlan('burst', 'up');
    expect(up.steps.filter((s) => s.kind === 'burst').map((s) => Math.round(s.rateBps / 1e6))).toEqual([...BURST_UP_MBPS]);
    expect(up.durationMs).toBe(18_000);
    expect(() => buildPlan('burst', 'both')).toThrow();
    expect(ADMIN_PROFILES).toEqual(['burst']);
    expect(USER_PROFILES).toEqual(['quick']);
  });
});

describe('gönderim zamanlayıcısı ve yönetici bant sınırı', () => {
  it('2 ms\'lik zamanlayıcı yalnızca oturum varken çalışır; olay döngüsü gecikmesi sonuca eklenir', async () => {
    const server = new LineTestServer({ tokens: new LineTokens(SECRET), ports: [0], maxBps: 30_000_000 });
    await server.start();
    expect(server.pacing).toBe(false);
    const s = server.open(tokenOf({ p: 'quick', m: 'both' }), buildPlan('quick', 'both'), '127.0.0.1');
    if (typeof s === 'string') throw new Error(s);
    expect(server.pacing).toBe(true);
    const s2 = server.open(tokenOf({ s: 2, i: 'u:bob', p: 'quick', m: 'up' }), buildPlan('quick', 'up'), '127.0.0.2');
    if (typeof s2 === 'string') throw new Error(s2);
    expect(server.finish(s.sid)!.loopLag).toEqual({ maxMs: 0, stalls: 0 });
    expect(server.pacing).toBe(true); // hâlâ bir oturum var
    server.finish(s2.sid);
    expect(server.pacing).toBe(false);
    server.stop();
  });

  it('patlama testi olağan sınırı aşar: yalnızca yönetici sınırıyla açılır', async () => {
    const server = new LineTestServer({ tokens: new LineTokens(SECRET), ports: [0], maxBps: 24_000_000 });
    await server.start();
    const plan = buildPlan('burst', 'down');
    expect(server.open(tokenOf(), plan, '127.0.0.1')).toBe('capacity'); // 40 > 24 Mbps
    expect(typeof server.open(tokenOf(), plan, '127.0.0.1', 48_000_000)).not.toBe('string');
    // Yönetici sınırı da toplamdır: ikinci patlama testi sığmaz
    expect(server.open(tokenOf({ s: 5, i: 'u:bob' }), plan, '127.0.0.2', 48_000_000)).toBe('capacity');
    server.stop();
    const cfg = loadConfig({ NODE_ENV: 'test', DATA_DIR: '.' });
    expect([cfg.lineTestMaxBps, cfg.lineTestAdminMaxBps]).toEqual([24_000_000, 48_000_000]);
    // Yönetici sınırı olağan sınırın altına inemez
    expect(loadConfig({ NODE_ENV: 'test', DATA_DIR: '.', LINE_TEST_MAX_MBPS: '30', LINE_TEST_ADMIN_MAX_MBPS: '10' }).lineTestAdminMaxBps).toBe(30_000_000);
    expect(() => loadConfig({ NODE_ENV: 'test', DATA_DIR: '.', LINE_TEST_ADMIN_MAX_MBPS: 'x' })).toThrow();
  });
});

// ---------- Yorum ----------

/** Adım başına kayıp yüzdesiyle sentetik patlama aşaması */
function burstRun(mode: LineMode, loss: (label: string, step: number) => number, outages: RunOutage[] = []): VerdictRun {
  const plan = buildPlan('burst', mode);
  const secs: SecondStat[] = plan.seconds.map((p) => {
    const lost = Math.round((p.pps * loss(plan.steps[p.step]!.label, p.step)) / 100);
    return { planned: p.pps, recv: p.pps - lost, lost, reord: 0, dup: 0, bytes: (p.pps - lost) * p.size, jit: 1 };
  });
  return { transport: 'udp', mode, profile: 'burst', steps: plan.steps, up: mode === 'up' ? secs : null, down: mode === 'down' ? secs : null, ...(outages.length ? { outages } : {}) };
}
const codes = (runs: VerdictRun[]): string[] => classify(runs).map((f) => f.code);

describe('yorum: patlama testi', () => {
  it('temiz: kayıp yok ve sunucuda kesinti tetiklenmedi', () => {
    const f = classify([burstRun('down', () => 0), burstRun('up', () => 0)]);
    expect(f.map((x) => x.code)).toEqual(['patlama_temiz_down', 'patlama_temiz_up']);
    expect(f[0]).toMatchObject({ tone: 'ok' });
    expect(f[0]!.text).toContain('40 Mbps');
    expect(f[1]!.text).toContain('12 Mbps');
  });

  it('patlamanın ardından sunucu kesinti gördü: tetikleyici yeniden üretildi', () => {
    const o: RunOutage = { at: 1, durationMs: 2_100, kind: 'tam', sec: 14.2, step: 'taban 3 Mbps', burst: 'patlama 30 Mbps', afterBurstSec: 1.2 };
    const f = classify([burstRun('down', (label) => (label === 'patlama 40 Mbps' ? 0 : 0), [o])]);
    const hit = f.find((x) => x.code === 'patlama_kesinti_down')!;
    expect(hit.tone).toBe('bad');
    expect(hit.text).toContain('"patlama 30 Mbps" adımından 1,2 sn sonra sunucu ağında kesinti görüldü');
    expect(hit.text).toContain('tam kesinti');
    expect(hit.text).toContain('2,1 sn');
    expect(f.map((x) => x.code)).not.toContain('patlama_temiz_down');
    // İlk patlamadan önceki kesinti patlamaya bağlanmaz
    const early: RunOutage = { at: 1, durationMs: 900, kind: 'sonda', sec: 1.5, step: 'taban 3 Mbps' };
    expect(codes([burstRun('up', () => 0, [early])])).toEqual(['patlama_oncesi_kesinti_up']);
    // Test başlamadan önce başlamış kesinti testten kaynaklanamaz
    const before = classify([burstRun('up', () => 0, [{ ...early, sec: -2.9 }])]);
    expect(before[0]!.text).toContain('test başlamadan önce başlamış bir kesinti sürüyordu');
    expect(before[0]!.evidence).toBe('test başlamadan 2,9 sn önce başladı');
    // Öbür profillerde: sunucu kesinti gördüyse kayıp istemci hattına yazılmasın diye not düşülür
    const plan = buildPlan('quick', 'both');
    const clean: SecondStat[] = plan.seconds.map((p) => ({ planned: p.pps, recv: p.pps, lost: 0, reord: 0, dup: 0, bytes: p.pps * p.size, jit: 1 }));
    const quick = classify([{ transport: 'udp', mode: 'both', profile: 'quick', steps: plan.steps, up: clean, down: clean, outages: [{ at: 1, durationMs: 1_800, kind: 'sonda', sec: 4.2, step: '4 Mbps' }] }]);
    expect(quick.find((x) => x.code === 'sunucu_kesinti')).toMatchObject({ tone: 'warn', evidence: '4,2. sn (4 Mbps)' });
    // Doğrulanmamış NIC sessizliği (aday) kesinti sayılmaz: ne "sunucu kesinti gördü" ne "patlama kesintiyi tetikledi"
    const aday = classify([{ transport: 'udp', mode: 'both', profile: 'quick', steps: plan.steps, up: clean, down: clean, outages: [{ at: 1, durationMs: 1_800, kind: 'aday', sec: 4.2, step: '4 Mbps' }] }]);
    expect(aday.map((x) => x.code)).toEqual(['temiz']);
    const burstAday = classify([burstRun('down', () => 0, [{ at: 1, durationMs: 1_000, kind: 'aday', sec: 14.2, step: 'taban 3 Mbps', burst: 'patlama 30 Mbps', afterBurstSec: 1.2 }])]);
    expect(burstAday.map((x) => [x.code, x.tone])).toEqual([
      ['patlama_aday_down', 'info'],
      ['patlama_temiz_down', 'ok'],
    ]);
  });

  it('üst basamaklarda kayıp ama sunucuda kesinti yok: istemci hattı; patlama sonrası taban hızda kayıp: çöküş', () => {
    const high = classify([burstRun('down', (label) => (label === 'patlama 30 Mbps' || label === 'patlama 40 Mbps' ? 35 : 0))]);
    expect(high.map((x) => x.code)).toEqual(['patlama_kayip_down']);
    expect(high[0]).toMatchObject({ tone: 'warn' });
    expect(high[0]!.text).toContain('"patlama 30 Mbps" ve üstünde kayıp var');
    expect(high[0]!.text).toContain('sunucu ağı çökmedi');
    // 5. adım: 20 Mbps patlamasından sonraki taban
    const collapse = classify([burstRun('down', (_l, step) => (step === 4 ? 60 : 0))]);
    expect(collapse.map((x) => x.code)).toEqual(['patlama_sonrasi_kayip_down']);
    expect(collapse[0]).toMatchObject({ tone: 'bad' });
    // Patlama aşamaları hız eşiği/"veri yok"/"tcp yok" yorumlarına karışmaz
    expect(codes([burstRun('down', (label) => (label.startsWith('patlama') ? 20 : 0))])).toEqual(['patlama_kayip_down']);
  });
});

// ---------- Hizmet: kodların kalıcılığı ve kesinti ilişkisi ----------

describe('hat testi hizmeti', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-hat3-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const service = (over: Partial<ConstructorParameters<typeof LineTestService>[0]> = {}): LineTestService =>
    new LineTestService({ secret: SECRET, dir: tmp, ports: [0], maxBps: 24e6, adminMaxBps: 48e6, streamInfo: () => ({ live: false, channels: [] }), serverTxMbps: () => null, ...over });

  it('kodlar yeniden başlatmada korunur (kullanım sayısı ve yönetici işaretiyle); süresi dolanlar yüklenmez', async () => {
    let now = Date.now();
    const a = service({ now: () => now });
    await a.start();
    const normal = a.createCode('arkadaş', 1, 5);
    const admin = a.createCode('patlama', 12, 3, true);
    expect(normal.admin).toBeUndefined();
    expect(admin.admin).toBe(true);
    const m = a.mint({ kind: 'code', userId: null, name: 'x' }, admin, 'burst', 'up', 'udp', '1.1.1.1', true);
    expect(m.ok).toBe(true);
    await a.flushed();
    a.stop();
    const file = path.join(tmp, 'line-codes.json');
    expect((JSON.parse(fs.readFileSync(file, 'utf8')) as unknown[]).length).toBe(2);
    const b = service({ now: () => now });
    expect(b.listCodes().map((c) => [c.code, c.uses, c.admin ?? false]).sort()).toEqual(
      [
        [normal.code, 0, false],
        [admin.code, 1, true],
      ].sort(),
    );
    expect(b.checkCode(admin.code.toLowerCase())).toMatchObject({ admin: true, uses: 1 });
    // 2 saat sonra: 1 saatlik kod dolmuş
    now += 2 * 3_600_000;
    const c = service({ now: () => now });
    expect(c.listCodes().map((x) => x.code)).toEqual([admin.code]);
    // Bozuk dosya başlatmayı engellemez
    fs.writeFileSync(file, '{bozuk');
    expect(service().listCodes()).toEqual([]);
  });

  it('yönetici olmayan oturum patlama testine sığmaz; kesintiler plan saniyesi ve patlama adımıyla sonuca eklenir', async () => {
    const outages: Outage[] = [];
    const svc = service({ outagesBetween: (from, to) => outages.filter((o) => o.at <= to && o.at + o.durationMs >= from) });
    await svc.start();
    const who = { kind: 'code' as const, userId: null, name: 'a' };
    const code = svc.createCode('x', 1, 10, true);
    expect(svc.mint(who, code, 'burst', 'down', 'udp', '1.1.1.1')).toMatchObject({ ok: false, error: 'capacity' });
    expect(svc.mint(who, code, 'burst', 'both', 'udp', '1.1.1.1', true)).toMatchObject({ ok: false, error: 'bad_profile' });
    const m = svc.mint(who, code, 'burst', 'down', 'udp', '1.1.1.1', true);
    if (!m.ok) throw new Error(m.error);
    // Test 16 sn önce başladı; 30 Mbps patlaması 13-15. saniyeler; kesinti 15,4. saniyede
    const startedAt = Date.now() - 16_000;
    m.session.startedAt = startedAt;
    const at = startedAt + 15_400;
    outages.push({ id: 'k1', at, durationMs: 2_300, t: '', kind: 'tam', probe: null, nic: null });
    const run = svc.finish(m.session, null, null, null, 'patlama-1')!;
    expect(run.profile).toBe('burst');
    expect(run.loopLag).toEqual({ maxMs: 0, stalls: 0 });
    expect(run.outages).toEqual([{ at, durationMs: 2_300, kind: 'tam', sec: 15.4, step: 'taban 3 Mbps', burst: 'patlama 30 Mbps', afterBurstSec: 0.4 }]);
    // Testin bitişinden sonra (8 sn içinde) kayda geçen kesinti listelemede görünür
    outages.push({ id: 'k2', at: run.end + 3_000, durationMs: 1_000, t: '', kind: 'sonda', probe: null, nic: null });
    expect(svc.refreshOutages(run).outages).toHaveLength(2);
    expect(run.outages).toHaveLength(1);
    await svc.flushed();
    await sleep(50);
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'line-tests.jsonl'), 'utf8').trim()) as { outages: unknown[] };
    expect(saved.outages).toHaveLength(1);
    svc.stop();
  });
});

// ---------- Uçlar: kim neyi açabilir ----------

describe('hat testi uçları: yetki ve sınırlar', () => {
  let s: TestServer;
  let tmp: string;
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-hat4-'));
    s = await startServer({ lineTestPorts: [0], telemetryDir: tmp });
  });
  afterEach(async () => {
    await s.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const open = (headers: Record<string, string>, payload: Record<string, unknown>) => s.app.inject({ method: 'POST', url: '/api/line-test/session', headers, payload });
  const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
  const finish = (token: string) => s.app.inject({ method: 'POST', url: '/api/line-test/finish', headers: { 'x-line-token': token }, payload: {} });

  it('sıradan hesap yalnızca kısa testi açabilir ve 10 dakikada 6 kez dener', async () => {
    const member = await s.member('uye');
    for (const profile of ['ramp', 'pps', 'steady', 'burst']) {
      const r = await open(bearer(member.token), { profile, mode: 'up' });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe('forbidden_profile');
    }
    const ok = await open(bearer(member.token), { profile: 'quick' });
    expect(ok.statusCode).toBe(200);
    expect((await finish(ok.json().token as string)).statusCode).toBe(200);
    // 5 deneme harcandı (4 ret + 1 test); altıncı serbest, yedinci sınırda
    expect((await open(bearer(member.token), { profile: 'quick' })).statusCode).toBe(200);
    expect((await open(bearer(member.token), { profile: 'quick' })).statusCode).toBe(429);
    // Yönetici hesabı tam paketi açabilir
    const admin = await open(bearer(s.owner.token), { profile: 'ramp', mode: 'up' });
    expect(admin.statusCode).toBe(200);
  });

  it('patlama testi: sıradan kod reddedilir, yönetici kodu ve yönetici hesabı açar; yayın varken zorlanmadıkça başlamaz', async () => {
    const mk = async (admin: boolean): Promise<string> =>
      ((await s.req(s.owner.token, 'POST', '/api/admin/line-test/codes', { label: 'x', hours: 1, maxUses: 20, admin })).json() as { code: string }).code;
    const normal = await mk(false);
    const adminCode = await mk(true);
    // Sıradan kod: tam paket evet, patlama hayır
    const denied = await open({}, { profile: 'burst', mode: 'down', code: normal, name: 'Arkadaş' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().message).toContain('yönetici koduyla');
    const ramp = await open({}, { profile: 'ramp', mode: 'up', code: normal, name: 'Arkadaş' });
    expect(ramp.statusCode).toBe(200);
    await finish(ramp.json().token as string);
    // Yönetici kodu: patlama (tek yönlü)
    expect((await open({}, { profile: 'burst', mode: 'both', code: adminCode, name: 'Yönetici' })).statusCode).toBe(400);
    const burst = await open({}, { profile: 'burst', mode: 'down', code: adminCode, name: 'Yönetici' });
    expect(burst.statusCode).toBe(200);
    const body = burst.json();
    expect(body.plan.steps.filter((st: { kind?: string }) => st.kind === 'burst')).toHaveLength(4);
    expect(body.plan.seconds).toHaveLength(23);
    const fin = (await finish(body.token as string)).json();
    expect(fin.outages).toEqual([]);
    expect(fin.loopLag).toEqual({ maxMs: 0, stalls: 0 });
    // Canlı yayın varken: 409; force ile başlar
    s.ctx.voice.join(s.owner.user.id, s.channel('voice').id, true);
    const live = await open(bearer(s.owner.token), { profile: 'burst', mode: 'up' });
    expect(live.statusCode).toBe(409);
    expect(live.json()).toMatchObject({ error: 'stream_live' });
    expect(live.json().message).toContain('--zorla');
    const forced = await open(bearer(s.owner.token), { profile: 'burst', mode: 'up', force: true });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().streamLive).toBe(true);
    // Öbür profiller yayın varken de açılır (yayın açıkken ölçüm karşılaştırması)
    await finish(forced.json().token as string);
    expect((await open(bearer(s.owner.token), { profile: 'quick' })).statusCode).toBe(200);
    // Panel: kodlar (yönetici işaretiyle) ve yönetici bant sınırı
    const panel = (await s.req(s.owner.token, 'GET', '/api/admin/line-tests?days=1')).json();
    expect(panel).toMatchObject({ maxMbps: 24, adminMaxMbps: 48 });
    expect(panel.codes.find((c: { code: string }) => c.code === adminCode)).toMatchObject({ admin: true });
    expect(panel.suites.flatMap((su: { runs: { profile: string }[] }) => su.runs.map((r) => r.profile))).toContain('burst');
    // Kodlar dosyada (yeniden başlatmada korunur)
    await s.ctx.lineTest.flushed();
    expect((JSON.parse(fs.readFileSync(path.join(tmp, 'line-codes.json'), 'utf8')) as { code: string }[]).map((c) => c.code).sort()).toEqual([normal, adminCode].sort());
  });
});
