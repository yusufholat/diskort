// Ses kapısı (voice activity gate) + bas-konuş için AudioWorklet işlemcisi.
// Her 128 örneklik blokta seviyeyi ölçer, eşik/PTT durumuna göre kazancı yumuşakça açıp kapatır
// ve arayüze ~20 Hz ile seviye bilgisi gönderir. Zamanlayıcı kullanmadığı için arka planda da hassastır.

const ATTACK_S = 0.004;
const RELEASE_S = 0.06;
const REPORT_INTERVAL_S = 0.05;

class DiskortGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = 'vad'; // 'vad' | 'ptt' | 'open'
    this.auto = true;
    this.threshold = -50;
    this.holdMs = 350;
    this.ptt = false;
    this.gain = 0;
    this.lastAboveS = -1;
    this.noiseFloor = -65;
    this.peakDb = -100;
    this.lastReportS = 0;
    this.gains = new Float32Array(128);
    this.attackCoef = 1 - Math.exp(-1 / (sampleRate * ATTACK_S));
    this.releaseCoef = 1 - Math.exp(-1 / (sampleRate * RELEASE_S));
    this.port.onmessage = (e) => Object.assign(this, e.data);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !input[0]) {
      for (const ch of output) ch.fill(0);
      return true;
    }

    const ch0 = input[0];
    let sum = 0;
    for (let i = 0; i < ch0.length; i++) sum += ch0[i] * ch0[i];
    const rms = Math.sqrt(sum / ch0.length);
    const db = rms > 1e-6 ? 20 * Math.log10(rms) : -100;

    // Uyarlanabilir gürültü tabanı: hızlı iner, yavaş yükselir.
    const k = db < this.noiseFloor ? 0.02 : 0.0004;
    this.noiseFloor += (db - this.noiseFloor) * k;
    const threshold = this.auto ? Math.min(-30, Math.max(-62, this.noiseFloor + 9)) : this.threshold;

    let open;
    if (this.mode === 'ptt') {
      open = this.ptt;
    } else if (this.mode === 'open') {
      open = true;
    } else {
      if (db >= threshold) this.lastAboveS = currentTime;
      open = this.lastAboveS >= 0 && currentTime - this.lastAboveS < this.holdMs / 1000;
    }

    const target = open ? 1 : 0;
    const n = ch0.length;
    if (this.gains.length < n) this.gains = new Float32Array(n);
    let g = this.gain;
    for (let i = 0; i < n; i++) {
      g += (target - g) * (target > g ? this.attackCoef : this.releaseCoef);
      this.gains[i] = g;
    }
    this.gain = g;

    for (let c = 0; c < output.length; c++) {
      const inp = input[c] || ch0;
      const out = output[c];
      for (let i = 0; i < out.length; i++) out[i] = inp[i] * this.gains[i];
    }

    if (db > this.peakDb) this.peakDb = db;
    if (currentTime - this.lastReportS >= REPORT_INTERVAL_S) {
      this.port.postMessage({ db: this.peakDb, threshold, open });
      this.peakDb = -100;
      this.lastReportS = currentTime;
    }
    return true;
  }
}

registerProcessor('diskort-gate', DiskortGateProcessor);
