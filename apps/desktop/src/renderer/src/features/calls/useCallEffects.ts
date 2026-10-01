import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DmCall } from '@diskort/shared';
import { dmTitle, membersOf, useDmCall, useGuild, useIncomingCalls, useSession } from '@diskort/client-core';
import { bridge } from '../../lib/bridge';
import { setCallSound } from '../../lib/sfx';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { callKey, newIncomingCalls, wantedCallSounds } from './callLogic';

/** Gelen aramanın masaüstü bildirimi: başlık arayan (grupta "Ad · Grup"), dokununca konuşma açılır */
function showCallNotification(call: DmCall): Notification | null {
  const guild = useGuild.getState();
  const dm = guild.dms[call.channelId];
  if (!dm) return null;
  const caller = guild.users[call.startedBy]?.displayName ?? 'Biri';
  const title = dm.group ? `${caller} · ${dmTitle(dm, guild.users, useSession.getState().user?.id)}` : caller;
  try {
    const n = new Notification(title, {
      body: dm.group ? '📞 Grup araması: seni çağırıyor' : '📞 Seni arıyor',
      silent: true,
      requireInteraction: true,
    });
    n.onclick = () => {
      bridge?.showWindow();
      useUi.getState().setView({ kind: 'dm', channelId: call.channelId });
    };
    return n;
  } catch {
    return null; // bildirim izni yok: zil sesi ve pencere uyarısı yeter
  }
}

/**
 * Seni çalan aramalardan konuşması bilinenler (konuşma listesi henüz gelmediyse pencere çizilemez, zil de çalmaz)
 */
export function useKnownIncomingCalls(): DmCall[] {
  const calls = useIncomingCalls();
  const dms = useGuild((s) => s.dms);
  return useMemo(() => calls.filter((c) => dms[c.channelId]), [calls, dms]);
}

/**
 * Aramaların arka plan işleri (oturum açıkken bir kez): gelen arama sürdükçe zil sesi, aradığın kişi
 * henüz açmadıysa bekleme sesi; yeni gelen aramada pencere uyarısı ve (pencere odakta değilse) bildirim.
 */
export function useCallEffects(): void {
  const incoming = useKnownIncomingCalls();
  const selfId = useSession((s) => s.user?.id);
  const voiceChannelId = useVoice((s) => s.channelId);
  const inVoice = useVoice((s) => s.status !== 'idle');
  const call = useDmCall(voiceChannelId);
  const members = useGuild(
    useShallow((s) => (voiceChannelId ? membersOf(s.voiceStates, voiceChannelId).map((v) => v.userId) : [])),
  );
  const { ring, ringback } = wantedCallSounds({
    incoming: incoming.length,
    selfId,
    voiceChannelId,
    inVoice,
    call,
    members,
  });

  useEffect(() => setCallSound('ring', ring), [ring]);
  useEffect(() => setCallSound('ringback', ringback), [ringback]);
  useEffect(
    () => () => {
      setCallSound('ring', false);
      setCallSound('ringback', false);
    },
    [],
  );

  const seen = useRef(new Set<string>());
  const notifications = useRef(new Map<string, Notification>());
  useEffect(() => {
    const fresh = new Set(newIncomingCalls(seen.current, incoming));
    seen.current = new Set(incoming.map(callKey));
    // Artık çalmayan aramanın bildirimi kalkar
    for (const [key, n] of notifications.current) {
      if (!seen.current.has(key)) {
        n.close();
        notifications.current.delete(key);
      }
    }
    if (fresh.size === 0) return;
    bridge?.requestAttention();
    if (document.hasFocus()) return;
    for (const c of incoming) {
      const key = callKey(c);
      if (!fresh.has(key)) continue;
      const n = showCallNotification(c);
      if (n) notifications.current.set(key, n);
    }
  }, [incoming]);

  useEffect(
    () => () => {
      for (const n of notifications.current.values()) n.close();
      notifications.current.clear();
    },
    [],
  );
}
