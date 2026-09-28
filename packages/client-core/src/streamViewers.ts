import type { VoiceState } from '@diskort/shared';
import { useShallow } from 'zustand/react/shallow';
import { useGuild } from './guild';

// Yayın izleyicileri: her katılımcının ses durumunda izlediği yayınlar (`watching`) bulunur; sunucu bunu
// istemcinin bildiriminden türetir (aynı kanalda, yayında olanlar). Yayıncı kendi izleyicisi sayılmaz.

/** Yayıncıyı izleyenler, kanala katılma sırasıyla (yayında değilse boş) */
export function streamViewers(voiceStates: Record<string, VoiceState>, streamerId: string): string[] {
  const streamer = voiceStates[streamerId];
  if (!streamer?.streaming) return [];
  return Object.values(voiceStates)
    .filter((v) => v.userId !== streamerId && v.channelId === streamer.channelId && v.watching?.includes(streamerId))
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((v) => v.userId);
}

/** Yayıncıyı izleyenler (liste değişmedikçe aynı dizi) */
export function useStreamViewers(streamerId: string): string[] {
  return useGuild(useShallow((s) => streamViewers(s.voiceStates, streamerId)));
}
