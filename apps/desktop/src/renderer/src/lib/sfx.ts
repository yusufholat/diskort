// Discord benzeri kısa arayüz sesleri; ses dosyası yerine Web Audio ile sentezlenir.
import { getSettings } from '../stores/settings';

export type SoundName =
  | 'join'
  | 'leave'
  | 'userJoin'
  | 'userLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'streamStart'
  | 'streamStop'
  | 'mention';

type Note = [freq: number, startMs: number, durMs: number];

const SOUNDS: Record<SoundName, { notes: Note[]; type: OscillatorType; gain: number }> = {
  join: { notes: [[523, 0, 90], [784, 80, 140]], type: 'sine', gain: 0.18 },
  leave: { notes: [[659, 0, 90], [440, 80, 160]], type: 'sine', gain: 0.18 },
  userJoin: { notes: [[587, 0, 70], [880, 60, 110]], type: 'triangle', gain: 0.12 },
  userLeave: { notes: [[698, 0, 70], [466, 60, 120]], type: 'triangle', gain: 0.12 },
  mute: { notes: [[392, 0, 80]], type: 'sine', gain: 0.16 },
  unmute: { notes: [[587, 0, 80]], type: 'sine', gain: 0.16 },
  deafen: { notes: [[440, 0, 70], [330, 60, 110]], type: 'sine', gain: 0.16 },
  undeafen: { notes: [[330, 0, 70], [494, 60, 110]], type: 'sine', gain: 0.16 },
  streamStart: { notes: [[523, 0, 70], [659, 60, 70], [784, 120, 120]], type: 'triangle', gain: 0.12 },
  streamStop: { notes: [[784, 0, 70], [659, 60, 70], [523, 120, 120]], type: 'triangle', gain: 0.12 },
  mention: { notes: [[988, 0, 60], [1319, 70, 150]], type: 'sine', gain: 0.14 },
};

let ctx: AudioContext | null = null;
let currentSink = '';

/** Uygulama genelinde paylaşılan AudioContext (arayüz sesleri, LiveKit işlemci bağlamı). */
export function sharedAudioContext(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  return ctx;
}

function context(): AudioContext {
  const ctx = sharedAudioContext();
  const sink = getSettings().outputDeviceId;
  const withSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (sink !== currentSink && withSink.setSinkId) {
    currentSink = sink;
    withSink.setSinkId(sink === 'default' ? '' : sink).catch(() => undefined);
  }
  return ctx;
}

export function playSound(name: SoundName): void {
  const settings = getSettings();
  if (!settings.sounds || settings.selfDeaf) return;
  const ac = context();
  if (ac.state === 'suspended') void ac.resume();
  const spec = SOUNDS[name];
  const now = ac.currentTime + 0.01;
  for (const [freq, startMs, durMs] of spec.notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = spec.type;
    osc.frequency.value = freq;
    const t0 = now + startMs / 1000;
    const t1 = t0 + durMs / 1000;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(spec.gain, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }
}
