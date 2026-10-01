// Sunucu makinesinin ağ sayaçları: /proc ayrıştırıcıları ve iki okuma arasındaki hızlar. API kapsayıcısı host
// ağında çalıştığından /proc/net/dev ve /proc/net/snmp makinenin gerçek sayaçlarıdır. Sayaçları tek bir
// örnekleyici okur (netSeconds.ts SecondSampler, saniyede bir); panelin 15 sn'lik geçmişi ve dakikalık özetler
// de oradan türetilir.

/** /proc/net/dev: bir arayüzün sayaçları */
export interface NetDevCounters {
  rxBytes: number;
  rxPackets: number;
  rxErrs: number;
  rxDrop: number;
  txBytes: number;
  txPackets: number;
  txErrs: number;
  txDrop: number;
}

/** /proc/net/snmp "Udp:" satırı */
export interface UdpCounters {
  inDatagrams: number;
  inErrors: number;
  outDatagrams: number;
  rcvbufErrors: number;
  sndbufErrors: number;
  /** Dinleyeni olmayan porta gelen datagram (NoPorts) ve sağlama toplamı hatası; çekirdek vermiyorsa 0 */
  noPorts: number;
  inCsumErrors: number;
}

/** Bir anda okunan ham sayaçlar */
export interface HostNetCounters {
  at: number;
  iface: string;
  dev: NetDevCounters;
  /** /proc/net/snmp okunamadıysa null */
  udp: UdpCounters | null;
}

/** İki okuma arasındaki hızlar (saniyede); sayaç geri gittiyse (sıfırlandıysa) ilgili alan null */
export interface HostNetSample {
  at: number;
  iface: string;
  rxMbps: number | null;
  txMbps: number | null;
  rxPps: number | null;
  txPps: number | null;
  rxDropPerSec: number | null;
  rxErrPerSec: number | null;
  udpInPerSec: number | null;
  udpOutPerSec: number | null;
  udpInErrPerSec: number | null;
  udpRcvbufErrPerSec: number | null;
  udpSndbufErrPerSec: number | null;
}

const finite = (n: number): boolean => Number.isFinite(n);

/** /proc/net/dev: arayüz adı → sayaçlar */
export function parseNetDevDetailed(text: string): Record<string, NetDevCounters> {
  const result: Record<string, NetDevCounters> = {};
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    const f = line.slice(colon + 1).trim().split(/\s+/).map(Number);
    if (!name || name.includes('|') || f.length < 10) continue;
    // rx: bayt paket hata düşen ... (0-7); tx: bayt paket ... (8-)
    const dev: NetDevCounters = {
      rxBytes: f[0]!,
      rxPackets: f[1]!,
      rxErrs: f[2]!,
      rxDrop: f[3]!,
      txBytes: f[8]!,
      txPackets: f[9]!,
      txErrs: f[10]!,
      txDrop: f[11]!,
    };
    if (Object.values(dev).every(finite)) result[name] = dev;
  }
  return result;
}

/**
 * /proc/net/route: varsayılan yolun (hedef ve maske 0.0.0.0, ayakta) arayüzü; birden çoksa en düşük
 * metrik. Bulunamazsa null.
 */
export function parseDefaultRouteInterface(text: string): string | null {
  let best: { iface: string; metric: number } | null = null;
  for (const line of text.split('\n').slice(1)) {
    const c = line.trim().split(/\s+/);
    const [iface, destination, , flags, , , metric, mask] = c;
    if (!iface || destination !== '00000000' || mask !== '00000000') continue;
    const f = Number.parseInt(flags ?? '1', 16);
    if (Number.isFinite(f) && (f & 1) === 0) continue; // RTF_UP yok
    const m = Number(metric);
    const rank = Number.isFinite(m) ? m : 0;
    if (!best || rank < best.metric) best = { iface, metric: rank };
  }
  return best?.iface ?? null;
}

