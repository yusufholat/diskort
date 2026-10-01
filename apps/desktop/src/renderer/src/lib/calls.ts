import { canCallDm, declineDmCall, useGuild, useSession } from '@diskort/client-core';
import { voice } from '../features/voice/voiceClient';
import { toast, useUi } from '../stores/ui';
import { useVoice } from '../stores/voice';

/**
 * Konuşmanın aramasına bağlanır: arama yoksa başlatır (sunucu diğerlerini çalar), varsa katılır. Ses
 * bağlantısı her zamanki ses istemcisiyle, kanal yerine konuşmanın kimliğiyle kurulur; sunucu kanalındaki
 * sesten çıkılır. Konuşma açılır (arama orada çizilir).
 */
export async function joinDmCall(dmId: string): Promise<void> {
  const selfId = useSession.getState().user?.id;
  const guild = useGuild.getState();
  if (!guild.dms[dmId]) return;
  if (!canCallDm(guild, selfId, dmId)) {
    toast('Bu konuşmada arama yapılamaz.', 'error');
    return;
  }
  if (selfId) guild.stopRingingLocally(dmId, selfId);
  useUi.getState().setView({ kind: 'dm', channelId: dmId });
  const v = useVoice.getState();
  if (v.channelId === dmId && v.status !== 'idle') return;
  await voice.join(dmId);
}

/** Gelen aramayı reddeder (yalnızca senin için çalma biter; arama sürer) */
export function declineCall(dmId: string): void {
  void declineDmCall(dmId);
}
