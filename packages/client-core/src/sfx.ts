// Arayüz sesleri: tek tanım, iki çalıcı. Masaüstü bu dosyadaki renderSound() ile sesi bellekte üretip
// Web Audio ile çalar (apps/desktop/src/renderer/src/lib/sfx.ts); telefon aynı işlevle önceden yazılmış
// WAV dosyalarını çalar (apps/mobile/scripts/generate-sounds.mjs → assets/sounds/*.wav). İkisi de aynı
// örnekleri ürettiği için sesler birebir aynıdır.
//
// Bu dosya bilerek hiçbir şey içe aktarmaz ve yalnızca silinebilir TypeScript sözdizimi kullanır: Node
// (tür soyma ile) üretici betikten doğrudan yükleyebilsin.
//
// Tasarım: hepsi Re majör pentatonikte (D E F# A B). Kendi katılman / sesi açman / yayına başlaman
// yükselir, ayrılman / susturman / yayını bitirmen iner; aynı olayın başkası için olanı (biri girdi,
// biri yayına başladı) daha kısa, biraz daha kısık ve daha "cam" tınılıdır. Tını: hafif FM'li sinüs
// (parlaklık notanın başında, hızla söner: yumuşak bir çekiç sesi), yumuşak başlangıç (4–8 ms),
// üstel sönüm, küçük bir yankı kuyruğu. Tepe seviyesi -12 dBFS, algılanan seviyeler eşitlenir.

