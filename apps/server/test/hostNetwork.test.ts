import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HostNetworkLog,
  hostNetSample,
  MinuteSummarizer,
  parseDefaultRouteInterface,
  parseNetDevDetailed,
  parseSnmpUdp,
  readHostNet,
  summarizeMinute,
  type HostNetCounters,
  type HostNetSample,
} from '../src/hostNetwork.js';
import { InfraMonitor, LiveKitMetrics } from '../src/infraStats.js';

// Ana makine ağ geçmişi: /proc ayrıştırma, hızlar (sayaç sıfırlanması dahil), dakikalık özet ve dosya.

const NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:  500000    5000    0    0    0     0          0         0   500000    5000    0    0    0     0       0          0
docker0:       0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0
 ens192:1000000000 2000000    3   40    0     0          0         0 2000000000 3000000    0    0    0     0       0          0
`;

const NET_ROUTE = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
ens192\t00000000\t0100A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0
ens192\t0000A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0
docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0
`;

const NET_SNMP = `Ip: Forwarding DefaultTTL InReceives
Ip: 1 64 999
Udp: InDatagrams NoPorts InErrors OutDatagrams RcvbufErrors SndbufErrors InCsumErrors IgnoredMulti MemErrors
Udp: 1000 7 20 2000 15 4 0 1 0
UdpLite: InDatagrams NoPorts InErrors OutDatagrams RcvbufErrors SndbufErrors InCsumErrors IgnoredMulti MemErrors
UdpLite: 0 0 0 0 0 0 0 0 0
`;

function counters(at: number, over: Partial<HostNetCounters['dev']> = {}, udp: Partial<NonNullable<HostNetCounters['udp']>> | null = {}): HostNetCounters {
  return {
    at,
    iface: 'ens192',
    dev: { rxBytes: 0, rxPackets: 0, rxErrs: 0, rxDrop: 0, txBytes: 0, txPackets: 0, ...over },
    udp: udp === null ? null : { inDatagrams: 0, inErrors: 0, outDatagrams: 0, rcvbufErrors: 0, sndbufErrors: 0, ...udp },
  };
}

describe('/proc ayrıştırma', () => {
  it('/proc/net/dev: bitişik sayılar dahil arayüz sayaçları', () => {
    const dev = parseNetDevDetailed(NET_DEV);
    expect(Object.keys(dev)).toEqual(['lo', 'docker0', 'ens192']);
    expect(dev.ens192).toEqual({ rxBytes: 1_000_000_000, rxPackets: 2_000_000, rxErrs: 3, rxDrop: 40, txBytes: 2_000_000_000, txPackets: 3_000_000 });
    expect(parseNetDevDetailed('')).toEqual({});
  });

  it('/proc/net/route: varsayılan yolun arayüzü (en düşük metrik, ayakta olan)', () => {
    expect(parseDefaultRouteInterface(NET_ROUTE)).toBe('ens192');
    const two = `${NET_ROUTE}wlan0\t00000000\t0100A8C0\t0003\t0\t0\t50\t00000000\t0\t0\t0\n`;
    expect(parseDefaultRouteInterface(two)).toBe('wlan0');
    const down = `Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\nens192\t00000000\t0100A8C0\t0002\t0\t0\t0\t00000000\n`;
    expect(parseDefaultRouteInterface(down)).toBeNull();
    expect(parseDefaultRouteInterface('')).toBeNull();
  });

  it('/proc/net/snmp: Udp satırı (UdpLite karışmaz)', () => {
    expect(parseSnmpUdp(NET_SNMP)).toEqual({ inDatagrams: 1000, outDatagrams: 2000, inErrors: 20, rcvbufErrors: 15, sndbufErrors: 4 });
    expect(parseSnmpUdp('Ip: a b\nIp: 1 2\n')).toBeNull();
    expect(parseSnmpUdp('')).toBeNull();
  });

  it('readHostNet: arayüz yoksa ya da dosya okunamadıysa null', () => {
    const got = readHostNet({ dev: NET_DEV, route: NET_ROUTE, snmp: NET_SNMP }, 5);
    expect(got).toMatchObject({ at: 5, iface: 'ens192', udp: { inDatagrams: 1000 } });
    expect(readHostNet({ dev: NET_DEV, route: NET_ROUTE, snmp: null }, 5)?.udp).toBeNull();
    expect(readHostNet({ dev: null, route: NET_ROUTE, snmp: NET_SNMP }, 5)).toBeNull();
    expect(readHostNet({ dev: NET_DEV, route: null, snmp: NET_SNMP }, 5)).toBeNull();
    expect(readHostNet({ dev: 'lo: 1 1 0 0 0 0 0 0 1 1 0 0 0 0 0 0\n', route: NET_ROUTE, snmp: NET_SNMP }, 5)).toBeNull();
  });
});

