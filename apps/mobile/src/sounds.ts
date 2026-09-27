// Sesli sohbet sesleri (katıl, ayrıl, sustur, sağırlaştır, yayın, biri girdi/çıktı): masaüstündekilerle
// aynı notalar (scripts/generate-sounds.mjs), expo-audio ile çalınır. haptics.ts'e takılır; çağıran yerler
// feedback('mute') / soundCue('userJoin') kullanır. Ayarlar → Ses → "Sesli sohbet sesleri" ile kapatılır.
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

import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type * as ExpoAudio from 'expo-audio';
import { setFeedbackSound, type SoundEvent } from './haptics';
import { getSettings } from './stores/settings';

type SoundName =
  | 'join'
  | 'leave'
  | 'userJoin'
  | 'userLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'streamStart'
  | 'streamStop';

const FILES: Record<SoundName, number> = {
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
};

/** Olay → ses. Hoparlör, yönetim ve hata olaylarının sesi yok (masaüstünde de yok), yalnızca titreşim. */
const EVENT_SOUND: Partial<Record<SoundEvent, SoundName>> = {
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
};

/** Dosyalar yüksek seviyede yazıldı; telefonda görüşmenin üstüne binmeyecek seviye */
const VOLUME = 0.6;

const players = new Map<SoundName, ExpoAudio.AudioPlayer>();
let audio: typeof ExpoAudio | null = null;

function player(name: SoundName): ExpoAudio.AudioPlayer | null {
  if (!audio) return null;
  let p = players.get(name);
  if (!p) {
    p = audio.createAudioPlayer(FILES[name], { keepAudioSessionActive: Platform.OS === 'ios' });
    p.volume = VOLUME;
    players.set(name, p);
  }
  return p;
}

function play(event: SoundEvent): void {
  const name = EVENT_SOUND[event];
  if (!name) return;
  const s = getSettings();
  // Sağırlaştırılmışken ses yok; "sağırlaştır" sesi ise tam o an duyulur (masaüstündeki gibi)
  if (!s.sounds || (s.selfDeaf && event !== 'deafen')) return;
  const p = player(name);
  if (!p) return;
  // Oynatıcı bir önceki çalışın sonunda durur: başa sarıp yeniden çal
  void p
    .seekTo(0)
    .then(() => p.play())
    .catch(() => undefined);
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
}
