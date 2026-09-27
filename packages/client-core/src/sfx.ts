// Arayüz sesleri: tek tanım, iki çalıcı. Masaüstü bu dosyadaki renderSound() ile sesi bellekte üretip
// Web Audio ile çalar (apps/desktop/src/renderer/src/lib/sfx.ts); telefon aynı işlevle önceden yazılmış
// WAV dosyalarını çalar (apps/mobile/scripts/generate-sounds.mjs → assets/sounds/<paket>/*.wav). İkisi de
// aynı örnekleri ürettiği için sesler birebir aynıdır.
//
// Bu dosya bilerek hiçbir şey içe aktarmaz ve yalnızca silinebilir TypeScript sözdizimi kullanır: Node
// (tür soyma ile) üretici betikten doğrudan yükleyebilsin.
//
// İki ses paketi var, ikisi de Re majör pentatonikte (D E F# A B) ve aynı anlamlarla: kendi katılman /
// sesi açman / yayına başlaman yükselir, ayrılman / susturman / yayını bitirmen iner; aynı olayın başkası
// için olanı (biri girdi, biri yayına başladı) daha kısa ve biraz daha kısıktır.
//
// Yumuşak (varsayılan): kısa (çoğu 120–350 ms), yuvarlak, "baloncuklu" sesler; üçgene yakın sinüs gövde,
// tokmak/su damlası karakteri, her nota hedef perdesine küçük bir kaymayla varır (yukarı ya da aşağı).
// Yumuşak başlangıç (8–12 ms, vuruş/tık yok), notalar üst üste biner, 3 kHz altında boğuk, klasikten pes
// (Re4–Si5). Kesik yankı yerine birkaç kısa, süzülmüş yansımadan oluşan küçük bir "oda". Tepe -15 dBFS.
//
// Klasik: hafif FM'li sinüs (parlaklık notanın başında, hızla söner: yumuşak bir çekiç sesi), yumuşak
// başlangıç (4–8 ms), üstel sönüm, küçük bir yankı kuyruğu. Tepe seviyesi -12 dBFS.
//
// İki pakette de algılanan seviyeler eşitlenir (en yüksek 50 ms'lik pencerenin RMS'i).

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

/** Ses paketleri (Ayarlar → Ses efektleri → Ses paketi); ilki varsayılan */
export const SOUND_PACKS = ['soft', 'classic'] as const;
export type SoundPack = (typeof SOUND_PACKS)[number];
export const DEFAULT_SOUND_PACK: SoundPack = 'soft';

export const SOUND_PACK_LABELS: Record<SoundPack, string> = {
  soft: 'Yumuşak',
  classic: 'Klasik',
};

export const isSoundPack = (v: unknown): v is SoundPack => (SOUND_PACKS as readonly unknown[]).includes(v);

/** Hazır seslerin örnekleme hızı (telefondaki WAV dosyaları da bu hızda) */
export const SFX_SAMPLE_RATE = 48000;
/**
 * Hiçbir sesin geçmediği tepe seviyesi (dBFS); çalarken kullanıcının "Ses efektleri" seviyesiyle çarpılır.
 * Paketlerin kendi tepe seviyesi: SOUND_PACK_PEAK_DBFS.
 */
export const SFX_PEAK_DBFS = -12;
/** Paket başına tepe seviyesi (dBFS): yumuşak paket daha kısık */
export const SOUND_PACK_PEAK_DBFS: Record<SoundPack, number> = {
  soft: -15,
  classic: SFX_PEAK_DBFS,
};

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

// ---------- Klasik paket ----------