describe('hızlar', () => {
  it('Mbps, paket/sn, düşen/sn ve UDP hızları', () => {
    const prev = counters(1_000_000, {}, {});
    const cur = counters(1_010_000, { rxBytes: 12_500_000, txBytes: 25_000_000, rxPackets: 10_000, txPackets: 20_000, rxDrop: 50, rxErrs: 10 }, { inDatagrams: 5_000, outDatagrams: 8_000, inErrors: 30, rcvbufErrors: 20, sndbufErrors: 10 });
    expect(hostNetSample(cur, prev)).toEqual({
      at: 1_010_000,
      iface: 'ens192',
      rxMbps: 10,
      txMbps: 20,
      rxPps: 1000,
      txPps: 2000,
      rxDropPerSec: 5,
      rxErrPerSec: 1,
      udpInPerSec: 500,
      udpOutPerSec: 800,
      udpInErrPerSec: 3,
      udpRcvbufErrPerSec: 2,
      udpSndbufErrPerSec: 1,
    });
  });

  it('sayaç geri giderse (sıfırlanma) yalnızca o alan null olur', () => {
    const prev = counters(0, { rxBytes: 5_000_000, rxDrop: 100, txBytes: 1_000_000 }, { inDatagrams: 100 });
    const cur = counters(10_000, { rxBytes: 10, rxDrop: 3, txBytes: 2_250_000 }, { inDatagrams: 50 });
    const s = hostNetSample(cur, prev)!;
    expect(s.rxMbps).toBeNull();
    expect(s.rxDropPerSec).toBeNull();
    expect(s.udpInPerSec).toBeNull();
    expect(s.txMbps).toBe(1);
  });

  it('snmp okunamadıysa UDP alanları null; arayüz değiştiyse ya da süre geçmediyse örnek yok', () => {
    const s = hostNetSample(counters(10_000, {}, null), counters(0, {}, null))!;
    expect(s.udpInPerSec).toBeNull();
    expect(s.udpRcvbufErrPerSec).toBeNull();
    expect(s.rxMbps).toBe(0);
    expect(hostNetSample({ ...counters(10_000), iface: 'eth1' }, counters(0))).toBeNull();
    expect(hostNetSample(counters(5, {}), counters(5, {}))).toBeNull();
  });
});

describe('dakikalık özet', () => {
  const sample = (at: number, over: Partial<HostNetSample> = {}): HostNetSample => ({ ...base(at), ...over });
  const base = (at: number): HostNetSample => ({
    at,
    iface: 'ens192',
    rxMbps: 1,
    txMbps: 2,
    rxPps: 10,
    txPps: 10,
    rxDropPerSec: 0,
    rxErrPerSec: 0,
    udpInPerSec: 10,
    udpOutPerSec: 10,
    udpInErrPerSec: 0,
    udpRcvbufErrPerSec: 0,
    udpSndbufErrPerSec: 0,
  });

  it('en yüksekler ve UDP hata toplamları', () => {
    const t0 = Date.UTC(2026, 8, 28, 18, 3, 0);
    const list = [
      sample(t0 + 5_000, { rxMbps: 8.126, txMbps: 3, rxDropPerSec: 0.5, udpInErrPerSec: 2, udpRcvbufErrPerSec: 1 }),
      sample(t0 + 20_000, { rxMbps: 4, txMbps: 16.4, rxDropPerSec: 4, udpInErrPerSec: 2, udpRcvbufErrPerSec: 2, udpSndbufErrPerSec: 1 }),
      sample(t0 + 35_000, { rxMbps: null, txMbps: null, rxDropPerSec: null, udpInErrPerSec: null }),
    ];
    expect(summarizeMinute(t0, list, [15, 15, 15])).toEqual({
      at: t0,
      t: '2026-09-28T18:03:00.000Z',
      iface: 'ens192',
      n: 3,
      rxMbpsMax: 8.13,
      txMbpsMax: 16.4,
      dropMax: 4,
      udpInErr: 60,
      udpRcvbufErr: 45,
      udpSndbufErr: 15,
    });
    expect(summarizeMinute(t0, [sample(t0, { rxMbps: null, txMbps: null, rxDropPerSec: null })], [15])).toMatchObject({ rxMbpsMax: null, dropMax: null });
  });

  it('MinuteSummarizer: dakika değişince bir önceki dakikanın özetini verir', () => {
    const t0 = Date.UTC(2026, 8, 28, 18, 3, 0);
    const sm = new MinuteSummarizer();
    expect(sm.push(sample(t0 + 10_000, { rxMbps: 5 }))).toBeNull();
    expect(sm.push(sample(t0 + 25_000, { rxMbps: 9 }))).toBeNull();
    expect(sm.push(sample(t0 + 55_000, { rxMbps: 7 }))).toBeNull();
    const done = sm.push(sample(t0 + 70_000, { rxMbps: 1 }));
    expect(done).toMatchObject({ at: t0, n: 3, rxMbpsMax: 9 });
    expect(sm.push(sample(t0 + 130_000))).toMatchObject({ at: t0 + 60_000, n: 1, rxMbpsMax: 1 });
  });
});

