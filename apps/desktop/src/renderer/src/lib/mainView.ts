import { useMemo } from 'react';
import type { Channel, DmChannel } from '@diskort/shared';
import { useGuild } from '@diskort/client-core';
import { useUi, type View } from '../stores/ui';
import { useVoice } from '../stores/voice';

/** Ana alanda gerçekte gösterilen içerik (istenen görünüm artık geçerli değilse makul bir yedeğe düşer). */
export type ResolvedView =
  | { kind: 'voice' }
  | { kind: 'text'; channelId: string }
  | { kind: 'home' }
  | { kind: 'dm'; channelId: string }
  | { kind: 'dms' };

/** Direkt mesajlar bölümünde mi (sol çubukta konuşma listesi gösterilir) */
export const isDmSection = (view: ResolvedView): boolean => view.kind === 'dm' || view.kind === 'dms';

export function resolveView(
  view: View,
  lastTextChannelId: string | null,
  channels: Channel[],
  inVoice: boolean,
  dms: Record<string, DmChannel>,
): ResolvedView {
  if (view.kind === 'voice' && inVoice) return view;
  // Kapatılan ya da ayrılınan konuşma: konuşma listesi açık kalır
  if (view.kind === 'dm') return dms[view.channelId] ? view : { kind: 'dms' };
  if (view.kind === 'dms') return view;
  const text = channels.filter((c) => c.type === 'text');
  const wanted = view.kind === 'text' ? view.channelId : lastTextChannelId;
  const channel = text.find((c) => c.id === wanted) ?? text[0];
  if (channel) return { kind: 'text', channelId: channel.id };
  return inVoice ? { kind: 'voice' } : { kind: 'home' };
}

export function useMainView(): ResolvedView {
  const view = useUi((s) => s.view);
  const lastText = useUi((s) => s.lastTextChannelId);
  const channels = useGuild((s) => s.channels);
  const dms = useGuild((s) => s.dms);
  const inVoice = useVoice((s) => s.channelId !== null);
  return useMemo(() => resolveView(view, lastText, channels, inVoice, dms), [view, lastText, channels, inVoice, dms]);
}

export function currentView(): ResolvedView {
  const ui = useUi.getState();
  const guild = useGuild.getState();
  return resolveView(ui.view, ui.lastTextChannelId, guild.channels, useVoice.getState().channelId !== null, guild.dms);
}

/** Direkt mesajlar bölümüne geç: son açık konuşma hâlâ listedeyse o, yoksa konuşma listesi */
export function openDmSection(): void {
  const ui = useUi.getState();
  const last = ui.lastDmId;
  ui.setView(last && useGuild.getState().dms[last] ? { kind: 'dm', channelId: last } : { kind: 'dms' });
}

/** Topluluğa dön: son metin kanalı (ya da ilk kanal) */
export function openGuildSection(): void {
  const ui = useUi.getState();
  ui.setView(ui.lastTextChannelId ? { kind: 'text', channelId: ui.lastTextChannelId } : { kind: 'home' });
}