/** /proc/net/route: varsayılan yolun ağ geçidi (IPv4, noktalı); bulunamazsa null. Adres küçük-endian onaltılıktır. */
export function parseDefaultGateway(text: string): string | null {
  let best: { gw: string; metric: number } | null = null;
  for (const line of text.split('\n').slice(1)) {
    const c = line.trim().split(/\s+/);
    const [iface, destination, gateway, flags, , , metric, mask] = c;
    if (!iface || destination !== '00000000' || mask !== '00000000' || !gateway || !/^[0-9A-Fa-f]{8}$/.test(gateway)) continue;
    const f = Number.parseInt(flags ?? '1', 16);
    if (Number.isFinite(f) && (f & 1) === 0) continue;
    if (gateway === '00000000') continue; // doğrudan bağlı yol: ağ geçidi yok
    const m = Number(metric);
    const rank = Number.isFinite(m) ? m : 0;
    if (!best || rank < best.metric) {
      const b = [6, 4, 2, 0].map((i) => Number.parseInt(gateway.slice(i, i + 2), 16));
      best = { gw: b.join('.'), metric: rank };
    }
  }
  return best?.gw ?? null;
}

/** /proc/net/snmp içindeki "Udp:" başlık + değer satırı çifti (UdpLite: ayrı sayılır) */
export function parseSnmpUdp(text: string): UdpCounters | null {
  const rows = text.split('\n').filter((l) => l.startsWith('Udp:'));
  if (rows.length < 2) return null;
  const names = rows[0]!.trim().split(/\s+/).slice(1);
  const values = rows[1]!.trim().split(/\s+/).slice(1).map(Number);
  const get = (name: string): number | null => {
    const i = names.indexOf(name);
    const v = i >= 0 ? values[i] : undefined;
    return v !== undefined && Number.isFinite(v) ? v : null;
  };
  const inDatagrams = get('InDatagrams');
  const outDatagrams = get('OutDatagrams');
  if (inDatagrams === null || outDatagrams === null) return null;
  return {
    inDatagrams,
    outDatagrams,
    inErrors: get('InErrors') ?? 0,
    rcvbufErrors: get('RcvbufErrors') ?? 0,
    sndbufErrors: get('SndbufErrors') ?? 0,
    noPorts: get('NoPorts') ?? 0,
    inCsumErrors: get('InCsumErrors') ?? 0,
  };
}

/** /proc dosyalarının metninden bir okuma; arayüz bulunamazsa ya da okunamazsa null */
export function readHostNet(
  files: { dev: string | null; route: string | null; snmp: string | null },
  at: number,
): HostNetCounters | null {
  if (!files.dev || !files.route) return null;
  const iface = parseDefaultRouteInterface(files.route);
  if (!iface) return null;
  const dev = parseNetDevDetailed(files.dev)[iface];
  if (!dev) return null;
  return { at, iface, dev, udp: files.snmp ? parseSnmpUdp(files.snmp) : null };
}

/** İki okumadan hızlar; arayüz değiştiyse ya da süre geçmediyse null */
export function hostNetSample(cur: HostNetCounters, prev: HostNetCounters): HostNetSample | null {
  const dt = (cur.at - prev.at) / 1000;
  if (dt <= 0 || cur.iface !== prev.iface) return null;
  // Sayaç geri gittiyse (sıfırlanma / yeniden başlatma) o alan için hız bilinmez
  const rate = (c: number | undefined, p: number | undefined, scale = 1): number | null =>
    c === undefined || p === undefined || c < p ? null : ((c - p) / dt) * scale;
  const mbps = 8 / 1_000_000;
  return {
    at: cur.at,
    iface: cur.iface,
    rxMbps: rate(cur.dev.rxBytes, prev.dev.rxBytes, mbps),
    txMbps: rate(cur.dev.txBytes, prev.dev.txBytes, mbps),
    rxPps: rate(cur.dev.rxPackets, prev.dev.rxPackets),
    txPps: rate(cur.dev.txPackets, prev.dev.txPackets),
    rxDropPerSec: rate(cur.dev.rxDrop, prev.dev.rxDrop),
    rxErrPerSec: rate(cur.dev.rxErrs, prev.dev.rxErrs),
    udpInPerSec: rate(cur.udp?.inDatagrams, prev.udp?.inDatagrams),
    udpOutPerSec: rate(cur.udp?.outDatagrams, prev.udp?.outDatagrams),
    udpInErrPerSec: rate(cur.udp?.inErrors, prev.udp?.inErrors),
    udpRcvbufErrPerSec: rate(cur.udp?.rcvbufErrors, prev.udp?.rcvbufErrors),
    udpSndbufErrPerSec: rate(cur.udp?.sndbufErrors, prev.udp?.sndbufErrors),
  };
}
