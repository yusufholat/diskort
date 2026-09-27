// Arayüz sesleri. Sesler client-core'da tek yerde tanımlı (packages/client-core/src/sfx.ts); burada
// seçili ses paketinden (Ayarlar → Ses → Ses paketi) bellekte üretilip Web Audio ile çalınır. Telefon aynı
// tanımdan üretilmiş WAV dosyalarını çalar.
//
// Çıkış aygıtı: sesler seçili çıkış aygıtından (Ayarlar → Ses → Çıkış) çalınır. Aygıt değişimi
// (setSinkId) bitmeden çalınan ses eskiden kayboluyordu (ilk ses genelde "katıldın" sesiydi); artık
// aygıt hazır olana dek beklenir.
import {
  OTHERS_SOUNDS,
  renderSound,
  SFX_SAMPLE_RATE,
  useGuild,
  useSession,
  type SoundName,
  type SoundPack,
} from '@diskort/client-core';
import { getSettings, useSettings } from '../stores/settings';

export type { SoundName } from '@diskort/client-core';

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

let ctx: SinkContext | null = null;
/** Bağlama uygulanmış çıkış aygıtı ('' = sistemin varsayılanı) */
let appliedSink = '';
let sinkChange: Promise<void> | null = null;
/** Üretilmiş sesler; yalnızca bufferPack paketinin sesleri tutulur, paket değişince boşaltılır */
const buffers = new Map<SoundName, AudioBuffer>();
let bufferPack: SoundPack | null = null;
const lastPlayed = new Map<SoundName, number>();

/** Aynı ses bu süreden sık çalınmaz (ör. kısayola art arda basınca üst üste binmesin) */
const SAME_SOUND_GAP_MS = 90;

/** Uygulama genelinde paylaşılan AudioContext (arayüz sesleri, LiveKit işlemci bağlamı). */
export function sharedAudioContext(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: 'interactive' }) as SinkContext;
  return ctx;
}

const wantedSink = (): string => {
  const id = getSettings().outputDeviceId;
  return id === 'default' ? '' : id;
};

/** Seçili çıkış aygıtını bağlama uygular; değişim sürerken çalınan sesler onu bekler */
function applySink(ac: SinkContext): void {
  const sink = wantedSink();
  if (sink === appliedSink || !ac.setSinkId) return;
  appliedSink = sink;
  const change = ac
    .setSinkId(sink)
    .catch(() => undefined)
    .finally(() => {
      if (sinkChange === change) sinkChange = null;
    });
  sinkChange = change;
}

async function ready(): Promise<AudioContext> {
  const ac = sharedAudioContext() as SinkContext;
  applySink(ac);
  if (sinkChange) await sinkChange;
  if (ac.state === 'suspended') await ac.resume().catch(() => undefined);
  return ac;
}

function buffer(ac: AudioContext, name: SoundName): AudioBuffer {
  const pack = getSettings().soundPack;
  if (pack !== bufferPack) {
    buffers.clear();
    bufferPack = pack;
  }
  let b = buffers.get(name);
  if (!b) {
    const samples = renderSound(name, SFX_SAMPLE_RATE, pack);
    b = ac.createBuffer(1, samples.length, SFX_SAMPLE_RATE);
    b.copyToChannel(samples, 0);
    buffers.set(name, b);
  }
  return b;
}

/**
 * Ses bağlamını ve çıkış aygıtını önceden hazırlar (ses kanalına bağlanırken çağrılır): "katıldın" sesi
 * çalınacağı anda aygıt değişimiyle ya da bağlamın açılışıyla yarışmasın.
 */
export function prepareSounds(): void {
  void ready()
    .then((ac) => {
      for (const name of ['join', 'leave', 'mute', 'unmute', 'userJoin', 'userLeave'] as const) buffer(ac, name);
    })
    .catch(() => undefined);
}

// Çıkış aygıtı değişince bağlam hemen taşınır (bir sonraki ses beklemesin)
useSettings.subscribe((next, prev) => {
  if (ctx && next.outputDeviceId !== prev.outputDeviceId) applySink(ctx);
});

function selfDeafened(): boolean {
  const s = getSettings();
  if (s.selfDeaf) return true;
  const selfId = useSession.getState().user?.id;
  return selfId !== undefined && useGuild.getState().voiceStates[selfId]?.serverDeaf === true;
}

/** Ayarlara göre bu ses çalınmalı mı */
function allowed(name: SoundName): boolean {
  const s = getSettings();
  if (name === 'mention') return s.notificationSound;
  if (!s.sounds) return false;
  if ((name === 'pttOn' || name === 'pttOff') && !s.pttSounds) return false;
  // Sağırken başkalarının kanal olayları duyulmaz; kendi işlemlerinin sesi çalar
  return !(OTHERS_SOUNDS.has(name) && selfDeafened());
}

/**
 * Sesi çalar. `preview`: ayarlardaki dinleme düğmesi (açık/kapalı ayarlarına bakılmaz, seviye uygulanır).
 */
export function playSound(name: SoundName, opts: { preview?: boolean } = {}): void {
  if (!opts.preview && !allowed(name)) return;
  const volume = getSettings().sfxVolume;
  if (volume <= 0) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < SAME_SOUND_GAP_MS) return;
  lastPlayed.set(name, now);
  void ready()
    .then((ac) => {
      const src = ac.createBufferSource();
      src.buffer = buffer(ac, name);
      const gain = ac.createGain();
      gain.gain.value = volume;
      src.connect(gain).connect(ac.destination);
      src.onended = () => gain.disconnect();
      src.start(ac.currentTime + 0.005);
    })
    .catch(() => undefined);
}
