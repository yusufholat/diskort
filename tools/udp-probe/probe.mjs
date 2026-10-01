#!/usr/bin/env node
// Diskort hat testi aracı: LiveKit'ten bağımsız olarak bilgisayar <-> sunucu UDP yolunu ölçer.
// Yalnızca Node (>= 18) gerekir, ek paket yok. Kullanım: README.md
//
// Bu dosya hem komut satırı aracı hem de masaüstü uygulamasının "Hat testi" düğmesinin motorudur
// (runSuite). Protokol: apps/server/src/lineTest/protocol.ts ile aynı; uyumluluk sunucu testlerinde denenir.

import dgram from 'node:dgram';
import dns from 'node:dns';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_SERVER = 'https://diskort.ziroo.net';
export const TOOL_VERSION = '1';

// ---------- Protokol ----------
const MAGIC = 0x444b;
const VERSION = 1;
const T_HELLO = 1;
const T_CHALLENGE = 2;
const T_START = 3;
const T_READY = 4;
const T_UP = 5;
const T_DOWN = 6;
const HEADER = 8;
const DATA_HEADER = 20;
const COOKIE_LEN = 8;

export function encodeHello(sid, token) {
  const body = Buffer.from(token, 'ascii');
  const b = Buffer.alloc(HEADER + body.length);
  b.writeUInt16BE(MAGIC, 0);
  b.writeUInt8(VERSION, 2);
  b.writeUInt8(T_HELLO, 3);
  b.writeUInt32BE(sid >>> 0, 4);
  body.copy(b, HEADER);
  return b;
}

export function encodeStart(sid, cookie, token) {
  const body = Buffer.from(token, 'ascii');
  const b = Buffer.alloc(HEADER + COOKIE_LEN + body.length);
  b.writeUInt16BE(MAGIC, 0);
  b.writeUInt8(VERSION, 2);
  b.writeUInt8(T_START, 3);
  b.writeUInt32BE(sid >>> 0, 4);
  cookie.copy(b, HEADER);
  body.copy(b, HEADER + COOKIE_LEN);
  return b;
}

export function encodeData(type, sid, size, seq, step, ts) {
  const b = Buffer.alloc(Math.max(DATA_HEADER, size));
  b.writeUInt16BE(MAGIC, 0);
  b.writeUInt8(VERSION, 2);
  b.writeUInt8(type, 3);
  b.writeUInt32BE(sid >>> 0, 4);
  b.writeUInt32BE(seq >>> 0, 8);
  b.writeUInt8(step & 0xff, 12);
  b.writeUInt32BE(ts >>> 0, 14);
  return b;
}

// ---------- Plan ve sayım ----------
export function cumulative(seconds) {
  const out = [0];
  for (const s of seconds) out.push(out[out.length - 1] + s.pps);
  return out;
}

export function dueCount(seconds, cum, tMs) {
  if (tMs < 0) return 0;
  const s = Math.floor(tMs / 1000);
  if (s >= seconds.length) return cum[seconds.length];
  const p = seconds[s];
  const frac = (tMs - s * 1000) / 1000;
  let n;
  if (p.fps > 0) {
    const bursts = Math.min(p.fps, Math.floor(frac * p.fps) + 1);
    n = Math.ceil((p.pps * bursts) / p.fps);
  } else {
    n = Math.floor(p.pps * frac);
  }
  return cum[s] + Math.min(p.pps, n);
}

export class LossCounter {
  constructor(plan) {
    const total = plan.reduce((n, s) => n + s.pps, 0);
    this.secOf = new Uint16Array(total);
    let i = 0;
    plan.forEach((s, sec) => {
      for (let k = 0; k < s.pps; k++) this.secOf[i++] = sec;
    });
    this.seen = new Uint8Array(total);
    this.seconds = plan.map((p) => ({ planned: p.pps, recv: 0, lost: 0, reord: 0, dup: 0, bytes: 0, jit: 0 }));
    this.maxSeq = -1;
    this.transit = null;
    this.jitter = 0;
  }

