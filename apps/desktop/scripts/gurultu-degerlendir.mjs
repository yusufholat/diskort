// Gürültü engelleyicileri çevrimdışı karşılaştırır: DeepFilterNet 3 (uygulamadaki worklet + df.wasm, aynen)
// ve DPDFNet (uygulamadaki dsp.js + onnxruntime-web wasm, aynen). Temiz konuşmaya gürültü karıştırır,
// her iki engelleyiciden geçirir, WAV'ları yazar ve ölçer:
//   - RTF: 10 ms'lik kare başına işleme süresi / 10 ms (tek çekirdek, wasm SIMD)
//   - SI-SDR (dB): temiz sese göre bozulma+kalan gürültü (yüksek = iyi)
//   - Duraklama gürültüsü (dBFS): konuşma başlamadan önceki kısımda kalan gürültü (düşük = iyi)
//   - DNSMOS P.835 SIG/BAK/OVRL (isteğe bağlı, --dnsmos sig_bak_ovr.onnx; Microsoft DNS-Challenge deposundan)
//
// Kullanım (apps/desktop içinden):
//   node scripts/gurultu-degerlendir.mjs --speech temiz.wav --out çıktı-klasörü
//        [--noise klavye=klavye.wav] [--noise ofis=ofis.wav] [--snr 5] [--dnsmos sig_bak_ovr.onnx] [--seconds 15]
// Gürültü dosyası verilmezse yapay "vantilatör" ve "klavye" gürültüleri üretilir. WAV: PCM16/float32,
// herhangi bir örnekleme hızı (48 kHz'e yüksek kaliteli yeniden örneklenir).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web/wasm';
import { DpdfnetDenoiser, HOP, readOnnxMetadata } from '../src/renderer/src/features/voice/dpdfnet/dsp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const voiceDir = path.join(here, '..', 'src', 'renderer', 'src', 'features', 'voice');
const SR = 48000;

