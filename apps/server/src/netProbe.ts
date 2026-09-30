import dgram from 'node:dgram';
import net from 'node:net';
import { GATEWAY_LABEL } from './netSeconds.js';

// Yayın donması tanısı: sunucudan dış hedeflere etkin sondalar. Amaç: istemcilerde aynı anda paket kaybı
// olduğunda sunucunun sağlayıcı yolunda da kayıp/gecikme var mıydı? (Varsa sorun VPS/sağlayıcı ağında;
// yoksa kayıp medya akışına özgü ya da istemci tarafı ortak bir noktada.)
//
// Yöntem (yalnızca Node, yerel bağımlılık ve ek yetki yok):
// - ICMP ping kullanılmaz: node:24-slim imajında `ping` yok, ham soket CAP_NET_RAW ister.
// - UDP: kök alanı için 1.1.1.1 / 8.8.8.8'e 53. porttan DNS sorgusu (NS .), yanıt gelene kadar süre = RTT.
//   Sorunlar UDP medya akışında görüldüğü için UDP sondası en ilgili olanıdır; her sonda yeni bir kaynak
//   portundan çıkar (durağan bir akışa takılı kalmaz).
// - TCP: 1.1.1.1:443 bağlantı kurma süresi (SYN → SYN/ACK); kayıp = zaman aşımı.
// - Ağ geçidi (/proc/net/route'tan): TCP 80'e bağlantı denemesi; yanıt olarak "bağlantı reddedildi" de sayılır.
//   Ağ geçitleri çoğu zaman yanıt vermez: hiç yanıt gelmezse sonda kendini kapatır ve kayıp yargısına katılmaz.

export interface ProbeTarget {
  label: string;
  kind: 'udp' | 'tcp';
  host: string;
  port: number;
}

export const DEFAULT_PROBE_TARGETS: ProbeTarget[] = [
  { label: 'udp 1.1.1.1', kind: 'udp', host: '1.1.1.1', port: 53 },
  { label: 'udp 8.8.8.8', kind: 'udp', host: '8.8.8.8', port: 53 },
  { label: 'tcp 1.1.1.1', kind: 'tcp', host: '1.1.1.1', port: 443 },
];

/** "udp:1.1.1.1:53,tcp:1.1.1.1:443" biçimli ayarı hedeflere çevirir; geçersiz parçalar atılır */
export function parseProbeTargets(spec: string | undefined): ProbeTarget[] | null {
  if (spec === undefined || spec.trim() === '') return null;
  if (spec.trim() === '0') return [];
  const out: ProbeTarget[] = [];
  for (const part of spec.split(',')) {
    const m = /^(udp|tcp):([0-9a-fA-F.:]+):(\d{1,5})$/.exec(part.trim());
    if (!m) continue;
    const port = Number(m[3]);
    if (port < 1 || port > 65535) continue;
    out.push({ label: `${m[1]} ${m[2]}`, kind: m[1] as 'udp' | 'tcp', host: m[2]!, port });
  }
  return out;
}

/** Kök alanı için NS sorgusu (12 baytlık başlık + "." adı + tür NS + sınıf IN) */
export function dnsQuery(id: number): Buffer {
  const b = Buffer.alloc(17);
  b.writeUInt16BE(id, 0);
  b.writeUInt16BE(0x0100, 2); // RD
  b.writeUInt16BE(1, 4); // QDCOUNT
  // b[12] = 0 (kök adı); tür NS=2, sınıf IN=1
  b.writeUInt16BE(2, 13);
  b.writeUInt16BE(1, 15);
  return b;
}

/** UDP DNS sondası: yanıt gelirse RTT (ms), gelmezse null */
export function probeUdp(host: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 0xffff);
    const socket = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
    const start = process.hrtime.bigint();
    let done = false;
    const finish = (v: number | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // zaten kapalı
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on('message', (msg) => {
      if (msg.length >= 2 && msg.readUInt16BE(0) === id) finish(Number(process.hrtime.bigint() - start) / 1e6);
    });
    socket.on('error', () => finish(null));
    socket.send(dnsQuery(id), port, host, (err) => {
      if (err) finish(null);
    });
  });
}

