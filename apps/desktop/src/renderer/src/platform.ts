// Masaüstünün ortak çekirdeğe (@diskort/client-core) verdiği platform ayrıntıları.
// main.tsx'te arayüzden önce içe aktarılır.
import { configureClient, dmTitle, useGuild, useSession } from '@diskort/client-core';
import type { DmChannel, Message } from '@diskort/shared';
import { bridge } from './lib/bridge';
import { currentView } from './lib/mainView';
import { playSound } from './lib/sfx';
import { getSettings } from './stores/settings';
import { toast, useUi } from './stores/ui';
import { useUpdate } from './stores/update';

/** Bildirim metni: mesajın başı, yalnızca dosya varsa dosya bilgisi */
function preview(message: Message): string {
  if (message.content) return message.content.length > 140 ? `${message.content.slice(0, 140)}…` : message.content;
  const files = message.attachments.length;
  return files > 1 ? `📎 ${files} dosya gönderdi` : files === 1 ? '📎 Bir dosya gönderdi' : '';
}

function showNotification(title: string, message: Message, open: () => void): void {
  try {
    const notification = new Notification(title, { body: preview(message), silent: true });
    notification.onclick = () => {
      bridge?.showWindow();
      open();
    };
  } catch {
    // bildirim izni yoksa yalnızca ses
  }
}

function showMentionNotification(message: Message): void {
  const guild = useGuild.getState();
  const author = message.authorId ? guild.users[message.authorId]?.displayName : undefined;
  const channel = guild.channels.find((c) => c.id === message.channelId)?.name;
  const replied = message.replyMentionUserId != null && message.replyMentionUserId === useSession.getState().user?.id;
  const action = replied ? 'sana yanıt verdi' : 'senden bahsetti';
  showNotification(`${author ?? 'Biri'} ${action} · #${channel ?? ''}`, message, () =>
    useUi.getState().setView({ kind: 'text', channelId: message.channelId }),
  );
}

function showDirectMessageNotification(message: Message, dm: DmChannel): void {
  const guild = useGuild.getState();
  const author = (message.authorId ? guild.users[message.authorId]?.displayName : undefined) ?? 'Biri';
  const title = dm.group ? `${author} · ${dmTitle(dm, guild.users, useSession.getState().user?.id)}` : author;
  showNotification(title, message, () => useUi.getState().setView({ kind: 'dm', channelId: dm.id }));
}

void configureClient({
  platform: 'desktop',
  version: __APP_VERSION__,
  storage: localStorage,
  serverUrl: () => getSettings().serverUrl,
  notifyError: (message) => toast(message, 'error'),
  isViewingChannel: (channelId) => {
    const view = currentView();
    return (view.kind === 'text' || view.kind === 'dm') && view.channelId === channelId && document.hasFocus();
  },
  onMention: (message) => {
    playSound('mention');
    bridge?.requestAttention();
    showMentionNotification(message);
  },
  onDirectMessage: (message, dm) => {
    playSound('mention');
    bridge?.requestAttention();
    showDirectMessageNotification(message, dm);
  },
  onUpdateRequired: (version) => useUpdate.setState({ required: version }),
  // Yeni sürüm yayınlandı: hemen arka planda indirmeye başla
  onUpdateAvailable: () => void bridge?.updates.check(),
});
