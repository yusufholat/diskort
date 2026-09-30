import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildUsers, diagnose, FreezeCorrelator, isRelevantEntry, type FreezeUser } from '../src/freezeDiagnosis.js';
import { parseDefaultGateway } from '../src/hostNetwork.js';
import { dnsQuery, parseProbeTargets, ProbeRunner } from '../src/netProbe.js';
import {
  isAbnormalRow,
  parsePsiCpu,
  parseSoftnetStat,
  rowBetween,
  SecondSampler,
  summarizeRows,
  type ProcFiles,
  type RawSecond,
  type SecondRow,
} from '../src/netSeconds.js';
import type { TelemetryEntry } from '../src/telemetry.js';

// Yayın donması tanısı. Fikstürler 2026-10-01 01:18 / 01:23:47 olayından: sunucu sağlıklı (livekit ~%22, UDP hatası 0),
// 4 kullanıcının hepsinde 12-20% giden kayıp, ping normal, izleyicilerde 2-7 donma, yayıncı 1080p ~8-9 Mbps,
// AMD H.264 donanım kodlayıcı, 17-25 fps.

const T0 = Date.parse('2026-10-01T01:18:00+03:00');

function entry(userId: string, over: Partial<TelemetryEntry> = {}, at = T0 + 30_000): TelemetryEntry {
  return {
    at,
    userId,
    channelId: 'kanal',
    guildId: 'sunucu',
    platform: 'desktop',
    version: '0.9.3',
    windowSec: 30,
    quality: 'good',
    poorSec: 0,
    serverQuality: 'excellent',
    rttAvg: 30,
    rttMax: 45,
    jitterIn: 4,
    jitterOut: 3,
    lossOut: 0,
    lossIn: 0,
    concealed: 0,
    bitrateOut: 40_000,
    bitrateIn: 40_000,
    availableOut: null,
    candidate: 'host',
    protocol: 'udp',
    reconnects: 0,
    mic: null,
    screen: null,
    severity: 'ok',
    causes: [],
    ...over,
  };
}

const streamerScreen = (over: object = {}) => ({
  width: 1920,
  height: 1080,
  fps: 21,
  bitrate: 8_500_000,
  encoder: 'AMD H.264 HW',
  codec: 'video/H264',
  limitation: 'none' as const,
  limitedRatio: 0,
  hardware: true,
  ...over,
});
const watching = (freezes: number, over: object = {}) => ({
  codec: 'video/H264',
  decoder: 'x',
  hardware: true,
  powerEfficient: true,
  width: 1920,
  height: 1080,
  fps: 18,
  decodeMs: 3,
  decodeMsMax: 6,
  bitrate: 6_000_000,
  framesDropped: 10,
  freezes,
  freezeSec: freezes * 0.8,
  jitterBufferMs: 80,
  view: null,
  ...over,
});

/** Olaydaki 4 kullanıcı: yayıncı + 3 izleyici, hepsinde giden kayıp */
function incidentEntries(): TelemetryEntry[] {
  return [
    entry('yayinci', { lossOut: 15, lossIn: 0, screen: streamerScreen() }),
    entry('i1', { lossOut: 12, lossIn: 14, watch: watching(7) }),
    entry('i2', { lossOut: 20, lossIn: 16, watch: watching(2) }),
    entry('i3', { lossOut: 17, lossIn: 13, watch: watching(4) }),
  ];
}

