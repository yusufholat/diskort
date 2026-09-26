import { useMemo } from 'react';
import type { Channel } from '@diskort/shared';
import { useGuild } from '@diskort/client-core';
import { useUi, type View } from '../stores/ui';
import { useVoice } from '../stores/voice';

/** Ana alanda gerçekte gösterilen içerik (istenen görünüm artık geçerli değilse makul bir yedeğe düşer). */
export type ResolvedView = { kind: 'voice' } | { kind: 'text'; channelId: string } | { kind: 'home' };

export function resolveView(
  view: View,
  lastTextChannelId: string | null,
  channels: Channel[],
  inVoice: boolean,
): ResolvedView {
  if (view.kind === 'voice' && inVoice) return view;
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
  const inVoice = useVoice((s) => s.channelId !== null);
  return useMemo(() => resolveView(view, lastText, channels, inVoice), [view, lastText, channels, inVoice]);
}

export function currentView(): ResolvedView {
  const ui = useUi.getState();
  return resolveView(ui.view, ui.lastTextChannelId, useGuild.getState().channels, useVoice.getState().channelId !== null);
}
