// DPDFNet için AudioWorklet köprüsü. Model burada değil, ayrı bir Worker'da (dpdfnet.worker.ts) çalışır:
// bu işlemci yalnızca 128'lik ses bloklarını 480'lik (10 ms) karelere toplayıp Worker'a yollar ve dönen
// temiz sesi bir halka tampondan çalar. Ses iş parçacığında kare başına iş birkaç mikrosaniyedir; modelin
// yavaş bir karesi ses bloğunun süresini (2,67 ms) aşsa bile ses iş parçacığı beklemez.
//
// Tampon: (kare − ebob(128, kare)) = 448 örnek hizalama + 480 örnek (10 ms) Worker payı. Worker bir kareyi
// 10 ms'den geç döndürürse boşluk (underrun) olur: sessizlik çalınır, pay bir blok artırılıp tampon yeniden
// doldurulur (en fazla 3 kare). Sayaçlar 'stats' iletisiyle ana tarafa bildirilir.

const BLOCK = 128;
const HOP = 480;
const REPORT_INTERVAL_S = 2;
const ALIGN = HOP - 32; // kare − ebob(128, 480)
const MAX_EXTRA = 3 * HOP;

const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

class DiskortDpdfnetProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.extra = o.extraBufferSamples ?? HOP;
    this.ring = new Float32Array(8192);
    this.readPos = 0;
    this.writePos = 0;
    this.playing = false;
    this.hop = new Float32Array(HOP);
    this.fill = 0;
    this.pool = [];
    this.worker = null;
    this.inFlight = 0;
    this.underruns = 0;
    this.dropped = 0;
    this.maxBlockMs = 0;
    this.lastReportS = currentTime;

    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'connect') {
        this.worker = e.data.port;
        this.worker.onmessage = (m) => this.onOutput(m.data);
      }
    };
  }

  get target() {
    return ALIGN + this.extra;
  }

  available() {
    return (this.writePos - this.readPos + this.ring.length) % this.ring.length;
  }

  onOutput(buf) {
    this.inFlight--;
    const size = this.ring.length;
    for (let i = 0; i < buf.length; i++) {
      this.ring[this.writePos] = buf[i];
      this.writePos = (this.writePos + 1) % size;
    }
    this.pool.push(buf);
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const t0 = now();
    const input = inputs[0] && inputs[0][0];
    const ch0 = out[0];
    const n = ch0.length;

    if (!this.worker) {
      // Worker bağlanana kadar ses olduğu gibi geçer (kurulum bitmeden zincire bağlanmaz, yine de güvenli)
      if (input) ch0.set(input);
      else ch0.fill(0);
    } else {
      for (let i = 0; i < n; i++) {
        this.hop[this.fill++] = input ? input[i] : 0;
        if (this.fill === HOP) {
          this.fill = 0;
          this.worker.postMessage(this.hop, [this.hop.buffer]);
          this.inFlight++;
          this.hop = this.pool.pop() || new Float32Array(HOP);
        }
      }

      const size = this.ring.length;
      let avail = this.available();
      // Worker takılıp sonra birden çok kare döndürdüyse gecikme büyümesin: fazlası atılır
      if (this.playing && avail > this.target + HOP + BLOCK) {
        const drop = avail - this.target;
        this.readPos = (this.readPos + drop) % size;
        this.dropped += drop;
        avail -= drop;
      }
      if (!this.playing && avail >= this.target) this.playing = true;
      if (this.playing) {
        const take = Math.min(n, avail);
        for (let i = 0; i < take; i++) {
          ch0[i] = this.ring[this.readPos];
          this.readPos = (this.readPos + 1) % size;
        }
        if (take < n) {
          ch0.fill(0, take);
          this.underruns++;
          this.playing = false;
          this.extra = Math.min(MAX_EXTRA, this.extra + BLOCK);
        }
      } else {
        ch0.fill(0);
      }
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);

    const dt = now() - t0;
    if (dt > this.maxBlockMs) this.maxBlockMs = dt;
    if (currentTime - this.lastReportS >= REPORT_INTERVAL_S) {
      this.port.postMessage({
        type: 'stats',
        underruns: this.underruns,
        droppedSamples: this.dropped,
        bufferMs: (this.target / sampleRate) * 1000,
        maxBlockMs: this.maxBlockMs,
      });
      this.maxBlockMs = 0;
      this.lastReportS = currentTime;
    }
    return true;
  }
}

registerProcessor('diskort-dpdfnet', DiskortDpdfnetProcessor);