const CLASSIC: Record<SoundName, SoundSpec> = {
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

// ---------- Yumuşak paket ----------
//
// Kısa (çoğu 120–350 ms), yuvarlak, "baloncuklu" sesler: gövde sinüs (üçgene yakın, çok hafif üst
// harmonikler), yumuşak tokmak/su damlası karakteri. Her nota hedef perdesine küçük bir kaymayla varır
// (glide): olumlu/kendi işlemlerinde aşağıdan yukarı, olumsuzlarda yukarıdan aşağı. Notalar üst üste biner.
// Perdeler ve aralıklar bu uygulamaya özgü (Re majör pentatonik, klasik paketle aynı dizi); hiçbir
// uygulamanın sesi örnek alınmadı ya da kopyalanmadı, sesler yalnızca aşağıdaki sayılardan üretilir.

interface SoftTone {
  /** MIDI nota numarası (varılan perde) */
  note: number;
  /** Başlangıç (ms) */
  at: number;
  /** Notanın toplam süresi (ms); sonunda tam sıfıra iner */
  dur: number;
  /** Başlangıçtaki perde farkı (yarım ses): -3 = üç yarım ses aşağıdan kayarak gelir, +3 = yukarıdan */
  from?: number;
  /** Kaymanın zaman sabiti (ms; varsayılan 22): küçük = damla gibi hızlı, büyük = süpürme */
  glideMs?: number;
  /** Göreli seviye (varsayılan 1) */
  gain?: number;
}

interface SoftSpec {
  tones: SoftTone[];
  /** Başlangıç süresi (ms, yükseltilmiş kosinüs): sert vuruş/tık yok */
  attack: number;
  /** Notanın salınıma kadar ne kadar söndüğü (dB): tokmak gibi sönen, ama kesilmeyen nota */
  decayDb: number;
  /** Notanın son ne kadarı (oran) yumuşakça sıfıra iner; sonraki nota bu sırada girer */
  release: number;
  /** İkinci harmoniğin payı (başta, hızla söner: sıcaklık) */
  h2: number;
  /** Tokmak kısmisi (4. harmonik, çok kısık, ~12 ms'de söner): "tuk" hissi, sertlik değil */
  mallet?: number;
  /** Çan kısmisi (2,76 oranlı, çok kısık, hızla söner): yalnızca bildirim */
  chime?: number;
  /** Alçak geçiren süzgeç (Hz) */
  lowpass: number;
  /** Küçük oda yansımalarının payı (0: yok) */
  room: number;
  /** Algılanan seviyeye göre ek ayar (dB) */
  trimDb: number;
}

const F4 = 65;
const A4 = 69;

/** Çoğu sesin ortak ayarları */
const SOFT_BASE = { attack: 10, decayDb: 20, release: 0.4, h2: 0.12, lowpass: 2600, room: 0.3, trimDb: 0 };

const SOFT: Record<SoundName, SoftSpec> = {
  // Beşli yukarı, iki damla (La4 → Mi5), ikisi de aşağıdan kayarak: "içerdesin"
  join: {
    ...SOFT_BASE,
    tones: [
      { note: A4, at: 0, dur: 150, from: -2 },
      { note: E5, at: 65, dur: 250, from: -3 },
    ],
  },
  // Aynı beşli aşağı, yukarıdan kayarak, biraz boğuk
  leave: {
    ...SOFT_BASE,
    tones: [
      { note: E5, at: 0, dur: 150, from: 2 },
      { note: A4, at: 65, dur: 270, from: 3 },
    ],
    lowpass: 2000,
  },
  // Başkası girdi: tek, kısa, kısık "baloncuk" (aşağıdan Re5'e)
  userJoin: {
    ...SOFT_BASE,
    tones: [{ note: D5, at: 0, dur: 170, from: -4, glideMs: 28 }],
    h2: 0.08,
    room: 0.25,
    trimDb: -5,
  },
  // Başkası çıktı: yukarıdan La4'e inen baloncuk
  userLeave: {
    ...SOFT_BASE,
    tones: [{ note: A4, at: 0, dur: 180, from: 4, glideMs: 28 }],
    h2: 0.08,
    lowpass: 2100,
    room: 0.25,
    trimDb: -5,
  },
  // Pes, kısa "tuk" (Si4'e hafifçe inerek)
  mute: {
    ...SOFT_BASE,
    tones: [{ note: B4, at: 0, dur: 120, from: 1.5, glideMs: 15 }],
    decayDb: 24,
    mallet: 0.05,
    lowpass: 2200,
    room: 0.15,
  },
  // Tiz, kısa "tuk" (Fa#5'e hafifçe çıkarak)
  unmute: {
    ...SOFT_BASE,
    tones: [{ note: Fs5, at: 0, dur: 120, from: -1.5, glideMs: 15 }],
    decayDb: 24,
    mallet: 0.05,
    room: 0.15,
  },
  // Daha derin: iki nota iner (La4 → Re4), boğuk
  deafen: {
    ...SOFT_BASE,
    tones: [
      { note: A4, at: 0, dur: 130, from: 1.5 },
      { note: D4, at: 60, dur: 230, from: 2 },
    ],
    h2: 0.18,
    lowpass: 1500,
    room: 0.2,
  },
  // Derin iki nota çıkar (Re4 → La4)
  undeafen: {
    ...SOFT_BASE,
    tones: [
      { note: D4, at: 0, dur: 130, from: -1.5 },
      { note: A4, at: 60, dur: 230, from: -2 },
    ],
    h2: 0.18,
    lowpass: 2000,
    room: 0.2,
  },
  // Biraz daha uzun süpürme: Re5'e beş yarım ses aşağıdan yavaşça kayar, üstüne La5 konar
  streamStart: {
    ...SOFT_BASE,
    tones: [
      { note: D5, at: 0, dur: 240, from: -5, glideMs: 55 },
      { note: A5, at: 140, dur: 230, from: -2 },
    ],
    decayDb: 16,
    lowpass: 2800,
    room: 0.35,
    trimDb: -1,
  },
  // Tersi: La5'ten Re5'e, beş yarım ses yukarıdan yavaşça iner
  streamStop: {
    ...SOFT_BASE,
    tones: [
      { note: A5, at: 0, dur: 170, from: 2 },
      { note: D5, at: 100, dur: 270, from: 5, glideMs: 55 },
    ],
    decayDb: 16,
    lowpass: 2100,
    room: 0.35,
    trimDb: -1,
  },
  // Başkasının yayını: iki küçük, tiz damla (Fa#5 → La5), kısık
  userStreamStart: {
    ...SOFT_BASE,
    tones: [
      { note: Fs5, at: 0, dur: 110, from: -2 },
      { note: A5, at: 55, dur: 180, from: -2 },
    ],
    h2: 0.08,
    lowpass: 2800,
    room: 0.25,
    trimDb: -5,
  },
  userStreamStop: {
    ...SOFT_BASE,
    tones: [
      { note: A5, at: 0, dur: 110, from: 2 },
      { note: Fs5, at: 55, dur: 190, from: 2 },
    ],
    h2: 0.08,
    lowpass: 2300,
    room: 0.25,
    trimDb: -5,
  },
  // Dostça, yumuşak iki "ping" (Fa#5 → Si5), hafif çan kısmisiyle
  mention: {
    ...SOFT_BASE,
    tones: [
      { note: Fs5, at: 0, dur: 190, from: -1 },
      { note: B5, at: 90, dur: 300, from: -1 },
    ],
    decayDb: 22,
    h2: 0.1,
    chime: 0.06,
    lowpass: 3000,
    room: 0.35,
  },
  // Pes ve karanlık: dizinin dışındaki Fa ile inen üç nota (La4 → Fa4 → Re4), sonuncusu aşağı kayar
  disconnect: {
    ...SOFT_BASE,
    tones: [
      { note: A4, at: 0, dur: 150, from: 1 },
      { note: F4, at: 75, dur: 150, from: 1 },
      { note: D4, at: 150, dur: 300, from: 2, glideMs: 60 },
    ],
    attack: 12,
    decayDb: 16,
    h2: 0.2,
    lowpass: 1300,
    room: 0.35,
  },
  // Kısa, yukarı iki damla (Re5 → Fa#5): "geri geldin"
  reconnected: {
    ...SOFT_BASE,
    tones: [
      { note: D5, at: 0, dur: 120, from: -2 },
      { note: Fs5, at: 55, dur: 220, from: -2 },
    ],
    trimDb: -2,
  },
  // Bas-konuş: neredeyse duyulmayan, çok kısa blip'ler (varsayılan kapalı)
  pttOn: {
    ...SOFT_BASE,
    tones: [{ note: A5, at: 0, dur: 75, from: -1, glideMs: 12 }],
    attack: 8,
    h2: 0.04,
    room: 0,
    trimDb: -10,
  },
  pttOff: {
    ...SOFT_BASE,
    tones: [{ note: E5, at: 0, dur: 75, from: 1, glideMs: 12 }],
    attack: 8,
    h2: 0.04,
    lowpass: 2000,
    room: 0,
    trimDb: -10,
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
 * Klasik paketin algılanan seviyesi: en yüksek 50 ms'lik pencerenin RMS'i bu hedefe getirilir, tepe -12 dBFS'yi geçmez.
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
 * Sessiz kuyruğu keser, sonu yumuşak kapatır ve seviyeyi ayarlar: algılanan seviye (en yüksek 50 ms'lik
 * pencerenin RMS'i) hedefe gelir, tepe paketin tepe seviyesini geçmez; sonra sese özel ayar.
 */
function finish(
  buf: Float32Array,
  rate: number,
  peakDbfs: number,
  rmsDbfs: number,
  trimDb: number,
  fadeMs: number,
): Float32Array<ArrayBuffer> {
  const floor = peakOf(buf) * dbToGain(TAIL_FLOOR_DB);
  let end = buf.length;
  while (end > 1 && Math.abs(buf[end - 1] ?? 0) < floor) end--;
  const fade = Math.round((fadeMs / 1000) * rate);
  end = Math.min(buf.length, end + fade);
  const out = buf.slice(0, end);
  for (let i = 0; i < fade && i < out.length; i++) {
    const k = out.length - 1 - i;
    out[k] = (out[k] ?? 0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / fade));
  }

  const peakGain = dbToGain(peakDbfs) / peakOf(out);
  const rmsGain = dbToGain(rmsDbfs) / maxWindowRms(out, rate);
  const gain = Math.min(peakGain, rmsGain) * dbToGain(Math.min(0, trimDb));
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * gain;
  return out;
}

function renderClassic(name: SoundName, rate: number): Float32Array<ArrayBuffer> {
  const spec = CLASSIC[name];
  const timbre = TIMBRES[spec.timbre];
  const endMs = Math.max(...spec.tones.map((t) => t.at + t.dur));
  // Yankı kuyruğu için pay: geri besleme 0,3 ile dört yansımada ~-40 dB
  const tailMs = spec.echo > 0 ? ECHO_DELAY_MS * 4 : 0;
  const buf = new Float32Array(Math.ceil(((endMs + tailMs + FADE_OUT_MS) / 1000) * rate));

  for (const tone of spec.tones) addTone(buf, tone, timbre, spec.attack, rate);
  if (spec.tick) addTick(buf, spec.tick, rate);
  if (spec.lowpass) lowpass(buf, spec.lowpass, rate);
  if (spec.echo > 0) addEcho(buf, spec.echo, rate);

  return finish(buf, rate, SOUND_PACK_PEAK_DBFS.classic, TARGET_RMS_DBFS, spec.trimDb, FADE_OUT_MS);
}

// ---------- Yumuşak paketin sentezi ----------

/**
 * Yumuşak paketin algılanan seviye hedefi (tepe -15 dBFS): çoğu ses tepe sınırına takılır, enerjisi
 * yoğun olanlar bu hedefe göre biraz kısılır. Algılanan seviye klasikten ~2 dB düşük.
 */
const SOFT_TARGET_RMS_DBFS = -20;
/** Sondaki kapanış (ms): kuyruk zaten sıfıra iner, bu yalnızca güvence */
const SOFT_FADE_OUT_MS = 30;
/**
 * Küçük oda: tek, belirgin bir yankı (tekrar eden "tık tık") yerine yakın aralıklı, giderek kısılan ve
 * süzülmüş birkaç yansıma; ses kuruyup kesilmez, hafifçe yayılır.
 */
const ROOM_TAPS: readonly { ms: number; gain: number }[] = [
  { ms: 23, gain: 0.5 },
  { ms: 37, gain: 0.38 },
  { ms: 53, gain: 0.28 },
  { ms: 79, gain: 0.2 },
  { ms: 113, gain: 0.13 },
];
const ROOM_LOWPASS = 1400;
const ROOM_LEVEL = 0.35;
/** Üçüncü harmoniğin payı (sabit, çok az): saf sinüsten biraz daha dolgun, üçgene yakın gövde */
const SOFT_H3 = 0.03;

function addSoftTone(out: Float32Array, tone: SoftTone, spec: SoftSpec, rate: number): void {
  const f = midiHz(tone.note);
  const start = Math.round((tone.at / 1000) * rate);
  const durS = tone.dur / 1000;
  const len = Math.min(out.length - start, Math.ceil(durS * rate));
  const attack = Math.min(spec.attack / 1000, durS * 0.4);
  // Salınıma dek decayDb sönen üstel eğri
  const tau = durS / ((spec.decayDb / 20) * Math.LN10);
  const releaseLen = durS * spec.release;
  const releaseFrom = durS - releaseLen;
  const gain = tone.gain ?? 1;
  const from = tone.from ?? 0;
  const glide = (tone.glideMs ?? 22) / 1000;
  // Perde kayarken faz birikerek ilerler (anlık frekans değişse de dalga kesintisiz)
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    let env = Math.exp(-t / tau);
    // Yükseltilmiş kosinüs başlangıç: vuruş yok, ses yuvarlakça "açılır"
    if (t < attack) env *= 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
    // Salınım notanın sonunda tam sıfıra iner; sonraki nota bu sırada girer
    if (t > releaseFrom) env *= 0.5 + 0.5 * Math.cos((Math.PI * (t - releaseFrom)) / releaseLen);
    // Üçgene yakın gövde: temel + başta biraz ikinci, çok az üçüncü harmonik
    let s =
      Math.sin(phase) +
      spec.h2 * Math.exp(-t / (tau * 0.4)) * Math.sin(2 * phase) +
      SOFT_H3 * Math.sin(3 * phase);
    if (spec.mallet) s += spec.mallet * Math.exp(-t / 0.012) * Math.sin(4 * phase);
    if (spec.chime) s += spec.chime * Math.exp(-t / 0.08) * Math.sin(2.76 * phase);
    out[start + i] = (out[start + i] ?? 0) + gain * env * s;
    phase += (2 * Math.PI * f * Math.pow(2, (from * Math.exp(-t / glide)) / 12)) / rate;
  }
}

function addRoom(buf: Float32Array, wet: number, rate: number): void {
  const src = buf.slice();
  lowpass(src, ROOM_LOWPASS, rate);
  for (const tap of ROOM_TAPS) {
    const d = Math.round((tap.ms / 1000) * rate);
    const g = wet * ROOM_LEVEL * tap.gain;
    for (let i = d; i < buf.length; i++) buf[i] = (buf[i] ?? 0) + g * (src[i - d] ?? 0);
  }
}

function renderSoft(name: SoundName, rate: number): Float32Array<ArrayBuffer> {
  const spec = SOFT[name];
  const endMs = Math.max(...spec.tones.map((t) => t.at + t.dur));
  const lastTap = ROOM_TAPS[ROOM_TAPS.length - 1]?.ms ?? 0;
  const tailMs = spec.room > 0 ? lastTap + 40 : 0;
  const buf = new Float32Array(Math.ceil(((endMs + tailMs + SOFT_FADE_OUT_MS) / 1000) * rate));

  for (const tone of spec.tones) addSoftTone(buf, tone, spec, rate);
  lowpass(buf, spec.lowpass, rate);
  if (spec.room > 0) addRoom(buf, spec.room, rate);

  return finish(buf, rate, SOUND_PACK_PEAK_DBFS.soft, SOFT_TARGET_RMS_DBFS, spec.trimDb, SOFT_FADE_OUT_MS);
}

/**
 * Sesi üretir: mono, [-1, 1], tepe en çok paketin tepe seviyesi (SOUND_PACK_PEAK_DBFS; hiçbiri
 * SFX_PEAK_DBFS'yi geçmez). Aynı ad, hız ve paket için her zaman aynı örnekler döner.
 */
export function renderSound(
  name: SoundName,
  rate: number = SFX_SAMPLE_RATE,
  pack: SoundPack = DEFAULT_SOUND_PACK,
): Float32Array<ArrayBuffer> {
  return pack === 'classic' ? renderClassic(name, rate) : renderSoft(name, rate);
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