/** TCP bağlantı sondası: bağlanırsa (reddedilse de, yanıt sayılır) süre (ms), zaman aşımında null */
export function probeTcp(host: string, port: number, timeoutMs: number, refusedCounts = false): Promise<number | null> {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (v: number | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(v);
    };
    const elapsed = (): number => Number(process.hrtime.bigint() - start) / 1e6;
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on('connect', () => finish(elapsed()));
    socket.on('error', (err: NodeJS.ErrnoException) => finish(refusedCounts && err.code === 'ECONNREFUSED' ? elapsed() : null));
  });
}

export interface ProbeRunnerOptions {
  targets: ProbeTarget[];
  /** Her hedefe gönderim aralığı (ms) */
  intervalMs?: number;
  timeoutMs?: number;
  /** Ağ geçidi adresi (her turda sorulur: yol değişebilir); null: ağ geçidi sondası yok */
  gateway?: () => string | null;
  /** Sonuç: gönderilme anı, hedef etiketi, RTT (null: yanıt yok) */
  onResult: (label: string, sentAt: number, rttMs: number | null) => void;
  /** Testler: gerçek ağ yerine */
  run?: (target: ProbeTarget, timeoutMs: number) => Promise<number | null>;
}

/** Hedefleri aralığa yayarak (aynı anda değil) sürekli yoklar */
export class ProbeRunner {
  private timers: NodeJS.Timeout[] = [];
  private gwTimer: NodeJS.Timeout | null = null;
  private gwSent = 0;
  private gwReplied = 0;
  gatewayDisabled = false;

  constructor(private readonly opts: ProbeRunnerOptions) {}

  private get interval(): number {
    return this.opts.intervalMs ?? 2_000;
  }

  private get timeout(): number {
    return this.opts.timeoutMs ?? 1_000;
  }

  start(): void {
    if (this.timers.length > 0 || this.gwTimer) return;
    const n = this.opts.targets.length;
    this.opts.targets.forEach((target, i) => {
      const begin = setTimeout(() => {
        const t = setInterval(() => void this.once(target), this.interval);
        t.unref();
        this.timers.push(t);
        void this.once(target);
      }, (i * this.interval) / Math.max(1, n + 1));
      begin.unref();
      this.timers.push(begin);
    });
    if (this.opts.gateway) {
      this.gwTimer = setInterval(() => void this.gatewayOnce(), this.interval * 2);
      this.gwTimer.unref();
    }
  }

  stop(): void {
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
    if (this.gwTimer) clearInterval(this.gwTimer);
    this.gwTimer = null;
  }

  /** Bir hedefi yoklar ve sonucu bildirir (testler doğrudan çağırır) */
  async once(target: ProbeTarget, sentAt = Date.now()): Promise<number | null> {
    const rtt = await (this.opts.run ?? defaultRun)(target, this.timeout).catch(() => null);
    this.opts.onResult(target.label, sentAt, rtt);
    return rtt;
  }

  async gatewayOnce(sentAt = Date.now()): Promise<void> {
    const host = this.opts.gateway?.() ?? null;
    if (!host || this.gatewayDisabled) return;
    const target: ProbeTarget = { label: GATEWAY_LABEL, kind: 'tcp', host, port: 80 };
    const rtt = await (this.opts.run ?? gatewayRun)(target, this.timeout).catch(() => null);
    this.gwSent++;
    if (rtt !== null) this.gwReplied++;
    // İlk 15 denemede hiç yanıt yoksa ağ geçidi yoklamaya yanıt vermiyor: kapat
    if (this.gwSent >= 15 && this.gwReplied === 0) {
      this.gatewayDisabled = true;
      return;
    }
    this.opts.onResult(target.label, sentAt, rtt);
  }
}

const defaultRun = (t: ProbeTarget, timeoutMs: number): Promise<number | null> =>
  t.kind === 'udp' ? probeUdp(t.host, t.port, timeoutMs) : probeTcp(t.host, t.port, timeoutMs);
const gatewayRun = (t: ProbeTarget, timeoutMs: number): Promise<number | null> => probeTcp(t.host, t.port, timeoutMs, true);