/** Sağlıklı sunucu satırları (livekit %22, NIC düşüşü yok) */
function healthyRows(n = 60, over: Partial<SecondRow> = {}, probe: 'temiz' | 'kayip' | 'yok' = 'temiz'): SecondRow[] {
  return Array.from({ length: n }, (_, i) => ({
    t: T0 + i * 1000,
    rx: 12,
    tx: 28,
    rxp: 2500,
    txp: 3200,
    nd: 0,
    ue: 0,
    ur: 0,
    us: 0,
    sd: 0,
    psi: 1,
    lk: 0.22,
    ...(probe === 'yok' ? {} : i % 2 === 0 ? { p: { 'udp 1.1.1.1': probe === 'temiz' ? 9 : i % 4 === 0 ? -1 : 11 } } : { p: { 'udp 8.8.8.8': probe === 'temiz' ? 14 : -1 } }),
    ...over,
  }));
}
const summary = (rows: SecondRow[]) => summarizeRows(rows, T0, T0 + 60_000, 4);

describe('sınıflandırıcı (olay sayıları)', () => {
  it('4 kullanıcıda aynı anda giden kayıp, ping normal, sunucu sağlıklı, sondalar temiz: ortak yol', () => {
    const d = diagnose(buildUsers(incidentEntries()), summary(healthyRows()));
    expect(d.cause).toBe('ortak_yol');
    expect(d.label).toBe('Ortak yol kaybı');
    expect(d.probe).toBe('temiz');
    expect(d.confidence).toBe('yüksek');
    expect(d.evidence.join(' ')).toContain('4 kullanıcıda aynı sırada giden kayıp %12–20');
    expect(d.evidence.join(' ')).toContain('ping normal');
    expect(d.evidence.join(' ')).toContain('toplam 13 donma');
    // Yayıncı 21 fps: ikincil etken olarak not edilir (ana neden kayıp)
    expect(d.factors.join(' ')).toContain('21–21 fps');
    expect(d.factors.join(' ')).toContain('AMD H.264 HW');
  });

  it('sondalarda da kayıp varsa sağlayıcı yolu olarak işaretlenir', () => {
    const rows = healthyRows(60, {}, 'kayip');
    const d = diagnose(buildUsers(incidentEntries()), summary(rows));
    expect(d.cause).toBe('ortak_yol');
    expect(d.probe).toBe('kayıp');
    expect(d.factors).toContain('sağlayıcı/VPS ağ yolu');
  });

  it('sonda verisi yoksa yine ortak yol ama sonda "yok"', () => {
    const d = diagnose(buildUsers(incidentEntries()), summary(healthyRows(60, {}, 'yok')));
    expect(d.cause).toBe('ortak_yol');
    expect(d.probe).toBe('yok');
  });

  it('yalnızca yayıncıda giden kayıp, izleyicilerde gelen kayıp: yayıncının yükleme hattı', () => {
    const entries = [
      entry('yayinci', { lossOut: 18, screen: streamerScreen({ fps: 28 }) }),
      entry('i1', { lossIn: 15, watch: watching(5) }),
      entry('i2', { lossIn: 12, watch: watching(3) }),
    ];
    const d = diagnose(buildUsers(entries), summary(healthyRows()));
    expect(d.cause).toBe('yayinci_yukleme');
    expect(d.confidence).toBe('yüksek');
  });

  it('izleyici ikisinde gelen kayıp, yayıncı temiz: ortak yol (sunucu çıkışı)', () => {
    const entries = [
      entry('yayinci', { screen: streamerScreen({ fps: 30 }) }),
      entry('i1', { lossIn: 15, watch: watching(5) }),
      entry('i2', { lossIn: 12, watch: watching(3) }),
    ];
    const d = diagnose(buildUsers(entries), summary(healthyRows()));
    expect(d.cause).toBe('ortak_yol');
    expect(d.evidence.join(' ')).toContain('gelen kayıp');
  });

  it('kimsede kayıp yok, yayıncı 17 fps, izleyiciler donuyor: kodlayıcı', () => {
    const entries = [
      entry('yayinci', { screen: streamerScreen({ fps: 17, limitation: 'cpu', limitedRatio: 0.6 }) }),
      entry('i1', { watch: watching(6) }),
      entry('i2', { watch: watching(3) }),
    ];
    const d = diagnose(buildUsers(entries), summary(healthyRows()));
    expect(d.cause).toBe('kodlayici');
    expect(d.evidence.join(' ')).toContain('Kimsede paket kaybı yok');
  });

  it('düşük fps ama sınırlama "bant genişliği": kodlayıcı değil (ağ kaynaklı)', () => {
    const entries = [
      entry('yayinci', { screen: streamerScreen({ fps: 15, limitation: 'bandwidth', limitedRatio: 0.9 }) }),
      entry('i1', { watch: watching(6) }),
      entry('i2', { watch: watching(4) }),
    ];
    expect(diagnose(buildUsers(entries), summary(healthyRows())).cause).not.toBe('kodlayici');
  });

  it('sunucuda NIC düşüşü / UDP tampon hatası varken: sunucu kaynağı', () => {
    const rows = healthyRows(60, {});
    rows[30] = { ...rows[30]!, nd: 25, ur: 12 };
    const d = diagnose(buildUsers(incidentEntries()), summary(rows));
    expect(d.cause).toBe('sunucu_kaynak');
    expect(d.evidence.join(' ')).toContain('NIC');
    expect(d.evidence.join(' ')).toContain('UDP tampon');
  });

  it('LiveKit işlemcisi ya da CPU baskısı doluyken: sunucu kaynağı; %22 yük sorun sayılmaz', () => {
    const full = diagnose(buildUsers(incidentEntries()), summary(healthyRows(60, { lk: 3.6 })));
    expect(full.cause).toBe('sunucu_kaynak');
    const psi = diagnose(buildUsers(incidentEntries()), summary(healthyRows(60, { psi: 70 })));
    expect(psi.cause).toBe('sunucu_kaynak');
    expect(diagnose(buildUsers(incidentEntries()), summary(healthyRows(60, { lk: 0.22 }))).cause).toBe('ortak_yol');
  });

  it('tek izleyicide gelen kayıp, diğerleri temiz: tek kullanıcı hattı', () => {
    const entries = [entry('yayinci', { screen: streamerScreen({ fps: 30 }) }), entry('i1', { lossIn: 14, watch: watching(5) }), entry('i2', { watch: watching(0) })];
    expect(diagnose(buildUsers(entries), summary(healthyRows())).cause).toBe('tek_kullanici');
  });

  it('yayıncı olmayan tek kullanıcının yükleme kaybı: tek kullanıcı hattı', () => {
    const entries = [entry('a', { lossOut: 12 }), entry('b', { lossIn: 8 }), entry('c', {})];
    expect(diagnose(buildUsers(entries), null).cause).toBe('tek_kullanici');
  });

  it('hiçbir işaret yoksa belirsiz; sunucu özeti yoksa da çalışır', () => {
    const entries = [entry('yayinci', { screen: streamerScreen({ fps: 30 }) }), entry('i1', { watch: watching(3) }), entry('i2', { watch: watching(2) })];
    const d = diagnose(buildUsers(entries), null);
    expect(d.cause).toBe('belirsiz');
    expect(d.probe).toBe('yok');
  });

  it('buildUsers: roller, en kötü değerler ve donma toplamları', () => {
    const users = buildUsers([...incidentEntries(), entry('i1', { lossOut: 4, watch: watching(1) }, T0 + 60_000)]);
    const byId = Object.fromEntries(users.map((u) => [u.userId, u])) as Record<string, FreezeUser>;
    expect(byId.yayinci!.role).toBe('yayıncı');
    expect(byId.i1!.role).toBe('izleyici');
    expect(byId.i1!.lossOut).toBe(12);
    expect(byId.i1!.freezes).toBe(8);
    expect(byId.yayinci!.screen?.encoder).toBe('AMD H.264 HW');
  });

  it('isRelevantEntry: kayıp eşiği ve donma eşiği', () => {
    expect(isRelevantEntry(entry('a', { lossOut: 2.9 }))).toBe(false);
    expect(isRelevantEntry(entry('a', { lossOut: 3 }))).toBe(true);
    expect(isRelevantEntry(entry('a', { watch: watching(1, { freezeSec: 0.4 }) }))).toBe(false);
    expect(isRelevantEntry(entry('a', { watch: watching(2) }))).toBe(true);
  });
});