// ---------- WAV ----------
export function readWav(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: WAV değil`);
  let pos = 12;
  let fmt = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
      if (fmt.format === 0xfffe) fmt.format = b.readUInt16LE(body + 24);
    } else if (id === 'data') {
      if (!fmt) throw new Error(`${file}: fmt yok`);
      const bytes = fmt.bits / 8;
      const frames = Math.floor(Math.min(size, b.length - body) / (bytes * fmt.channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const o = body + (i * fmt.channels + c) * bytes;
          if (fmt.format === 3) s += bytes === 4 ? b.readFloatLE(o) : b.readDoubleLE(o);
          else if (fmt.bits === 16) s += b.readInt16LE(o) / 32768;
          else if (fmt.bits === 24) s += b.readIntLE(o, 3) / 8388608;
          else if (fmt.bits === 32) s += b.readInt32LE(o) / 2147483648;
          else throw new Error(`${file}: ${fmt.bits} bit desteklenmiyor`);
        }
        out[i] = s / fmt.channels;
      }
      return { data: out, rate: fmt.rate };
    }
    pos = body + size + (size & 1);
  }
  throw new Error(`${file}: data yok`);
}

export function writeWav(file, data, rate = SR) {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  writeFileSync(file, b);
}

// ---------- Yeniden örnekleme (çok fazlı, Kaiser pencereli sinc; ~100 dB durdurma bandı) ----------
function besselI0(x) {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

export function resample(x, from, to) {
  if (from === to) return Float32Array.from(x);
  const g = gcd(from, to);
  const L = to / g;
  const M = from / g;
  const cutoff = 0.5 * Math.min(1, L / M) * 0.97; // giriş örneği başına döngü
  const half = Math.ceil(32 / Math.min(1, L / M)); // her yanda giriş örneği
  const beta = 10;
  const i0b = besselI0(beta);
  const taps = 2 * half;
  const table = new Float32Array(L * taps);
  for (let ph = 0; ph < L; ph++) {
    const frac = ph / L;
    for (let j = 0; j < taps; j++) {
      const t = j - half + 1 - frac; // giriş örneği - hedef zaman
      const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - (t / half) ** 2))) / i0b;
      const s = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
      table[ph * taps + j] = s * w;
    }
  }
  const n = Math.floor((x.length * L) / M);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * M;
    const base = Math.floor(pos / L);
    const ph = pos % L;
    let acc = 0;
    const off = ph * taps;
    for (let j = 0; j < taps; j++) {
      const k = base + j - half + 1;
      if (k >= 0 && k < x.length) acc += x[k] * table[off + j];
    }
    y[i] = acc;
  }
  return y;
}

// ---------- Yapay gürültüler ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

/** Vantilatör/bilgisayar fanı: kahverengi+pembe gürültü, yavaş dalgalanma ve 100 Hz uğultu harmonikleri. */
export function synthFan(n, seed = 1) {
  const r = rng(seed);
  const y = new Float32Array(n);
  let brown = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = gauss(r);
    brown = 0.995 * brown + 0.05 * w;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    const pink = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    const t = i / SR;
    const mod = 1 + 0.15 * Math.sin(2 * Math.PI * 0.7 * t);
    let hum = 0;
    for (let h = 1; h <= 5; h++) hum += Math.sin(2 * Math.PI * 100 * h * t + h) / h;
    y[i] = (brown + 0.5 * pink) * mod + 0.08 * hum;
  }
  return y;
}

/** Mekanik klavye: rastgele aralıklı, iki bileşenli (basma + bırakma) kısa tıkırtılar. */
export function synthKeyboard(n, seed = 2) {
  const r = rng(seed);
  const y = new Float32Array(n);
  let t = 0;
  while (t < n) {
    t += Math.floor(SR * (0.06 + r() * 0.22));
    for (const [delay, amp] of [[0, 1], [Math.floor(SR * (0.04 + r() * 0.05)), 0.6]]) {
      const start = t + delay;
      const f = 1500 + r() * 3500;
      const decay = 0.002 + r() * 0.004;
      const len = Math.floor(SR * 0.03);
      for (let i = 0; i < len && start + i < n; i++) {
        const tt = i / SR;
        y[start + i] += amp * Math.exp(-tt / decay) * (0.6 * gauss(r) + Math.sin(2 * Math.PI * f * tt));
      }
    }
  }
  return y;
}

// ---------- Ölçümler ----------
const rms = (x, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
const db = (v) => 20 * Math.log10(v + 1e-12);

/** Çıkışın girişe göre gecikmesi (örnek), çapraz ilinti ile. */
function findDelay(ref, y, maxLag = 6000) {
  let best = 0;
  let bestV = -Infinity;
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let s = 0;
    for (let i = 0; i + lag < y.length && i < ref.length; i += 4) s += ref[i] * y[i + lag];
    if (s > bestV) {
      bestV = s;
      best = lag;
    }
  }
  return best;
}

function siSdr(ref, est) {
  let dot = 0, rr = 0;
  for (let i = 0; i < ref.length; i++) {
    dot += ref[i] * est[i];
    rr += ref[i] * ref[i];
  }
  const a = dot / rr;
  let s = 0, e = 0;
  for (let i = 0; i < ref.length; i++) {
    const t = a * ref[i];
    s += t * t;
    e += (est[i] - t) ** 2;
  }
  return 10 * Math.log10(s / e);
}

async function dnsmos(sessionPromise, x48) {
  if (!sessionPromise) return null;
  const s = await sessionPromise;
  let x = resample(x48, SR, 16000);
  const len = Math.floor(9.01 * 16000);
  while (x.length < len) {
    const y = new Float32Array(x.length * 2);
    y.set(x);
    y.set(x, x.length);
    x = y;
  }
  const hops = Math.floor(x.length / 16000 - 9.01) + 1;
  const poly = (c, v) => c[0] * v * v + c[1] * v + c[2];
  let sig = 0, bak = 0, ovr = 0, n = 0;
  for (let h = 0; h < hops; h++) {
    const seg = x.slice(h * 16000, h * 16000 + len);
    if (seg.length < len) continue;
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', seg, [1, len]) });
    const [rs, rb, ro] = out[s.outputNames[0]].data;
    sig += poly([-0.08397278, 1.22083953, 0.0052439], rs);
    bak += poly([-0.13166888, 1.60915514, -0.39604546], rb);
    ovr += poly([-0.06766283, 1.11546468, 0.04602535], ro);
    n++;
  }
  return { sig: sig / n, bak: bak / n, ovr: ovr / n };
}

// ---------- Engelleyiciler ----------
/** Uygulamadaki DeepFilterNet worklet'ini sahte bir AudioWorklet ortamında aynen çalıştırır. */
async function makeDeepFilter(attenLimDb) {
  const registry = {};
  globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { messages: [], postMessage: (m) => this.port.messages.push(m), onmessage: null };
    }
  };
  globalThis.registerProcessor = (name, cls) => (registry[name] = cls);
  await import(pathToFileURL(path.join(voiceDir, 'deepfilter', 'deepfilter-worklet.js')).href + `?t=${Date.now()}`);
  const wasmModule = await WebAssembly.compile(readFileSync(path.join(voiceDir, 'deepfilter', 'df.wasm')));
  const modelBytes = readFileSync(path.join(voiceDir, 'deepfilter', 'DeepFilterNet3_onnx.bin'));
  const proc = new registry['diskort-deepfilter']({
    processorOptions: { wasmModule, modelBytes: modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.length), attenLimDb, postFilterBeta: 0 },
  });
  const ready = proc.port.messages.find((m) => m.type === 'ready');
  if (!ready) throw new Error(`DeepFilterNet kurulamadı: ${JSON.stringify(proc.port.messages)}`);
  return {
    name: `DeepFilterNet 3 (${attenLimDb} dB)`,
    async run(x) {
      const y = new Float32Array(x.length);
      const inB = new Float32Array(128);
      const outB = new Float32Array(128);
      let busy = 0;
      for (let i = 0; i + 128 <= x.length; i += 128) {
        inB.set(x.subarray(i, i + 128));
        const t0 = performance.now();
        proc.process([[inB]], [[outB]]);
        busy += performance.now() - t0;
        y.set(outB, i);
      }
      return { y, ms: busy / (x.length / HOP) };
    },
  };
}

async function makeDpdfnet(modelFile, attenLimDb) {
  const bytes = readFileSync(modelFile);
  const meta = readOnnxMetadata(bytes);
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return {
    name: `DPDFNet ${path.basename(modelFile, '.onnx')} (${attenLimDb >= 100 ? 'sınırsız' : `${attenLimDb} dB`})`,
    async run(x) {
      const den = new DpdfnetDenoiser(ort, session, meta, attenLimDb);
      const y = new Float32Array(x.length);
      const out = new Float32Array(HOP);
      const times = [];
      for (let i = 0; i + HOP <= x.length; i += HOP) {
        const t0 = performance.now();
        await den.processHop(x.subarray(i, i + HOP), out);
        times.push(performance.now() - t0);
        y.set(out, i);
      }
      const sorted = times.slice(50).sort((a, b) => a - b);
      return {
        y,
        ms: sorted.reduce((a, b) => a + b, 0) / sorted.length,
        p99: sorted[Math.floor(sorted.length * 0.99)],
        max: sorted[sorted.length - 1],
      };
    },
  };
}

// ---------- Ana akış ----------
function parseArgs(argv) {
  const a = { noise: [], snr: 5, seconds: 15, strengths: [24] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--speech') a.speech = v;
    else if (k === '--out') a.out = v;
    else if (k === '--noise') a.noise.push(v);
    else if (k === '--snr') a.snr = Number(v);
    else if (k === '--seconds') a.seconds = Number(v);
    else if (k === '--dnsmos') a.dnsmos = v;
    else if (k === '--model') a.model = v;
    else if (k === '--strengths') a.strengths = v.split(',').map(Number);
    else continue;
    i++;
  }
  if (!a.speech || !a.out) {
    console.error('Kullanım: node scripts/gurultu-degerlendir.mjs --speech temiz.wav --out klasör [--noise ad=dosya.wav] [--dnsmos sig_bak_ovr.onnx]');
    process.exit(1);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ort.env.wasm.numThreads = 1;
  mkdirSync(args.out, { recursive: true });
  const model = args.model ?? path.join(voiceDir, 'dpdfnet', 'dpdfnet2_48khz_hr.onnx');
  const dnsmosSession = args.dnsmos ? ort.InferenceSession.create(readFileSync(args.dnsmos)) : null;

  const sp = readWav(args.speech);
  const speech = resample(sp.data, sp.rate, SR);
  const segLen = Math.floor(args.seconds * SR);
  const lead = Math.floor(1.5 * SR); // başta yalnızca gürültü: duraklamalarda ne kaldığını ölçmek için

  const noises = [];
  for (const spec of args.noise) {
    const [name, file] = spec.split('=');
    const w = readWav(file);
    noises.push({ name, data: resample(w.data, w.rate, SR) });
  }
  if (!noises.some((n) => /klavye|keyboard|typing/i.test(n.name))) noises.push({ name: 'klavye-yapay', data: synthKeyboard(segLen) });
  noises.push({ name: 'fan-yapay', data: synthFan(segLen) });

  const processors = [];
  for (const s of args.strengths) processors.push({ key: `dfn${s}`, p: await makeDeepFilter(s) });
  for (const s of args.strengths) processors.push({ key: `dpdfnet${s}`, p: await makeDpdfnet(model, s) });
  processors.push({ key: 'dpdfnet-sinirsiz', p: await makeDpdfnet(model, 100) });

  const rows = [];
  let speechPos = 0;
  for (const noise of noises) {
    // Sahne: [lead: yalnız gürültü][konuşma]; her sahne konuşmanın farklı bir bölümünü kullanır
    const clean = new Float32Array(segLen);
    const take = Math.min(segLen - lead, speech.length - speechPos);
    clean.set(speech.subarray(speechPos, speechPos + take), lead);
    speechPos = (speechPos + take) % Math.max(1, speech.length - segLen);
    const nz = new Float32Array(segLen);
    for (let i = 0; i < segLen; i++) nz[i] = noise.data[i % noise.data.length];
    const gain = rms(clean, lead) / (rms(nz, lead) * 10 ** (args.snr / 20));
    const noisy = new Float32Array(segLen);
    let peak = 0;
    for (let i = 0; i < segLen; i++) {
      noisy[i] = clean[i] + gain * nz[i];
      peak = Math.max(peak, Math.abs(noisy[i]));
    }
    const norm = peak > 0.95 ? 0.95 / peak : 1;
    for (let i = 0; i < segLen; i++) {
      noisy[i] *= norm;
      clean[i] *= norm;
    }
    writeWav(path.join(args.out, `${noise.name}_0_gurultulu.wav`), noisy);
    rows.push({ scene: noise.name, proc: 'gürültülü giriş', ...(await measure(clean, noisy, 0, lead, dnsmosSession)) });

    let idx = 1;
    for (const { key, p } of processors) {
      const r = await p.run(noisy);
      const delay = findDelay(clean, r.y);
      writeWav(path.join(args.out, `${noise.name}_${idx++}_${key}.wav`), r.y);
      const m = await measure(clean, r.y, delay, lead, dnsmosSession);
      rows.push({ scene: noise.name, proc: p.name, delayMs: (delay / 48).toFixed(1), msPerFrame: r.ms.toFixed(3), p99: r.p99?.toFixed(3), ...m });
    }
  }
  console.table(rows);
  writeFileSync(path.join(args.out, 'sonuclar.json'), JSON.stringify(rows, null, 2));
}

async function measure(clean, y, delay, lead, dnsmosSession) {
  const n = clean.length - delay;
  const aligned = y.subarray(delay, delay + n);
  const ref = clean.subarray(0, n);
  const refSpeech = ref.subarray(lead);
  const estSpeech = aligned.subarray(lead);
  const mos = await dnsmos(dnsmosSession, y.subarray(delay));
  return {
    siSdr: siSdr(refSpeech, estSpeech).toFixed(2),
    pauseDbfs: db(rms(aligned, Math.floor(0.3 * SR), lead - 2400)).toFixed(1),
    ...(mos ? { SIG: mos.sig.toFixed(2), BAK: mos.bak.toFixed(2), OVRL: mos.ovr.toFixed(2) } : {}),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