  onPacket(seq, size, ts, arrivalMs) {
    const sec = this.secOf[seq];
    if (sec === undefined) return;
    const s = this.seconds[sec];
    if (this.seen[seq]) {
      s.dup++;
      return;
    }
    this.seen[seq] = 1;
    s.recv++;
    s.bytes += size;
    if (seq < this.maxSeq) s.reord++;
    else this.maxSeq = seq;
    const transit = arrivalMs - ts;
    if (this.transit !== null) this.jitter += (Math.abs(transit - this.transit) - this.jitter) / 16;
    this.transit = transit;
    s.jit = Math.max(s.jit, this.jitter);
  }

  finish() {
    return this.seconds.map((s) => ({ ...s, lost: Math.max(0, s.planned - s.recv), jit: Math.round(s.jit * 100) / 100 }));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ---------- HTTP ----------
async function api(server, path, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(new URL(path, server), {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // gövde yok
  }
  if (!res.ok) {
    const err = new Error(data?.message ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Sunucu saatine göre yerel saat farkı (ms) ve gidiş-dönüş süresi: en kısa gidiş-dönüşlü örnek seçilir */
export async function measureClock(server, samples = 6) {
  let best = null;
  for (let i = 0; i < samples; i++) {
    const t0 = now();
    const { now: srv } = await api(server, '/api/line-test/time');
    const t1 = now();
    const rtt = t1 - t0;
    if (!best || rtt < best.rtt) best = { rtt, offset: srv - (t0 + rtt / 2) };
    await sleep(120);
  }
  return { offsetMs: Math.round(best.offset), rttMs: best.rtt };
}

// ---------- UDP aşaması ----------
function lookup4(host) {
  return new Promise((resolve, reject) => dns.lookup(host, { family: 4 }, (err, addr) => (err ? reject(err) : resolve(addr))));
}

async function runUdp({ host, session, onSecond, signal }) {
  const { sid, token, port, plan } = session;
  const address = await lookup4(host);
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve) => socket.bind(0, resolve));
  const waiters = { challenge: null, ready: null };
  const counter = plan.mode === 'up' ? null : new LossCounter(plan.seconds);
  let running = false;
  let t0 = 0;
  socket.on('message', (msg) => {
    if (msg.length < HEADER || msg.readUInt16BE(0) !== MAGIC) return;
    const type = msg.readUInt8(3);
    if (type === T_CHALLENGE && waiters.challenge) waiters.challenge(Buffer.from(msg.subarray(HEADER, HEADER + COOKIE_LEN)));
    else if (type === T_READY && waiters.ready) waiters.ready();
    else if (type === T_DOWN && counter && running && msg.length >= DATA_HEADER) {
      counter.onPacket(msg.readUInt32BE(8), msg.length, msg.readUInt32BE(14), now());
    }
  });
  const handshake = async (name, send) => {
    for (let i = 0; i < 8; i++) {
      const p = new Promise((resolve) => {
        waiters[name] = resolve;
      });
      socket.send(send(), port, address);
      const got = await Promise.race([p, sleep(450).then(() => null)]);
      if (got !== null) return got;
    }
    return null;
  };
  try {
    const cookie = await handshake('challenge', () => encodeHello(sid, token));
    if (!cookie) return { ok: false, reason: 'HELLO yanıtsız', down: null };
    // Aşağı yön sayımı START'tan itibaren (sunucu READY'den önce de göndermeye başlayabilir)
    running = true;
    const ready = await handshake('ready', () => encodeStart(sid, cookie, token));
    if (ready === null) return { ok: false, reason: 'START yanıtsız', down: null };
    t0 = now();
    const sendUp = plan.mode !== 'down';
    const cum = cumulative(plan.seconds);
    let sent = 0;
    let lastSec = -1;
    while (true) {
      const t = now() - t0;
      if (signal?.aborted) break;
      if (sendUp) {
        const due = dueCount(plan.seconds, cum, t);
        let n = Math.min(due - sent, 600);
        while (n-- > 0) {
          const seq = sent++;
          // seq'in saniyesi/adımı: plan saniyesine göre ara (artan sıra; imleç)
          let sec = Math.min(plan.seconds.length - 1, Math.floor(t / 1000));
          while (sec > 0 && cum[sec] > seq) sec--;
          while (sec < plan.seconds.length - 1 && cum[sec + 1] <= seq) sec++;
          const p = plan.seconds[sec];
          socket.send(encodeData(T_UP, sid, p.size, seq, p.step, t), port, address);
        }
      }
      const sec = Math.floor(t / 1000);
      if (sec !== lastSec && sec < plan.seconds.length) {
        lastSec = sec;
        onSecond?.(sec, plan.seconds.length);
      }
      if (t >= plan.durationMs + 1500) break;
      await sleep(sent < cum[cum.length - 1] || !sendUp ? 1 : 25);
    }
    await sleep(700);
    return { ok: true, down: counter ? counter.finish() : null };
  } finally {
    running = false;
    socket.close();
  }
}

// ---------- TCP aşaması (HTTPS üzerinden, karşılaştırma için) ----------
async function runTcp({ server, session, onSecond, signal }) {
  const { token, plan } = session;
  const headers = { 'x-line-token': token };
  const perSec = plan.seconds.map((p) => p.pps * p.size);
  const t0 = now();
  const tasks = [];
  let down = null;
  if (plan.mode !== 'up') {
    down = new Array(plan.seconds.length).fill(0);
    tasks.push(
      (async () => {
        const res = await fetch(new URL('/api/line-test/tcp/down', server), { headers, signal: signal ?? AbortSignal.timeout(plan.durationMs + 15_000) });
        if (!res.ok) throw new Error(`TCP aşağı: HTTP ${res.status}`);
        const reader = res.body.getReader();
        const start = now();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const sec = Math.floor((now() - start) / 1000);
          if (sec < down.length) down[sec] += value.length;
        }
      })(),
    );
  }
  if (plan.mode !== 'down') {
    const chunk = Buffer.alloc(16 * 1024, 0x5a);
    // Sıkıştırılamaz gibi görünsün diye rastgele doldurulur
    for (let i = 0; i < chunk.length; i += 4) chunk.writeUInt32LE((Math.random() * 0xffffffff) >>> 0, i);
    const body = new ReadableStream({
      async start(controller) {
        const start = now();
        let written = 0;
        for (;;) {
          const t = now() - start;
          if (t >= plan.durationMs || signal?.aborted) break;
          const s = Math.floor(t / 1000);
          let target = 0;
          for (let i = 0; i < s; i++) target += perSec[i];
          target += Math.floor((perSec[s] * (t - s * 1000)) / 1000);
          while (written < target) {
            const n = Math.min(chunk.length, target - written);
            controller.enqueue(chunk.subarray(0, n));
            written += n;
          }
          await sleep(20);
        }
        controller.close();
      },
    });
    tasks.push(
      fetch(new URL('/api/line-test/tcp/up', server), {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        body,
        duplex: 'half',
        signal: signal ?? AbortSignal.timeout(plan.durationMs + 15_000),
      }).then((r) => {
        if (!r.ok) throw new Error(`TCP yukarı: HTTP ${r.status}`);
      }),
    );
  }
  const ticker = setInterval(() => {
    const sec = Math.floor((now() - t0) / 1000);
    if (sec < plan.seconds.length) onSecond?.(sec, plan.seconds.length);
  }, 1000);
  try {
    await Promise.all(tasks);
  } finally {
    clearInterval(ticker);
  }
  return { ok: true, tcpDown: down };
}

// ---------- Bağlam ----------
export function localIpKind() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.internal || i.family !== 'IPv4') continue;
      const [a, b] = i.address.split('.').map(Number);
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
      if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
      if (a === 169 && b === 254) continue;
      return 'public';
    }
  }
  return 'unknown';
}

