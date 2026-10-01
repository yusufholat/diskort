// Masaüstünün ortak çekirdeğe (@diskort/client-core) verdiği platform ayrıntıları.
// main.tsx'te arayüzden önce içe aktarılır.
import { channelById, configureClient, dmTitle, useGuild, useSession } from '@diskort/client-core';
import { GIF_SNIPPET, isGifMessage, type DmChannel, type Message } from '@diskort/shared';
import { bridge } from './lib/bridge';
import { startCrashReports } from './lib/crashReports';
import { currentView } from './lib/mainView';
import { playSound } from './lib/sfx';
import { getSettings } from './stores/settings';
import { toast, useUi } from './stores/ui';
import { useUpdate } from './stores/update';

/** Bildirim metni: mesajın başı, yalnızca dosya varsa dosya bilgisi */
function preview(message: Message): string {
  if (isGifMessage(message)) return GIF_SNIPPET;
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
  const found = channelById(guild, message.channelId);
  // Birden çok sunucu varsa hangi sunucudan geldiği de yazılır
  const guildName = found && guild.guildOrder.length > 1 ? ` (${guild.guilds[found.guildId]?.guild.name ?? ''})` : '';
  const channel = found ? `${found.name}${guildName}` : undefined;
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

const doNotDisturb = (): boolean => useGuild.getState().selfStatus?.status === 'dnd';

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
  // Rahatsız Etmeyin: bildirim, ses ve görev çubuğu uyarısı yok (okunmamış işaretleri yine güncellenir)
  onMention: (message) => {
    if (doNotDisturb()) return;
    playSound('mention');
    bridge?.requestAttention();
    showMentionNotification(message);
  },
  onDirectMessage: (message, dm) => {
    if (doNotDisturb()) return;
    playSound('mention');
    bridge?.requestAttention();
    showDirectMessageNotification(message, dm);
  },
  onUpdateRequired: (version) => useUpdate.setState({ required: version }),
  // Yeni sürüm yayınlandı: hemen arka planda indirmeye başla
  onUpdateAvailable: () => void bridge?.updates.check(),
})
  // Ana sürecin diske yazdığı süreç çökmesi bildirimleri (önceki oturumdan kalanlar dahil) sunucuya gönderilir
  .then(() => startCrashReports())
  .catch(() => undefined);
