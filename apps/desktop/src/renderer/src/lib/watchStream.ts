import { Permission } from '@diskort/shared';
import { can, useGuild, useSession } from '@diskort/client-core';
import { voice } from '../features/voice/voiceClient';
import { toast, useUi } from '../stores/ui';
import { useVoice } from '../stores/voice';

/**
 * Üyenin yayınını izlemeye başlar (Discord'da "CANLI"ya tıklamak gibi): o ses kanalında değilsen önce
 * kanala katılır, sonra yayını açar ve ses sahnesine geçer. Kendi yayınınsa yalnızca onu öne alır.
 */
export async function watchUserStream(userId: string, channelId: string): Promise<void> {
  const selfId = useSession.getState().user?.id;
  const current = useVoice.getState();
  if (current.channelId !== channelId || current.status === 'idle') {
    if (!can(useGuild.getState(), selfId, Permission.CONNECT, channelId)) {
      toast('Bu ses kanalına bağlanma iznin yok.', 'error');
      return;
    }
    await voice.join(channelId);
    const joined = useVoice.getState();
    if (joined.channelId !== channelId || joined.status === 'idle') return;
  }
  if (userId === selfId) voice.focusStream(userId);
  else voice.watchStream(userId);
  useUi.getState().setView({ kind: 'voice' });
}
