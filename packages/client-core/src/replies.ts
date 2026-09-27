import type { Message } from '@diskort/shared';
import { focusComposer } from './composer';
import { env } from './env';
import { loadOlder, useMessages, type ReplyDraft } from './messages';
import { useSession } from './session';

// Discord'daki gibi yanıtlar: mesaja "Yanıtla" denince yazma kutusunun üstünde "… kişisine yanıt
// veriliyor" belirir, gönderilen mesaj ona yanıt olur (bkz. sendMessage). Yanıtın üstündeki alıntıya
// tıklayınca asıl mesaja atlanır.

/** Mesaja yanıt vermeye başlar ve yazma kutusuna odaklanır. Asıl yazar varsayılan olarak bildirilir. */
export function startReply(message: Pick<Message, 'id' | 'channelId' | 'authorId'>): void {
  const draft: ReplyDraft = { messageId: message.id, authorId: message.authorId, mention: true };
  useMessages.setState((s) => ({ replies: { ...s.replies, [message.channelId]: draft } }));
  focusComposer(message.channelId);
}

export function cancelReply(channelId: string): void {
  if (!useMessages.getState().replies[channelId]) return;
  useMessages.setState((s) => {
    const { [channelId]: _cancelled, ...replies } = s.replies;
    return { replies };
  });
}

/** "@ AÇIK / KAPALI": asıl yazar bildirilsin mi */
export function setReplyMention(channelId: string, mention: boolean): void {
  const draft = useMessages.getState().replies[channelId];
  if (!draft || draft.mention === mention) return;
  useMessages.setState((s) => ({ replies: { ...s.replies, [channelId]: { ...draft, mention } } }));
}

/** Yanıtlanan mesaj kendi mesajımızsa bildirim seçeneği gösterilmez (kimse bildirilmez) */
export function isOwnReplyTarget(draft: ReplyDraft): boolean {
  return draft.authorId === useSession.getState().user?.id;
}

// ---------- Asıl mesaja atlama ----------

/** Atlarken geçmiş bu büyüklükte sayfalarla, en fazla bu kadar sayfa yüklenir (1000 mesaj) */
const JUMP_PAGE_SIZE = 100;
const JUMP_MAX_PAGES = 10;

let jumpSeq = 0;

const isLoaded = (channelId: string, messageId: string): boolean =>
  useMessages.getState().channels[channelId]?.messages.some((m) => m.id === messageId && !m.status) ?? false;

/** Kanalın süren bir geçmiş yüklemesi varsa bitmesini bekler */
function idle(channelId: string): Promise<void> {
  if (!useMessages.getState().channels[channelId]?.loading) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useMessages.subscribe((s) => {
      if (s.channels[channelId]?.loading) return;
      unsubscribe();
      resolve();
    });
  });
}

/**
 * Kanaldaki bir mesaja atlar: yüklü değilse geçmiş, mesaj gelene kadar geriye doğru yüklenir (liste
 * hep "şimdi"ye kadar kesintisiz kalır). Bulununca `jump` isteği yayınlanır; arayüz mesaja kaydırıp
 * vurgular. Mesaj silinmişse ya da çok eskideyse hata gösterilir ve false döner.
 */
export async function jumpToMessage(
  channelId: string,
  messageId: string,
  opts: { maxPages?: number; notFound?: string } = {},
): Promise<boolean> {
  const target = Number(messageId);
  const maxPages = opts.maxPages ?? JUMP_MAX_PAGES;
  for (let page = 0; page < maxPages && !isLoaded(channelId, messageId); page++) {
    await idle(channelId);
    if (isLoaded(channelId, messageId)) break;
    const channel = useMessages.getState().channels[channelId];
    const oldest = channel?.messages.find((m) => !m.status);
    // Yüklü en eski mesajdan daha yeniyse ve listede yoksa silinmiştir
    if (!channel?.loaded || !channel.hasMore || !oldest || Number(oldest.id) < target) break;
    await loadOlder(channelId, JUMP_PAGE_SIZE);
    // Yükleme başarısızsa (hata zaten gösterildi) tekrar tekrar denenmez
    const after = useMessages.getState().channels[channelId];
    if (after?.hasMore && after.messages.find((m) => !m.status)?.id === oldest.id) return false;
  }
  if (!isLoaded(channelId, messageId)) {
    env().notifyError(opts.notFound ?? 'Asıl mesaj bulunamadı; silinmiş ya da çok eskide kalmış olabilir.');
    return false;
  }
  useMessages.setState({ jump: { channelId, messageId, seq: ++jumpSeq } });
  return true;
}

/** Arayüz atlamayı gerçekleştirdi (liste yeniden açılınca tekrar atlanmasın) */
export function clearJump(seq: number): void {
  if (useMessages.getState().jump?.seq === seq) useMessages.setState({ jump: null });
}
