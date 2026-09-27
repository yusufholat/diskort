// Masaüstünün ortak çekirdeğe (@diskort/client-core) verdiği platform ayrıntıları.
// main.tsx'te arayüzden önce içe aktarılır.
import { configureClient, useGuild, useSession } from '@diskort/client-core';
import type { Message } from '@diskort/shared';
import { bridge } from './lib/bridge';
import { currentView } from './lib/mainView';
import { playSound } from './lib/sfx';
import { getSettings } from './stores/settings';
import { toast, useUi } from './stores/ui';
import { useUpdate } from './stores/update';

function showMentionNotification(message: Message): void {
  const guild = useGuild.getState();
  const author = message.authorId ? guild.users[message.authorId]?.displayName : undefined;
  const channel = guild.channels.find((c) => c.id === message.channelId)?.name;
  const replied = message.replyMentionUserId !== undefined && message.replyMentionUserId === useSession.getState().user?.id;
  const text = message.content || (message.attachments.length ? '📎 Dosya gönderdi' : '');
  try {
    const notification = new Notification(
      `${author ?? 'Biri'} ${replied ? 'sana yanıt verdi' : 'senden bahsetti'} · #${channel ?? ''}`,
      { body: text.length > 140 ? `${text.slice(0, 140)}…` : text, silent: true },
    );
    notification.onclick = () => {
      bridge?.showWindow();
      useUi.getState().setView({ kind: 'text', channelId: message.channelId });
    };
  } catch {
    // bildirim izni yoksa yalnızca ses
  }
}

void configureClient({
  platform: 'desktop',
  version: __APP_VERSION__,
  storage: localStorage,
  serverUrl: () => getSettings().serverUrl,
  notifyError: (message) => toast(message, 'error'),
  isViewingChannel: (channelId) => {
    const view = currentView();
    return view.kind === 'text' && view.channelId === channelId && document.hasFocus();
  },
  onMention: (message) => {
    playSound('mention');
    bridge?.requestAttention();
    showMentionNotification(message);
  },
  onUpdateRequired: (version) => useUpdate.setState({ required: version }),
  // Yeni sürüm yayınlandı: hemen arka planda indirmeye başla
  onUpdateAvailable: () => void bridge?.updates.check(),
});
