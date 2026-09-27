/**
 * İzlenen yayının sesi için kişi başı tercih: ses seviyesi (0–2) ve ayrı bir "sessize alındı" işareti.
 * Sessize almak seviyeyi silmez; sesi açınca son seviyeye dönülür. Tercih kalıcıdır ve yayın sesi izi
 * her geldiğinde (abonelik, yeniden bağlanma, yayının yeniden başlaması) buradan yeniden uygulanır.
 */
export interface StreamAudioPrefs {
  /** Yalnızca %100'den farklı seviyeler tutulur */
  streamVolumes: Record<string, number>;
  /** Yayın sesi sessize alınanlar */
  streamMuted: Record<string, true>;
}

/** Yayın sesine uygulanacak durum */
export interface StreamAudioOutput {
  /** Oynatma seviyesi (0–2); duyulmuyorsa 0 */
  volume: number;
  /** Sunucu bu sesi göndersin mi (sessizken gönderilmez: hem kesin sessizlik hem veri tasarrufu) */
  enabled: boolean;
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** Kaydedilmiş seviye (sessize alınmışsa da); yoksa %100 */
export function streamVolumeOf(prefs: StreamAudioPrefs, userId: string): number {
  const v = prefs.streamVolumes[userId];
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : 1;
}

/** Yayın sesi şu an duyulmuyor mu (sessize alınmış ya da seviyesi 0) */
export function isStreamMuted(prefs: StreamAudioPrefs, userId: string): boolean {
  return Boolean(prefs.streamMuted[userId]) || streamVolumeOf(prefs, userId) <= 0;
}

/** Arayüzde gösterilecek seviye: sessizken 0 */
export function shownStreamVolume(prefs: StreamAudioPrefs, userId: string): number {
  return isStreamMuted(prefs, userId) ? 0 : streamVolumeOf(prefs, userId);
}

/** Yayın sesine uygulanacak seviye ve gönderim durumu (sağırken hiçbir yayın duyulmaz) */
export function streamAudioOutput(prefs: StreamAudioPrefs, userId: string, deafened: boolean): StreamAudioOutput {
  const audible = !deafened && !isStreamMuted(prefs, userId);
  return { volume: audible ? streamVolumeOf(prefs, userId) : 0, enabled: audible };
}

/**
 * Sessize al / sesi aç. Açarken son seviyeye dönülür; seviye 0 kaydedilmişse (eski sürümlerde sessize
 * almak seviyeyi 0 yapıyordu) %100'e dönülür.
 */
export function toggleStreamMute(prefs: StreamAudioPrefs, userId: string): StreamAudioPrefs {
  if (!isStreamMuted(prefs, userId)) {
    return { ...prefs, streamMuted: { ...prefs.streamMuted, [userId]: true } };
  }
  const { [userId]: _muted, ...streamMuted } = prefs.streamMuted;
  let streamVolumes = prefs.streamVolumes;
  if (streamVolumeOf(prefs, userId) <= 0) {
    const { [userId]: _zero, ...rest } = prefs.streamVolumes;
    streamVolumes = rest;
  }
  return { streamVolumes, streamMuted };
}

/**
 * Kaydırıcıdan gelen seviye. 0'a çekmek sessize almaktır (önceki seviye korunur, açınca ona dönülür);
 * 0'dan büyük bir seviye sessizliği kaldırır. %100 kaydedilmez.
 */
export function setStreamVolume(prefs: StreamAudioPrefs, userId: string, volume: number): StreamAudioPrefs {
  const v = round(Math.min(2, Math.max(0, Number.isFinite(volume) ? volume : 1)));
  if (v <= 0) {
    return prefs.streamMuted[userId] ? prefs : { ...prefs, streamMuted: { ...prefs.streamMuted, [userId]: true } };
  }
  const { [userId]: _muted, ...streamMuted } = prefs.streamMuted;
  const { [userId]: _old, ...streamVolumes } = prefs.streamVolumes;
  if (Math.abs(v - 1) >= 0.005) streamVolumes[userId] = v;
  return { streamVolumes, streamMuted };
}