export const SOUND_NAMES = [
  'join',
  'leave',
  'userJoin',
  'userLeave',
  'mute',
  'unmute',
  'deafen',
  'undeafen',
  'streamStart',
  'streamStop',
  'userStreamStart',
  'userStreamStop',
  'mention',
  'disconnect',
  'reconnected',
  'pttOn',
  'pttOff',
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

/** Ayarlardaki ses listesi (dinleme düğmeleri) için adlar */
export const SOUND_LABELS: Record<SoundName, string> = {
  join: 'Ses kanalına katıldın',
  leave: 'Ses kanalından ayrıldın',
  userJoin: 'Biri kanala girdi',
  userLeave: 'Biri kanaldan çıktı',
  mute: 'Susturuldun',
  unmute: 'Mikrofon açıldı',
  deafen: 'Sağırlaştırıldın',
  undeafen: 'Sağırlaştırma kalktı',
  streamStart: 'Yayına başladın',
  streamStop: 'Yayını bitirdin',
  userStreamStart: 'Biri yayına başladı',
  userStreamStop: 'Birinin yayını bitti',
  mention: 'Bahsedilme / direkt mesaj',
  disconnect: 'Bağlantı koptu',
  reconnected: 'Bağlantı geri geldi',
  pttOn: 'Bas-konuş: basıldı',
  pttOff: 'Bas-konuş: bırakıldı',
};

/**
 * Başkalarıyla ilgili kanal sesleri: sağırlaştırılmışken çalınmaz (kanalı duymak istemiyorsun).
 * Kendi işlemlerinin sesleri (sustur, ayrıl…) sağırken de çalınır; yaptığın işin geri bildirimi.
 */
export const OTHERS_SOUNDS: ReadonlySet<SoundName> = new Set<SoundName>([
  'userJoin',
  'userLeave',
  'userStreamStart',
  'userStreamStop',
]);

/** Hazır seslerin örnekleme hızı (telefondaki WAV dosyaları da bu hızda) */
export const SFX_SAMPLE_RATE = 48000;
/** Her sesin tepe seviyesi (dBFS); çalarken kullanıcının "Ses efektleri" seviyesiyle çarpılır */
export const SFX_PEAK_DBFS = -12;

/** Tını: FM oranı ve parlaklığı (notanın başındaki FM derinliği) */
interface Timbre {
  ratio: number;
  index: number;
  /** İkinci harmoniğin payı */
  h2: number;
}

const TIMBRES = {
  /** Sıcak, yumuşak çekiç: kendi katıl/ayrıl, sağırlaştır */
  warm: { ratio: 1, index: 0.9, h2: 0.1 },
  /** Cam: başkalarının olayları */
  glass: { ratio: 2, index: 0.65, h2: 0.06 },
  /** Çan: bildirim ve yayın */
  bell: { ratio: 3.5, index: 0.8, h2: 0.08 },
  /** Neredeyse saf sinüs: sustur/aç, bas-konuş */
  soft: { ratio: 1, index: 0.35, h2: 0.05 },
} satisfies Record<string, Timbre>;

interface Tone {
  /** MIDI nota numarası (69 = La4 = 440 Hz) */
  note: number;
  /** Başlangıç (ms) */
  at: number;
  /** Notanın -40 dB'e sönme süresi (ms) */
  dur: number;
  /** Göreli seviye (varsayılan 1) */
  gain?: number;
}

interface SoundSpec {
  tones: Tone[];
  timbre: keyof typeof TIMBRES;
  /** Başlangıç süresi (ms) */
  attack: number;
  /** Başta çok kısa, süzülmüş bir gürültü "tık"ı (dokunma hissi) */
  tick?: number;
  /** Alçak geçiren süzgeç (Hz): boğuk ses */
  lowpass?: number;
  /** Yankı kuyruğunun payı (0: yok) */
  echo: number;
  /** Algılanan seviyeye göre ek ayar (dB); başkalarının olayları biraz kısık */
  trimDb: number;
}

// Re majör pentatonik: D E F# A B
const D4 = 62;
const B4 = 71;
const D5 = 74;
const E5 = 76;
const Fs5 = 78;
const A5 = 81;
const B5 = 83;
const D6 = 86;
const E6 = 88;

const SOUNDS: Record<SoundName, SoundSpec> = {
  // Beşli yukarı + hafif oktav parıltısı: "içerdesin"
  join: {
    tones: [
      { note: D5, at: 0, dur: 260 },
      { note: A5, at: 90, dur: 380 },
      { note: D6, at: 90, dur: 220, gain: 0.18 },
    ],
    timbre: 'warm',
    attack: 8,
    echo: 0.22,
    trimDb: 0,
  },
  // Aynı beşli aşağı, biraz boğuk
  leave: {
    tones: [
      { note: A5, at: 0, dur: 240 },
      { note: D5, at: 90, dur: 380 },
    ],
    timbre: 'warm',
    attack: 8,
    lowpass: 5000,
    echo: 0.2,
    trimDb: 0,
  },
  // Dörtlü yukarı, daha kısa ve cam tınılı
  userJoin: {
    tones: [
      { note: Fs5, at: 0, dur: 170 },
      { note: B5, at: 70, dur: 300 },
    ],
    timbre: 'glass',
    attack: 7,
    echo: 0.16,
    trimDb: -3,
  },
  // Dörtlü aşağı
  userLeave: {
    tones: [
      { note: B5, at: 0, dur: 170 },
      { note: Fs5, at: 70, dur: 300 },
    ],
    timbre: 'glass',
    attack: 7,
    lowpass: 5500,
    echo: 0.16,
    trimDb: -3,
  },
  // Büyük üçlü aşağı, çok kısa, tıklı
  mute: {
    tones: [
      { note: Fs5, at: 0, dur: 90 },
      { note: D5, at: 55, dur: 190 },
    ],
    timbre: 'soft',
    attack: 5,
    tick: 0.12,
    echo: 0,
    trimDb: 0,
  },
  // Büyük üçlü yukarı
  unmute: {
    tones: [
      { note: D5, at: 0, dur: 90 },
      { note: Fs5, at: 55, dur: 190 },
    ],
    timbre: 'soft',
    attack: 5,
    tick: 0.12,
    echo: 0,
    trimDb: 0,
  },
  // Üç nota iner, boğuk: "dünya kısıldı"
  deafen: {
    tones: [
      { note: A5, at: 0, dur: 100 },
      { note: Fs5, at: 55, dur: 100 },
      { note: D5, at: 110, dur: 260 },
    ],
    timbre: 'warm',
    attack: 6,
    tick: 0.1,
    lowpass: 2600,
    echo: 0,
    trimDb: 0,
  },
  undeafen: {
    tones: [
      { note: D5, at: 0, dur: 100 },
      { note: Fs5, at: 55, dur: 100 },
      { note: A5, at: 110, dur: 260 },
    ],
    timbre: 'warm',
    attack: 6,
    tick: 0.1,
    echo: 0,
    trimDb: 0,
  },
  // Dört notalık parlak arpej yukarı
  streamStart: {
    tones: [
      { note: D5, at: 0, dur: 150 },
      { note: Fs5, at: 55, dur: 150 },
      { note: A5, at: 110, dur: 150 },
      { note: D6, at: 165, dur: 360 },
    ],
    timbre: 'bell',
    attack: 6,
    echo: 0.2,
    trimDb: -1,
  },
  streamStop: {
    tones: [
      { note: D6, at: 0, dur: 150 },
      { note: A5, at: 55, dur: 150 },
      { note: Fs5, at: 110, dur: 150 },
      { note: D5, at: 165, dur: 360 },
    ],
    timbre: 'bell',
    attack: 6,
    lowpass: 5000,
    echo: 0.18,
    trimDb: -1,
  },
  // Başkasının yayını: üç nota, daha hafif
  userStreamStart: {
    tones: [
      { note: Fs5, at: 0, dur: 120 },
      { note: A5, at: 50, dur: 120 },
      { note: D6, at: 100, dur: 280 },
    ],
    timbre: 'glass',
    attack: 6,
    echo: 0.16,
    trimDb: -4,
  },
  userStreamStop: {
    tones: [
      { note: D6, at: 0, dur: 120 },
      { note: A5, at: 50, dur: 120 },
      { note: Fs5, at: 100, dur: 280 },
    ],
    timbre: 'glass',
    attack: 6,
    lowpass: 5000,
    echo: 0.16,
    trimDb: -4,
  },
  // Çan: Si → Mi, en parlak ses
  mention: {
    tones: [
      { note: B5, at: 0, dur: 220 },
      { note: E6, at: 95, dur: 420 },
      { note: B4, at: 95, dur: 260, gain: 0.2 },
    ],
    timbre: 'bell',
    attack: 5,
    echo: 0.22,
    trimDb: 0,
  },
  // Dizinin dışındaki Fa ile kararan iniş: "bir sorun var"
  disconnect: {
    tones: [
      { note: A5, at: 0, dur: 160 },
      { note: 77, at: 90, dur: 160 },
      { note: D5, at: 180, dur: 380 },
      { note: D4, at: 180, dur: 300, gain: 0.25 },
    ],
    timbre: 'warm',
    attack: 8,
    lowpass: 3200,
    echo: 0.2,
    trimDb: 0,
  },
  // Kısa, yukarı: "geri geldin"
  reconnected: {
    tones: [
      { note: A5, at: 0, dur: 140 },
      { note: D6, at: 70, dur: 300 },
    ],
    timbre: 'warm',
    attack: 8,
    echo: 0.16,
    trimDb: -2,
  },
  // Bas-konuş: tek, çok kısa, kısık nota (varsayılan kapalı)
  pttOn: {
    tones: [{ note: A5, at: 0, dur: 70 }],
    timbre: 'soft',
    attack: 4,
    tick: 0.12,
    echo: 0,
    trimDb: -8,
  },
  pttOff: {
    tones: [{ note: E5, at: 0, dur: 70 }],
    timbre: 'soft',
    attack: 4,
    tick: 0.12,
    lowpass: 4000,
    echo: 0,
    trimDb: -8,
  },
};

// ---------- Sentez ----------

/** Yankı: gecikme (ms), geri besleme ve kuyruğun süzgeci (Hz) */
const ECHO_DELAY_MS = 95;
const ECHO_FEEDBACK = 0.3;
const ECHO_LOWPASS = 3000;
/** Kuyruk tepe seviyesinin bu kadar altına inince kesilir (dB) */
const TAIL_FLOOR_DB = -48;
/** Sondaki yumuşak kapanış (ms): tık sesi olmasın */
const FADE_OUT_MS = 15;
/**
 * Algılanan seviye: en yüksek 50 ms'lik pencerenin RMS'i bu hedefe getirilir, tepe -12 dBFS'yi geçmez.
 * Böylece kısa tek notalı sesler uzun arpejlerden daha cılız duyulmaz.
 */
const TARGET_RMS_DBFS = -19;
const RMS_WINDOW_MS = 50;

const midiHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);
const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** Tekrarlanabilir gürültü (her çalışta ve her platformda aynı örnekler) */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Tek kutuplu alçak geçiren süzgeç katsayısı */
const lowpassCoef = (hz: number, rate: number): number => 1 - Math.exp((-2 * Math.PI * hz) / rate);