export function runTracert(host, seconds = 60) {
  const win = process.platform === 'win32';
  return new Promise((resolve) => {
    const child = spawn(win ? 'tracert' : 'traceroute', win ? ['-d', '-h', '20', '-w', '1500', host] : ['-n', '-m', '20', '-w', '2', host], { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill(), seconds * 1000);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(''));
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out.slice(0, 7900));
    });
  });
}

export function baseContext(extra = {}) {
  return {
    os: `${os.type()} ${os.release()}`.slice(0, 80),
    arch: os.arch(),
    node: process.versions.node,
    tool: TOOL_VERSION,
    localIp: localIpKind(),
    ...extra,
  };
}

// ---------- Paket ----------
export const SUITES = {
  // Tam: bitrate eşiği (iki yön ayrı), paket/sn, yayın benzeri, TCP karşılaştırması
  tam: [
    { profile: 'ramp', mode: 'down', label: 'Hız basamakları: sunucu -> bilgisayar (aşağı)' },
    { profile: 'ramp', mode: 'up', label: 'Hız basamakları: bilgisayar -> sunucu (yukarı)' },
    { profile: 'pps', mode: 'both', label: 'Küçük paketler (paket/sn sınırı), iki yön' },
    { profile: 'steady', mode: 'both', label: 'Yayın benzeri 8 Mbps, iki yön aynı anda' },
    { profile: 'ramp', mode: 'both', transport: 'tcp', label: 'TCP karşılaştırması (HTTPS)' },
  ],
  hizli: [{ profile: 'quick', mode: 'both', label: 'Kısa hat testi (iki yön)' }],
};

