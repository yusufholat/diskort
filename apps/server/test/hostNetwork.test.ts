import { describe, expect, it } from 'vitest';
import { hostNetSample, parseDefaultRouteInterface, parseNetDevDetailed, parseSnmpUdp, readHostNet, type HostNetCounters } from '../src/hostNetwork.js';

// Ana makine ağ sayaçları: /proc ayrıştırma ve hızlar (sayaç sıfırlanması dahil). Dakikalık özet ve 15 sn'lik
// geçmiş tek örnekleyiciden türetilir (bkz. netDiagnosis.test.ts).

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
    dev: { rxBytes: 0, rxPackets: 0, rxErrs: 0, rxDrop: 0, txBytes: 0, txPackets: 0, txErrs: 0, txDrop: 0, ...over },
    udp: udp === null ? null : { inDatagrams: 0, inErrors: 0, outDatagrams: 0, rcvbufErrors: 0, sndbufErrors: 0, noPorts: 0, inCsumErrors: 0, ...udp },
  };
}

describe('/proc ayrıştırma', () => {
  it('/proc/net/dev: bitişik sayılar dahil arayüz sayaçları', () => {
    const dev = parseNetDevDetailed(NET_DEV);
    expect(Object.keys(dev)).toEqual(['lo', 'docker0', 'ens192']);
    expect(dev.ens192).toEqual({ rxBytes: 1_000_000_000, rxPackets: 2_000_000, rxErrs: 3, rxDrop: 40, txBytes: 2_000_000_000, txPackets: 3_000_000, txErrs: 0, txDrop: 0 });
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
    expect(parseSnmpUdp(NET_SNMP)).toEqual({ inDatagrams: 1000, outDatagrams: 2000, inErrors: 20, rcvbufErrors: 15, sndbufErrors: 4, noPorts: 7, inCsumErrors: 0 });
    // Eski çekirdek: InCsumErrors sütunu yoksa 0
    expect(parseSnmpUdp('Udp: InDatagrams NoPorts InErrors OutDatagrams RcvbufErrors SndbufErrors\nUdp: 1 2 3 4 5 6\n')).toMatchObject({ noPorts: 2, inCsumErrors: 0 });
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