// ---------- /proc ayrıştırma ve saniyelik satırlar ----------

const SOFTNET = `0000ab12 00000002 00000001 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000
000000ff 00000003 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000
`;
const PSI = `some avg10=1.20 avg60=0.50 avg300=0.10 total=5000000
full avg10=0.00 avg60=0.00 avg300=0.00 total=0
`;
const ROUTE = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
eth0\t00000000\t0100A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0
eth0\t0000A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0
`;
const devText = (rxBytes: number, txBytes: number, rxDrop = 0, txDrop = 0): string =>
  `Inter-|   Receive |  Transmit
 face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed
  eth0: ${rxBytes} ${Math.round(rxBytes / 1000)} 0 ${rxDrop} 0 0 0 0 ${txBytes} ${Math.round(txBytes / 1000)} 0 ${txDrop} 0 0 0 0
`;
const snmpText = (rcvbuf: number) => `Udp: InDatagrams NoPorts InErrors OutDatagrams RcvbufErrors SndbufErrors
Udp: 100 0 ${rcvbuf} 200 ${rcvbuf} 0
`;
const files = (over: Partial<ProcFiles> = {}): ProcFiles => ({ dev: devText(0, 0), route: ROUTE, snmp: snmpText(0), softnet: SOFTNET, psi: PSI, ...over });

describe('saniyelik ağ satırları', () => {
  it('softnet_stat, PSI ve ağ geçidi ayrıştırılır', () => {
    expect(parseSoftnetStat(SOFTNET)).toEqual({ processed: 0xab12 + 0xff, dropped: 5, squeezed: 1 });
    expect(parseSoftnetStat('')).toBeNull();
    expect(parsePsiCpu(PSI)).toBe(5_000_000);
    expect(parsePsiCpu('')).toBeNull();
    expect(parseDefaultGateway(ROUTE)).toBe('192.168.0.1');
    expect(parseDefaultGateway('Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\neth0\t0000A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF')).toBeNull();
  });

  it('iki okumadan Mbps, düşüşler, UDP hataları, softnet ve PSI yüzdesi', () => {
    const s = new SecondSampler({ procRoot: '/yok', dir: null });
    expect(s.tick(1000, files())).toBeNull(); // ilk okuma satır vermez
    const row = s.tick(
      2000,
      files({
        dev: devText(3_125_000, 7_000_000, 4, 6),
        snmp: snmpText(9),
        softnet: SOFTNET.replace('00000002', '00000005'),
        psi: PSI.replace('5000000', '5250000'),
      }),
    )!;
    expect(row.rx).toBe(25);
    expect(row.tx).toBe(56);
    expect(row.nd).toBe(10); // 4 rx drop + 6 tx drop
    expect(row.ue).toBe(9);
    expect(row.ur).toBe(9);
    expect(row.sd).toBe(3);
    expect(row.psi).toBe(25);
    expect(s.readable).toEqual({ net: true, snmp: true, softnet: true, psi: true });
    expect(s.gateway).toBe('192.168.0.1');
  });

  it('okunamayan dosyalarda zarifçe düşer (kapsayıcıda softnet/PSI yoksa)', () => {
    const s = new SecondSampler({ procRoot: '/yok', dir: null });
    s.tick(1000, files({ softnet: null, psi: null }));
    const row = s.tick(2000, files({ dev: devText(1_250_000, 0), softnet: null, psi: null }))!;
    expect(row.rx).toBe(10);
    expect(row.sd).toBeNull();
    expect(row.psi).toBeNull();
    expect(s.readable.softnet).toBe(false);
    expect(s.readable.psi).toBe(false);
    // /proc/net hiç yoksa satır üretilmez
    const none = new SecondSampler({ procRoot: '/yok', dir: null });
    none.tick(1000, files({ dev: null, route: null, snmp: null, softnet: null, psi: null }));
    expect(none.tick(2000, files({ dev: null, route: null, snmp: null, softnet: null, psi: null }))!.rx).toBeNull();
  });

  it('sayaç geri giderse (sıfırlanma) düşüş sayılmaz', () => {
    const a: RawSecond = { at: 1000, net: null, softnet: { processed: 10, dropped: 50, squeezed: 0 }, psiUs: 100 };
    const b: RawSecond = { at: 2000, net: null, softnet: { processed: 5, dropped: 2, squeezed: 0 }, psiUs: 50 };
    const r = rowBetween(b, a, null)!;
    expect(r.sd).toBeNull();
    expect(r.psi).toBeNull();
  });

  it('sondalar gönderildiği saniyenin satırına işlenir; özet kayıp yüzdesini verir (ağ geçidi hariç)', () => {
    const s = new SecondSampler({ procRoot: '/yok', dir: null });
    s.tick(T0, files());
    for (let i = 1; i <= 10; i++) {
      s.tick(T0 + i * 1000, files({ dev: devText(i * 1_000_000, i * 1_000_000) }));
      if (i === 2) s.addProbe('udp 1.1.1.1', T0 + 2500, 12);
      if (i === 3) {
        s.addProbe('udp 1.1.1.1', T0 + 3500, null);
        s.addProbe('ağ geçidi', T0 + 3600, null);
      }
    }
    const rows = s.window(T0, T0 + 10_000);
    expect(rows.find((r) => r.t === T0 + 2000)?.p).toEqual({ 'udp 1.1.1.1': 12 });
    expect(rows.find((r) => r.t === T0 + 3000)?.p).toEqual({ 'udp 1.1.1.1': -1, 'ağ geçidi': -1 });
    const sum = summarizeRows(rows, T0, T0 + 10_000, 2);
    expect(sum.probes['udp 1.1.1.1']).toMatchObject({ sent: 2, lost: 1, lossPct: 50, rttMed: 12 });
    expect(sum.probeLossPct).toBeNull(); // 5'ten az sonda: yargı yok
  });

  it('isAbnormalRow: drop, UDP hatası, PSI ve sonda kaybı dalgası; tek tük kayıp normal', () => {
    const ok = healthyRows(1)[0]!;
    expect(isAbnormalRow(ok, [ok])).toBe(false);
    expect(isAbnormalRow({ ...ok, nd: 1 }, [ok])).toBe(true);
    expect(isAbnormalRow({ ...ok, ur: 1 }, [ok])).toBe(true);
    expect(isAbnormalRow({ ...ok, psi: 35 }, [ok])).toBe(true);
    const oneLost = [...healthyRows(9), { ...ok, p: { 'udp 1.1.1.1': -1 } }];
    expect(isAbnormalRow(oneLost[9]!, oneLost)).toBe(false);
    const wave = healthyRows(10).map((r) => ({ ...r, p: { 'udp 1.1.1.1': -1 } }));
    expect(isAbnormalRow(wave[9]!, wave)).toBe(true);
    expect(isAbnormalRow({ ...ok, p: { 'ağ geçidi': -1 } }, [{ ...ok, p: { 'ağ geçidi': -1 } }])).toBe(false);
  });
});

describe('anormal saniyelerin kalıcı kaydı', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-netsec-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sağlıklı sunucuda dosya oluşmaz; anormal saniyenin ±30 sn çevresi yazılır', async () => {
    const s = new SecondSampler({ procRoot: '/yok', dir, offsetMin: 180 });
    let rx = 0;
    for (let i = 0; i <= 200; i++) {
      rx += 1_000_000;
      // 100. saniyede NIC düşüşü (tek sefer)
      s.tick(T0 + i * 1000, files({ dev: devText(rx, rx, i >= 100 ? 40 : 0, 0) }));
    }
    await s.flush();
    const names = fs.readdirSync(dir).filter((n) => n.startsWith('netsec-'));
    expect(names).toHaveLength(1);
    const rows = fs.readFileSync(path.join(dir, names[0]!), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as SecondRow);
    // düşüşün görüldüğü satır = 100. saniye; öncesi 30, sonrası 30 sn (+ kendisi)
    expect(rows[0]!.t).toBe(T0 + 70_000);
    expect(rows[rows.length - 1]!.t).toBe(T0 + 130_000);
    expect(rows.length).toBe(61);
    expect(rows.find((r) => r.nd === 40)).toBeTruthy();

    const healthy = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-netsec-ok-'));
    const h = new SecondSampler({ procRoot: '/yok', dir: healthy });
    let b = 0;
    for (let i = 0; i <= 120; i++) h.tick(T0 + i * 1000, files({ dev: devText((b += 500_000), b) }));
    await h.flush();
    expect(fs.readdirSync(healthy)).toEqual([]);
    fs.rmSync(healthy, { recursive: true, force: true });
  });
});

// ---------- Sonda ----------

describe('dış sondalar', () => {
  it('hedef ayarı ayrıştırılır; geçersiz parçalar atılır, "0" kapatır', () => {
    expect(parseProbeTargets(undefined)).toBeNull();
    expect(parseProbeTargets('0')).toEqual([]);
    expect(parseProbeTargets('udp:1.1.1.1:53, tcp:8.8.8.8:443, bozuk, udp:9.9.9.9:99999')).toEqual([
      { label: 'udp 1.1.1.1', kind: 'udp', host: '1.1.1.1', port: 53 },
      { label: 'tcp 8.8.8.8', kind: 'tcp', host: '8.8.8.8', port: 443 },
    ]);
  });

  it('DNS sorgusu: 17 bayt, kök adı NS/IN', () => {
    const q = dnsQuery(0x1234);
    expect(q.length).toBe(17);
    expect(q.readUInt16BE(0)).toBe(0x1234);
    expect(q.readUInt16BE(13)).toBe(2);
    expect(q.readUInt16BE(15)).toBe(1);
  });

  it('ProbeRunner sonucu bildirir; ağ geçidi hiç yanıt vermezse kapanır ve artık bildirmez', async () => {
    const results: [string, number | null][] = [];
    const runner = new ProbeRunner({
      targets: [{ label: 'udp 1.1.1.1', kind: 'udp', host: '1.1.1.1', port: 53 }],
      gateway: () => '192.168.0.1',
      onResult: (l, _t, rtt) => results.push([l, rtt]),
      run: async (t) => (t.label === 'ağ geçidi' ? null : 11),
    });
    await runner.once({ label: 'udp 1.1.1.1', kind: 'udp', host: '1.1.1.1', port: 53 });
    expect(results).toEqual([['udp 1.1.1.1', 11]]);
    for (let i = 0; i < 20; i++) await runner.gatewayOnce();
    expect(runner.gatewayDisabled).toBe(true);
    const gw = results.filter(([l]) => l === 'ağ geçidi').length;
    expect(gw).toBe(14);
    await runner.gatewayOnce();
    expect(results.filter(([l]) => l === 'ağ geçidi').length).toBe(gw);
  });
});

// ---------- Olay toplayıcı ----------

describe('FreezeCorrelator', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-freeze-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function feedSampler(rowsN: number, mutate?: (i: number) => Partial<ProcFiles>): SecondSampler {
    const s = new SecondSampler({ procRoot: '/yok', dir: null, livekitCpu: () => 0.22 });
    let b = 0;
    for (let i = 0; i <= rowsN; i++) {
      const at = T0 - 60_000 + i * 1000;
      s.tick(at, files({ dev: devText((b += 3_000_000), b), ...mutate?.(i) }));
      s.addProbe('udp 1.1.1.1', at + 100, 10);
      s.addProbe('udp 8.8.8.8', at + 100, 14);
    }
    return s;
  }

  it('olaydaki 4 kullanıcı bir olay olur: ortak yol, kanıt ve saniyelik satırlar kaydedilir', async () => {
    const sampler = feedSampler(200);
    const events: string[] = [];
    const c = new FreezeCorrelator({ dir, sampler, onEvent: (e) => events.push(e.cause) });
    for (const e of incidentEntries()) c.observe(e);
    // Olay henüz açık: kapanmamış
    expect(c.list(0)).toHaveLength(0);
    c.sweep(T0 + 30_000 + 80_000);
    expect(events).toEqual(['ortak_yol']);
    const [ev] = c.list(0);
    expect(ev!.affected).toBe(4);
    expect(ev!.freezes).toBe(13);
    expect(ev!.streaming).toBe(true);
    expect(ev!.channelId).toBe('kanal');
    expect(ev!.server?.probeLossPct).toBe(0);
    expect(ev!.probe).toBe('temiz');
    await c.flushed();
    const rows = await c.rowsOf(ev!.id);
    expect(rows.length).toBeGreaterThan(30);
    expect(await c.rowsOf('yok-boyle-bir-id')).toEqual([]);
    // Yeniden açılışta olay dosyadan yüklenir
    const again = new FreezeCorrelator({ dir, sampler: null });
    expect(again.list(0).map((e) => e.id)).toEqual([ev!.id]);
  });

  it('tek sesli kullanıcının kaybı (yayın yok, tek kişi) olay açmaz; temiz özetler olay açmaz', () => {
    const c = new FreezeCorrelator({ dir: null, sampler: null });
    c.observe(entry('a', { lossOut: 15 }));
    c.observe(entry('b', {}));
    c.sweep(T0 + 200_000);
    expect(c.list(0)).toHaveLength(0);
    c.observe(entry('b', {}, T0 + 300_000));
    c.sweep(T0 + 500_000);
    expect(c.list(0)).toHaveLength(0);
  });

  it('yayın varken tek izleyicide kayıp olay açar (tek kullanıcı hattı); kanalsız özet yok sayılır', () => {
    const c = new FreezeCorrelator({ dir: null, sampler: null });
    c.observe(entry('yayinci', { screen: streamerScreen({ fps: 30 }) }));
    c.observe(entry('i1', { lossIn: 14, watch: watching(5) }));
    c.observe(entry('x', { channelId: null, lossOut: 50 }));
    c.sweep(T0 + 200_000);
    const list = c.list(0);
    expect(list).toHaveLength(1);
    expect(list[0]!.cause).toBe('tek_kullanici');
  });

  it('farklı kanallar ayrı olaylar; olay uzun sürerse 10 dk sonra bölünür', () => {
    const c = new FreezeCorrelator({ dir: null, sampler: null });
    c.observe(entry('a', { lossOut: 15, channelId: 'k1' }));
    c.observe(entry('b', { lossOut: 15, channelId: 'k1' }));
    c.observe(entry('c', { lossOut: 15, channelId: 'k2' }));
    c.observe(entry('d', { lossOut: 15, channelId: 'k2' }));
    c.sweep(T0 + 300_000);
    expect(c.list(0).map((e) => e.channelId).sort()).toEqual(['k1', 'k2']);
    const long = new FreezeCorrelator({ dir: null, sampler: null });
    for (let i = 0; i < 40; i++) {
      long.observe(entry('a', { lossOut: 15 }, T0 + i * 20_000));
      long.observe(entry('b', { lossOut: 15 }, T0 + i * 20_000));
    }
    long.sweep(T0 + 2_000_000);
    expect(long.list(0).length).toBeGreaterThanOrEqual(2);
  });
});