/**
 * Bir paketi sırayla çalıştırır. auth: { token } (Diskort hesap jetonu) ya da { code, name }.
 * onEvent: { type: 'phase-start' | 'second' | 'phase-done' | 'note' | 'phase-error', ... }
 * Döner: { suite, phases: [{ phase, result | error }] }
 */
export async function runSuite({ server = DEFAULT_SERVER, auth, phases, suite, client = {}, onEvent = () => {}, signal }) {
  const host = new URL(server).hostname;
  const suiteId = suite ?? `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const out = [];
  let clock = {};
  try {
    clock = await measureClock(server, 3);
  } catch {
    // saat ölçülemedi: önemli değil
  }
  const ctx = { ...baseContext(), ...client, ...(clock.rttMs !== undefined ? { clockOffsetMs: clock.offsetMs, rttMs: clock.rttMs } : {}) };
  for (let i = 0; i < phases.length; i++) {
    const ph = phases[i];
    if (signal?.aborted) break;
    const transport = ph.transport ?? 'udp';
    onEvent({ type: 'phase-start', index: i, total: phases.length, label: ph.label ?? ph.profile, transport, profile: ph.profile, mode: ph.mode });
    try {
      const session = await api(server, '/api/line-test/session', {
        method: 'POST',
        headers: auth.token ? { authorization: `Bearer ${auth.token}` } : {},
        body: { profile: ph.profile, mode: ph.mode, transport, ...(auth.code ? { code: auth.code, name: auth.name } : {}) },
      });
      onEvent({ type: 'plan', index: i, session });
      const progress = (sec, total) => onEvent({ type: 'second', index: i, sec, total, step: session.plan.seconds[sec]?.step ?? 0 });
      let down = null;
      let tcpDown = null;
      let note;
      let udpFailed = false;
      if (transport === 'udp') {
        const r = await runUdp({ host, session, onSecond: progress, signal });
        down = r.down;
        if (!r.ok) {
          note = `UDP el sıkışması başarısız: ${r.reason}`;
          udpFailed = true;
        }
      } else {
        const r = await runTcp({ server, session, onSecond: progress, signal });
        tcpDown = r.tcpDown;
      }
      const result = await api(server, '/api/line-test/finish', {
        method: 'POST',
        headers: { 'x-line-token': session.token },
        body: {
          suite: suiteId,
          ...(down ? { down } : {}),
          ...(udpFailed ? { udpFailed: true } : {}),
          ...(tcpDown ? { tcpDown } : {}),
          client: { ...ctx, ...(note ? { note } : {}) },
        },
      });
      const done = { ...result, session, down, tcpDown, note };
      out.push({ phase: ph, result: done });
      onEvent({ type: 'phase-done', index: i, total: phases.length, result: done, phase: ph });
    } catch (err) {
      out.push({ phase: ph, error: err.message });
      onEvent({ type: 'phase-error', index: i, total: phases.length, error: err.message, status: err.status });
      if (err.status === 401 || err.status === 503) break;
    }
  }
  return { suite: suiteId, phases: out };
}

// ---------- Komut satırı ----------
const fmtMbps = (bps) => `${(bps / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} Mbps`;
const pad = (s, n) => String(s).padEnd(n);

function printSteps(title, stats, plan) {
  if (!stats) return;
  console.log(`  ${title}`);
  console.log(`    ${pad('Adım', 22)}${pad('Kayıp', 9)}${pad('Sırasız', 9)}${pad('Sapma', 10)}Gelen/planlanan`);
  for (const s of stats) {
    const flag = s.lossPct >= 2 ? '  <-- KAYIP' : s.lossPct >= 1 ? '  <-- hafif' : '';
    console.log(`    ${pad(s.label, 22)}${pad(`%${s.lossPct}`, 9)}${pad(`%${s.reordPct}`, 9)}${pad(`${s.jitMs} ms`, 10)}${s.recv}/${s.planned}${flag}`);
  }
}

function tcpLines(title, secs, plan) {
  if (!secs) return;
  console.log(`  ${title}`);
  for (const st of plan.steps) {
    let got = 0;
    let target = 0;
    for (let s = st.startSec; s < st.startSec + st.secs; s++) {
      got += Math.min(secs[s] ?? 0, st.pps * st.size);
      target += st.pps * st.size;
    }
    console.log(`    ${pad(st.label, 22)}ulaşılan %${target ? Math.round((got / target) * 100) : 0}`);
  }
}

function parseArgs(argv) {
  const a = { server: DEFAULT_SERVER, suite: 'tam', tcp: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--server') a.server = v();
    else if (k === '--token') a.token = v();
    else if (k === '--kod' || k === '--code') a.code = v();
    else if (k === '--ad' || k === '--name') a.name = v();
    else if (k === '--at') a.at = v();
    else if (k === '--hizli') a.suite = 'hizli';
    else if (k === '--tcp-yok') a.tcp = false;
    else if (k === '--tracert') a.tracert = true;
    else if (k === '--json') a.json = true;
    else if (k === '--yardim' || k === '--help' || k === '-h') a.help = true;
  }
  return a;
}

const HELP = `Diskort hat testi
  node probe.mjs --kod KOD --ad ADIN            (yöneticiden aldığın test koduyla)
  node probe.mjs --token HESAP_JETONU           (Diskort hesabınla)
Seçenekler:
  --server URL     sunucu (varsayılan ${DEFAULT_SERVER})
  --at SS:DD:SN    belirli saatte başla (birkaç kişi aynı anda test etsin diye)
  --hizli          yalnızca kısa test (~12 sn)
  --tcp-yok        TCP karşılaştırmasını atla
  --tracert        sonda yol izleme (tracert) de ekle (servis sağlayıcıya destek talebi için)
  --json           sonucu JSON olarak da yaz`;

async function waitUntil(server, hhmmss) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmmss ?? '');
  if (!m) throw new Error('--at SS:DD:SN biçiminde olmalı (ör. 21:30:00)');
  const { offsetMs, rttMs } = await measureClock(server);
  const target = new Date();
  target.setHours(Number(m[1]), Number(m[2]), Number(m[3] ?? 0), 0);
  // Sunucu saatine göre hizala: yerel hedef = istenen an - saat farkı
  const localTarget = target.getTime() - offsetMs;
  const wait = localTarget - now();
  if (wait < -5000) throw new Error('Belirtilen saat geçmiş.');
  console.log(`Saat farkı: ${offsetMs} ms (gidiş-dönüş ${rttMs} ms). ${hhmmss} saatini bekliyorum (${Math.max(0, Math.round(wait / 1000))} sn)...`);
  while (now() < localTarget - 50) await sleep(Math.min(1000, Math.max(1, localTarget - now() - 20)));
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || (!a.token && !a.code)) {
    console.log(HELP);
    process.exit(a.help ? 0 : 1);
  }
  if (a.code && !a.name) {
    console.error('Test koduyla birlikte adını da yaz: --ad ADIN');
    process.exit(1);
  }
  if (a.at) await waitUntil(a.server, a.at);
  let phases = SUITES[a.suite];
  if (!a.tcp) phases = phases.filter((p) => p.transport !== 'tcp');
  const host = new URL(a.server).hostname;
  console.log(`\nDiskort hat testi · ${new Date().toLocaleString('tr-TR')} · ${host}`);
  console.log('Test sürerken tarayıcı, indirme ya da video açık olmasın; Wi-Fi yerine mümkünse kabloyu kullan.\n');
  const client = a.tracert ? { tracert: await runTracert(host) } : {};
  let last = null;
  const all = [];
  const res = await runSuite({
    server: a.server,
    auth: a.token ? { token: a.token } : { code: a.code, name: a.name },
    phases,
    client,
    onEvent: (e) => {
      if (e.type === 'phase-start') console.log(`\n=== Aşama ${e.index + 1}/${e.total}: ${e.label} ===`);
      else if (e.type === 'plan' && e.session.streamLive) console.log('  (Şu an bir kanalda canlı yayın var; sonuç "yayın açıkken" diye kaydedilir.)');
      else if (e.type === 'second') process.stdout.write(`\r  ${e.sec + 1}/${e.total} sn`);
      else if (e.type === 'phase-done') {
        process.stdout.write('\r                \r');
        const r = e.result;
        if (r.note) console.log(`  !! ${r.note}`);
        const plan = r.session.plan;
        if (r.stats) {
          printSteps('Yukarı (bilgisayar -> sunucu), sunucu ölçtü:', r.stats.up, plan);
          printSteps('Aşağı (sunucu -> bilgisayar), bu bilgisayar ölçtü:', r.stats.down, plan);
        }
        tcpLines('TCP yukarı:', r.tcpUp, plan);
        tcpLines('TCP aşağı:', r.tcpDown, plan);
        last = r;
        all.push(r);
      } else if (e.type === 'phase-error') console.log(`\n  HATA: ${e.error}`);
    },
  });
  console.log('\n================ SONUÇ ================');
  const findings = last?.findings ?? [];
  if (findings.length === 0) console.log('Yorum üretilemedi (ölçüm eksik).');
  for (const f of findings) {
    const mark = { bad: '[SORUN]', warn: '[DİKKAT]', ok: '[TEMİZ]', info: '[BİLGİ]' }[f.tone] ?? '';
    console.log(`${mark} ${f.text}`);
    if (f.evidence) console.log(`        ${f.evidence}`);
  }
  console.log(`\nSonuçlar yönetim paneline yüklendi (test no: ${res.suite}). Bu ekranın görüntüsünü de paylaşabilirsin.`);
  if (a.json) console.log(JSON.stringify(all.map((r) => ({ runId: r.runId, stats: r.stats, findings: r.findings })), null, 1));
}

// Yalnızca doğrudan `node probe.mjs` ile çalışınca (masaüstü uygulamasına gömülünce çalışmaz)
if (process.argv[1] && basename(process.argv[1]) === 'probe.mjs' && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nHata: ${err.message}`);
    process.exit(1);
  });
}
