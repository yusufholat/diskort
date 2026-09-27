// Arayüz sesleri (katıl, ayrıl, sustur, sağırlaştır, yayın, biri girdi/çıktı, bahsedilme, bağlantı): tek
// tanımdan (packages/client-core/src/sfx.ts) üretilmiş WAV dosyaları (scripts/generate-sounds.mjs; her ses
// paketi için ayrı klasör: assets/sounds/soft, assets/sounds/classic); masaüstü aynı sesleri çalar. expo-audio
// ile çalınır, haptics.ts'e takılır; çağıran yerler feedback('mute') / soundCue('userJoin') kullanır.
// Ayarlar → Ses: aç/kapat, seviye ("Ses efektleri"), ses paketi ve dinleme listesi.
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

import { OTHERS_SOUNDS, useGuild, useSession, type SoundName, type SoundPack } from '@diskort/client-core';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type * as ExpoAudio from 'expo-audio';
import { setFeedbackSound, type SoundEvent } from './haptics';
import { getSettings, useSettings } from './stores/settings';

/** Telefonda çalınan sesler (bas-konuş telefonda yok) */
export type MobileSoundName = Exclude<SoundName, 'pttOn' | 'pttOff'>;

// Metro yalnızca sabit yollu require() ile paketler: her paket için her dosya ayrı yazılır
const FILES: Record<SoundPack, Record<MobileSoundName, number>> = {
  soft: {
    join: require('../assets/sounds/soft/join.wav'),
    leave: require('../assets/sounds/soft/leave.wav'),
    userJoin: require('../assets/sounds/soft/userJoin.wav'),
    userLeave: require('../assets/sounds/soft/userLeave.wav'),
    mute: require('../assets/sounds/soft/mute.wav'),
    unmute: require('../assets/sounds/soft/unmute.wav'),
    deafen: require('../assets/sounds/soft/deafen.wav'),
    undeafen: require('../assets/sounds/soft/undeafen.wav'),
    streamStart: require('../assets/sounds/soft/streamStart.wav'),
    streamStop: require('../assets/sounds/soft/streamStop.wav'),
    userStreamStart: require('../assets/sounds/soft/userStreamStart.wav'),
    userStreamStop: require('../assets/sounds/soft/userStreamStop.wav'),
    mention: require('../assets/sounds/soft/mention.wav'),
    disconnect: require('../assets/sounds/soft/disconnect.wav'),
    reconnected: require('../assets/sounds/soft/reconnected.wav'),
  },
  classic: {
    join: require('../assets/sounds/classic/join.wav'),
    leave: require('../assets/sounds/classic/leave.wav'),
    userJoin: require('../assets/sounds/classic/userJoin.wav'),
    userLeave: require('../assets/sounds/classic/userLeave.wav'),
    mute: require('../assets/sounds/classic/mute.wav'),
    unmute: require('../assets/sounds/classic/unmute.wav'),
    deafen: require('../assets/sounds/classic/deafen.wav'),
    undeafen: require('../assets/sounds/classic/undeafen.wav'),
    streamStart: require('../assets/sounds/classic/streamStart.wav'),
    streamStop: require('../assets/sounds/classic/streamStop.wav'),
    userStreamStart: require('../assets/sounds/classic/userStreamStart.wav'),
    userStreamStop: require('../assets/sounds/classic/userStreamStop.wav'),
    mention: require('../assets/sounds/classic/mention.wav'),
    disconnect: require('../assets/sounds/classic/disconnect.wav'),
    reconnected: require('../assets/sounds/classic/reconnected.wav'),
  },
};

/** Ayarlardaki dinleme listesi */
export const MOBILE_SOUND_NAMES = Object.keys(FILES.soft) as MobileSoundName[];

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

/** Hazır oynatıcılar (seçili ses paketinin); paket değişince bırakılır, yenileri istendikçe açılır */
const players = new Map<MobileSoundName, ExpoAudio.AudioPlayer>();
let audio: typeof ExpoAudio | null = null;

function player(name: MobileSoundName): ExpoAudio.AudioPlayer | null {
  if (!audio) return null;
  let p = players.get(name);
  if (!p) {
    p = audio.createAudioPlayer(FILES[getSettings().soundPack][name], { keepAudioSessionActive: Platform.OS === 'ios' });
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
  useSettings.subscribe((next, prev) => {
    // Ses paketi değişince eski paketin oynatıcıları bırakılır (sıradaki çalışta yenisi açılır)
    if (next.soundPack !== prev.soundPack) {
      for (const p of players.values()) p.remove();
      players.clear();
    }
    // Seviye değişince hazır oynatıcılar da güncellenir
    if (next.sfxVolume !== prev.sfxVolume) for (const p of players.values()) p.volume = next.sfxVolume;
  });
}
