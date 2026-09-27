// Arayüz sesleri (katıl, ayrıl, sustur, sağırlaştır, yayın, biri girdi/çıktı, bahsedilme, bağlantı): tek
// tanımdan (packages/client-core/src/sfx.ts) üretilmiş WAV dosyaları (scripts/generate-sounds.mjs); masaüstü
// aynı sesleri çalar. expo-audio ile çalınır, haptics.ts'e takılır; çağıran yerler feedback('mute') /
// soundCue('userJoin') kullanır. Ayarlar → Ses: aç/kapat, seviye ("Ses efektleri") ve dinleme listesi.
//
// Görüşme sesiyle birlikte çalmalı: expo-audio'nun "mixWithOthers" kipinde ses odağı (audio focus)
// istenmez, LiveKit'in görüşmesi kısılmaz ya da duraklatılmaz. Dikkat: setAudioModeAsync Android'de ses
// yöneticisinin kipini (MODE_NORMAL) ve hoparlörü de değiştiriyor; görüşme sürerken çağrılırsa ses
// yolu bozulur. Bu yüzden yalnızca açılışta, sesli sohbete girilmeden önce bir kez çağrılır.
//
// iOS: ses oturumu (AVAudioSession) LiveKit'indir. expo-audio'nun ses kipi hiç ayarlanmaz (kategoriyi
// "ambient" yapıp görüşmeyi bozabilir) ve çalış bitince oturumu kapatmaması istenir (keepAudioSessionActive);
// kapatırsa görüşmenin sesi de kesilir.
//
// Yerel modül yalnızca yeni APK'larda var: yoksa (ör. eski APK) ses sessizce atlanır, titreşim sürer.

import { OTHERS_SOUNDS, useGuild, useSession, type SoundName } from '@diskort/client-core';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type * as ExpoAudio from 'expo-audio';
import { setFeedbackSound, type SoundEvent } from './haptics';
import { getSettings, useSettings } from './stores/settings';

/** Telefonda çalınan sesler (bas-konuş telefonda yok) */
export type MobileSoundName = Exclude<SoundName, 'pttOn' | 'pttOff'>;

const FILES: Record<MobileSoundName, number> = {
  join: require('../assets/sounds/join.wav'),
  leave: require('../assets/sounds/leave.wav'),
  userJoin: require('../assets/sounds/userJoin.wav'),
  userLeave: require('../assets/sounds/userLeave.wav'),
  mute: require('../assets/sounds/mute.wav'),
  unmute: require('../assets/sounds/unmute.wav'),
  deafen: require('../assets/sounds/deafen.wav'),
  undeafen: require('../assets/sounds/undeafen.wav'),
  streamStart: require('../assets/sounds/streamStart.wav'),
  streamStop: require('../assets/sounds/streamStop.wav'),
  userStreamStart: require('../assets/sounds/userStreamStart.wav'),
  userStreamStop: require('../assets/sounds/userStreamStop.wav'),
  mention: require('../assets/sounds/mention.wav'),
  disconnect: require('../assets/sounds/disconnect.wav'),
  reconnected: require('../assets/sounds/reconnected.wav'),
};

/** Ayarlardaki dinleme listesi */
export const MOBILE_SOUND_NAMES = Object.keys(FILES) as MobileSoundName[];

/** Olay → ses. Hoparlör, yönetim ve hata olaylarının sesi yok (masaüstünde de yok), yalnızca titreşim. */
const EVENT_SOUND: Partial<Record<SoundEvent, MobileSoundName>> = {
  join: 'join',
  leave: 'leave',
  userJoin: 'userJoin',
  userLeave: 'userLeave',
  mute: 'mute',
  unmute: 'unmute',
  deafen: 'deafen',
  undeafen: 'undeafen',
  shareStart: 'streamStart',
  shareStop: 'streamStop',
  userStreamStart: 'userStreamStart',
  userStreamStop: 'userStreamStop',
  mention: 'mention',
  disconnect: 'disconnect',
  reconnected: 'reconnected',
};

const players = new Map<MobileSoundName, ExpoAudio.AudioPlayer>();
let audio: typeof ExpoAudio | null = null;

function player(name: MobileSoundName): ExpoAudio.AudioPlayer | null {
  if (!audio) return null;
  let p = players.get(name);
  if (!p) {
    p = audio.createAudioPlayer(FILES[name], { keepAudioSessionActive: Platform.OS === 'ios' });
    p.volume = getSettings().sfxVolume;
    players.set(name, p);
  }
  return p;
}

function deafened(): boolean {
  if (getSettings().selfDeaf) return true;
  const selfId = useSession.getState().user?.id;
  return selfId !== undefined && useGuild.getState().voiceStates[selfId]?.serverDeaf === true;
}

/** Ayarlara göre bu ses çalınmalı mı */
function allowed(name: MobileSoundName): boolean {
  const s = getSettings();
  if (name === 'mention') return s.notificationSound;
  if (!s.sounds) return false;
  // Sağırken başkalarının kanal olayları duyulmaz; kendi işlemlerinin sesi çalar (masaüstündeki gibi)
  return !(OTHERS_SOUNDS.has(name) && deafened());
}

function start(name: MobileSoundName): void {
  if (getSettings().sfxVolume <= 0) return;
  const p = player(name);
  if (!p) return;
  // Oynatıcı bir önceki çalışın sonunda durur: başa sarıp yeniden çal
  void p
    .seekTo(0)
    .then(() => p.play())
    .catch(() => undefined);
}

function play(event: SoundEvent): void {
  const name = EVENT_SOUND[event];
  if (name && allowed(name)) start(name);
}

/** Ayarlardaki dinleme düğmesi: açık/kapalı ayarlarına bakılmaz, seviye uygulanır */
export function previewSound(name: MobileSoundName): void {
  start(name);
}

/** Bu APK'da ses çalınabiliyor mu (eski APK'larda expo-audio yok) */
export function soundsAvailable(): boolean {
  return audio !== null;
}

/** Açılışta bir kez (sesli sohbete girilmeden önce) çağrılır; bkz. dosyanın başı */
export function setupSounds(): void {
  if (audio || requireOptionalNativeModule('ExpoAudio') === null) return;
  try {
    // Koşullu yükleme: modül yoksa paket hiç yüklenmez
    audio = require('expo-audio') as typeof ExpoAudio;
  } catch {
    audio = null;
    return;
  }
  if (Platform.OS !== 'ios') {
    audio
      .setAudioModeAsync({
        // Ses odağı istenmez: görüşme ve başka uygulamaların sesi kısılmaz
        interruptionMode: 'mixWithOthers',
        // Ekran kapalıyken de (biri kanala girdi) çalınabilsin
        shouldPlayInBackground: true,
        // Telefon sessizdeyken ya da titreşimdeyken arayüz sesi çalınmaz
        playsInSilentMode: false,
        shouldRouteThroughEarpiece: false,
      })
      .catch(() => undefined);
  }
  // İlk çalışta gecikme olmasın diye en sık kullanılanlar önceden hazırlanır
  for (const name of ['mute', 'unmute', 'join', 'leave'] as const) player(name);
  setFeedbackSound(play);
  // Seviye değişince hazır oynatıcılar da güncellenir
  useSettings.subscribe((next, prev) => {
    if (next.sfxVolume === prev.sfxVolume) return;
    for (const p of players.values()) p.volume = next.sfxVolume;
  });
}