function addTone(out: Float32Array, tone: Tone, timbre: Timbre, attackMs: number, rate: number): void {
  const f = midiHz(tone.note);
  const start = Math.round((tone.at / 1000) * rate);
  const durS = tone.dur / 1000;
  // -40 dB'e (0,01) dur sürede inen üstel sönüm
  const tau = durS / Math.log(100);
  const attack = attackMs / 1000;
  const fadeFrom = durS * 0.8;
  const len = Math.min(out.length - start, Math.ceil(durS * rate));
  const gain = tone.gain ?? 1;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    let env = Math.exp(-t / tau);
    // Yumuşak başlangıç (yükseltilmiş kosinüs): tık olmaz
    if (t < attack) env *= 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
    // Notanın son %20'si sıfıra iner
    if (t > fadeFrom) env *= 0.5 + 0.5 * Math.cos((Math.PI * (t - fadeFrom)) / (durS - fadeFrom));
    // FM derinliği notanın başında yüksek, hızla söner: çekiç vuruşu parlak, kuyruk saf
    const index = timbre.index * Math.exp(-t / (tau * 0.35));
    const w = 2 * Math.PI * f * t;
    const s =
      Math.sin(w + index * Math.sin(w * timbre.ratio)) + timbre.h2 * Math.exp(-t / (tau * 0.5)) * Math.sin(2 * w);
    out[start + i] = (out[start + i] ?? 0) + gain * env * s;
  }
}