describe('HostNetworkLog ve InfraMonitor', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diskort-ag-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const s = (at: number, rxDropPerSec: number) => ({
    at,
    iface: 'ens192',
    rxMbps: 1,
    txMbps: 1,
    rxPps: 1,
    txPps: 1,
    rxDropPerSec,
    rxErrPerSec: 0,
    udpInPerSec: 1,
    udpOutPerSec: 1,
    udpInErrPerSec: 0,
    udpRcvbufErrPerSec: 0,
    udpSndbufErrPerSec: 0,
  });

  it('dakikada bir satır ekler (network-<gün>.jsonl), eski günleri siler, telemetri günlerine dokunmaz', async () => {
    const dir = path.join(tmp, 'telemetry');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'network-2026-01-01.jsonl'), 'eski\n');
    fs.writeFileSync(path.join(dir, '2026-01-01.jsonl'), 'telemetri\n');
    const log = new HostNetworkLog(dir, 0, 14);
    const t0 = Date.UTC(2026, 8, 28, 18, 3, 0);
    await log.add(s(t0 + 10_000, 1));
    await log.add(s(t0 + 40_000, 6));
    await log.add(s(t0 + 70_000, 0));
    await log.add(s(t0 + 130_000, 0));
    const lines = fs.readFileSync(path.join(dir, 'network-2026-09-28.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ at: t0, n: 2, dropMax: 6 });
    expect(lines[1]).toMatchObject({ at: t0 + 60_000, n: 1, dropMax: 0 });
    expect(fs.existsSync(path.join(dir, 'network-2026-01-01.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '2026-01-01.jsonl'))).toBe(true);
  });

  it('klasör yoksa (null) yalnızca bellekte kalır, hata vermez', async () => {
    const log = new HostNetworkLog(null, 0);
    await log.add(s(0, 0));
    await log.add(s(120_000, 0));
  });

  it('InfraMonitor: sahte /proc ile hızlar geçmişe girer; /proc yoksa ağ bilgisi yok der', async () => {
    const proc = path.join(tmp, 'proc');
    fs.mkdirSync(path.join(proc, 'net'), { recursive: true });
    fs.writeFileSync(path.join(proc, 'net/route'), NET_ROUTE);
    fs.writeFileSync(path.join(proc, 'net/snmp'), NET_SNMP);
    const dev = (rx: number, drop: number): string =>
      `Inter-|   Receive\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n ens192: ${rx} 100 0 ${drop} 0 0 0 0 ${rx} 100 0 0 0 0 0 0\n`;
    fs.writeFileSync(path.join(proc, 'net/dev'), dev(0, 0));
    const lk = new LiveKitMetrics({ url: null });
    const opts = { cgroupRoot: path.join(tmp, 'yok'), caddyMetricsUrl: null, backupDir: null, tlsDomains: [], tlsHost: '127.0.0.1' };
    const infra = new InfraMonitor({ ...opts, procRoot: proc, networkDir: path.join(tmp, 'telemetry'), offsetMin: 0 }, lk);
    await infra.sample(1_000_000);
    expect((await infra.snapshot(1_000_000)).network).toMatchObject({ ok: true, iface: 'ens192', history: [] });
    fs.writeFileSync(path.join(proc, 'net/dev'), dev(12_500_000, 50));
    await infra.sample(1_010_000);
    const net = (await infra.snapshot(1_010_000)).network;
    expect(net.history).toHaveLength(1);
    expect(net.history[0]).toMatchObject({ rxMbps: 10, txMbps: 10, rxDropPerSec: 5 });

    const missing = new InfraMonitor({ ...opts, procRoot: path.join(tmp, 'yok-proc') }, lk);
    await missing.sample(1_000_000);
    expect((await missing.snapshot(1_000_000)).network).toMatchObject({ ok: false, iface: null, history: [] });
    const off = new InfraMonitor(opts, lk);
    await off.sample(1_000_000);
    expect((await off.snapshot(1_000_000)).network).toMatchObject({ ok: false, error: 'ağ ölçümü kapalı' });
  });
});