function addTick(out: Float32Array, level: number, rate: number): void {
  const rnd = noise(0x5eed);
  const len = Math.min(out.length, Math.round(0.012 * rate));
  const a = lowpassCoef(5000, rate);
  let lp = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const env = (t < 0.001 ? t / 0.001 : 1) * Math.exp(-t / 0.0025);
    lp += a * (rnd() - lp);
    // Alçak + yüksek geçiren (fark): yalnızca orta tizler, gümbürtü yok
    const band = lp - prev;
    prev = lp;
    out[i] = (out[i] ?? 0) + level * 4 * env * band;
  }
}

function lowpass(buf: Float32Array, hz: number, rate: number): void {
  const a = lowpassCoef(hz, rate);
  // İki kademe: 12 dB/oktav
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    y1 += a * ((buf[i] ?? 0) - y1);
    y2 += a * (y1 - y2);
    buf[i] = y2;
  }
}

function addEcho(buf: Float32Array, wet: number, rate: number): void {
  const d = Math.round((ECHO_DELAY_MS / 1000) * rate);
  const a = lowpassCoef(ECHO_LOWPASS, rate);
  const line = new Float32Array(buf.length);
  let lp = 0;
  for (let i = d; i < buf.length; i++) {
    lp += a * ((buf[i - d] ?? 0) + ECHO_FEEDBACK * (line[i - d] ?? 0) - lp);
    line[i] = lp;
  }
  for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] ?? 0) + wet * (line[i] ?? 0);
}

function peakOf(buf: Float32Array): number {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  return peak;
}

function maxWindowRms(buf: Float32Array, rate: number): number {
  const win = Math.max(1, Math.round((RMS_WINDOW_MS / 1000) * rate));
  let sum = 0;
  let best = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] ?? 0;
    sum += v * v;
    if (i >= win) {
      const old = buf[i - win] ?? 0;
      sum -= old * old;
    }
    best = Math.max(best, sum);
  }
  return Math.sqrt(best / Math.min(win, buf.length));
}

/**
 * Sesi üretir: mono, [-1, 1], tepe en çok -12 dBFS (SFX_PEAK_DBFS). Aynı ad ve hız için her zaman
 * aynı örnekler döner.
 */
export function renderSound(name: SoundName, rate: number = SFX_SAMPLE_RATE): Float32Array<ArrayBuffer> {
  const spec = SOUNDS[name];
  const timbre = TIMBRES[spec.timbre];
  const endMs = Math.max(...spec.tones.map((t) => t.at + t.dur));
  // Yankı kuyruğu için pay: geri besleme 0,3 ile dört yansımada ~-40 dB
  const tailMs = spec.echo > 0 ? ECHO_DELAY_MS * 4 : 0;
  const buf = new Float32Array(Math.ceil(((endMs + tailMs + FADE_OUT_MS) / 1000) * rate));

  for (const tone of spec.tones) addTone(buf, tone, timbre, spec.attack, rate);
  if (spec.tick) addTick(buf, spec.tick, rate);
  if (spec.lowpass) lowpass(buf, spec.lowpass, rate);
  if (spec.echo > 0) addEcho(buf, spec.echo, rate);

  // Sessiz kuyruğu kes, sonu yumuşak kapat
  const floor = peakOf(buf) * dbToGain(TAIL_FLOOR_DB);
  let end = buf.length;
  while (end > 1 && Math.abs(buf[end - 1] ?? 0) < floor) end--;
  const fade = Math.round((FADE_OUT_MS / 1000) * rate);
  end = Math.min(buf.length, end + fade);
  const out = buf.slice(0, end);
  for (let i = 0; i < fade && i < out.length; i++) {
    const k = out.length - 1 - i;
    out[k] = (out[k] ?? 0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / fade));
  }

  // Seviye: algılanan seviye hedefe, tepe -12 dBFS'yi geçmez; sonra sese özel ayar
  const peakGain = dbToGain(SFX_PEAK_DBFS) / peakOf(out);
  const rmsGain = dbToGain(TARGET_RMS_DBFS) / maxWindowRms(out, rate);
  const gain = Math.min(peakGain, rmsGain) * dbToGain(Math.min(0, spec.trimDb));
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * gain;
  return out;
}

// ---------- Başkalarının kanal olayları ----------

/** Aynı anda gelen olaylardan hangisinin sesi çalınır (biri çıkarken yayını da kapanır: "çıktı" duyulur) */
const OTHERS_PRIORITY: Partial<Record<SoundName, number>> = {
  userJoin: 2,
  userLeave: 2,
  userStreamStart: 1,
  userStreamStop: 1,
};
/** Bu süre içinde gelen olaylar tek sese iner (ms) */
const OTHERS_BATCH_MS = 60;
/** İki "başkası" sesi arasındaki en kısa süre (ms): kalabalık girip çıkarken ses seli olmaz */
const OTHERS_MIN_GAP_MS = 350;
/** Kanala bağlanınca / yeniden bağlanınca başkalarının sesleri bu süre çalınmaz (ms) */
export const OTHERS_QUIET_MS = 1500;

/**
 * Başkalarının kanal olaylarının (biri girdi/çıktı, yayına başladı/bitirdi) sesleri: kanala girer girmez
 * ya da yeniden bağlanınca gelen olay seli susturulur, art arda gelenler tek sese iner.
 */
export class ChannelSoundGate {
  private quietUntil = 0;
  private lastAt = -Infinity;
  private pending: SoundName | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly play: (name: SoundName) => void;
  private readonly now: () => number;

  constructor(play: (name: SoundName) => void, now: () => number = Date.now) {
    this.play = play;
    this.now = now;
  }

  /** Bağlanınca / yeniden bağlanınca: bir süre başkalarının sesleri çalınmaz */
  quiet(ms: number = OTHERS_QUIET_MS): void {
    this.quietUntil = this.now() + ms;
    this.cancel();
  }

  push(name: SoundName): void {
    if (this.now() < this.quietUntil) return;
    if (this.pending === null || (OTHERS_PRIORITY[name] ?? 0) > (OTHERS_PRIORITY[this.pending] ?? 0)) {
      this.pending = name;
    }
    this.timer ??= setTimeout(() => this.flush(), OTHERS_BATCH_MS);
  }

  /** Bekleyen sesi iptal et (ör. kanaldan ayrılınca) */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private flush(): void {
    const name = this.pending;
    this.timer = null;
    this.pending = null;
    const now = this.now();
    if (!name || now < this.quietUntil || now - this.lastAt < OTHERS_MIN_GAP_MS) return;
    this.lastAt = now;
    this.play(name);
  }
}

/** 16 bit PCM mono WAV dosyası (telefondaki hazır sesler ve dinleme kopyaları için) */
export function encodeWav(samples: Float32Array, rate: number = SFX_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}
