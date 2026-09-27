import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Pencil, SmilePlus, Trash2 } from 'lucide-react';
import { isImageAttachment, MESSAGE_MAX_LENGTH, MESSAGE_MAX_REACTIONS, Permission, type User } from '@diskort/shared';
import {
  deleteMessage,
  discardMessage,
  editMessage,
  isMentioned,
  useGuild,
  QUICK_REACTIONS,
  retryMessage,
  setEditing,
  toggleReaction,
  useCan,
  useMemberColor,
  type LocalMessage,
} from '@diskort/client-core';
import { renderMarkdown, type MarkdownContext } from '../../features/messages/markdown';
import { confirmDialog } from '../../lib/dialog';
import { startDm } from '../../lib/dm';
import { memberMenuItems } from '../../lib/memberMenu';
import { useMountedRef } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { toast, useUi, type EmojiPickerAnchor } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { downloadAttachment } from '../../features/messages/files';
import { AttachmentList, UploadList } from './Attachments';
import { formatFull, formatStamp, formatTime } from './format';
import { ReactionPill } from './ReactionPill';

interface Props {
  message: LocalMessage;
  author: User | undefined;
  /** Aynı yazarın art arda mesajı: avatar/başlık gösterilmez */
  compact: boolean;
  editing: boolean;
  self: User;
  md: MarkdownContext;
}

async function confirmDelete(message: LocalMessage, skipConfirm: boolean): Promise<void> {
  if (
    !skipConfirm &&
    !(await confirmDialog({
      title: 'Mesajı sil',
      message: 'Bu mesaj silinsin mi? Bu işlem geri alınamaz. İpucu: Shift basılıyken silersen onay sorulmaz.',
      confirmLabel: 'Sil',
      danger: true,
    }))
  ) {
    return;
  }
  void deleteMessage(message);
}

/** Mesajın üstündeki düğmelerdeki hızlı tepkiler */
const HOVER_REACTIONS = QUICK_REACTIONS.slice(0, 3);

export const MessageItem = memo(function MessageItem({ message, author, compact, editing, self, md }: Props) {
  const openContextMenu = useUi((s) => s.openContextMenu);
  const openEmojiPicker = useUi((s) => s.openEmojiPicker);
  // Mesaj ekrandayken eklenen tepkiler animasyonla belirir
  const mounted = useMountedRef();
  const own = message.authorId === self.id;
  // Başkasının mesajını kanalda MANAGE_MESSAGES yetkisi olan siler
  const canManage = useCan(Permission.MANAGE_MESSAGES, message.channelId);
  // Yeni tepki eklemek yetki ister; var olan tepkiye katılmak serbest
  const canReact = useCan(Permission.ADD_REACTIONS, message.channelId);
  const authorColor = useMemberColor(message.authorId);
  const canDelete = own || canManage;
  const confirmed = !message.status;
  const mentioned = isMentioned(message, self);
  // Yazara mesaj gönderilebilir mi: başkası, hâlâ üye ve zaten onunla bire bir konuşmada değiliz
  const inDirect = useGuild((s) => s.dms[message.channelId]?.group === false);
  const canMessageAuthor = !own && !inDirect && author !== undefined && !author.removed;
  /** Yazarın adına ya da resmine tıklayınca: kişi menüsü (mesaj gönder, ses seviyesi, yönetim) */
  const openAuthorMenu = (e: MouseEvent): void => {
    if (!author || author.removed) return;
    const items = memberMenuItems(author.id);
    if (own && items.length === 0) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openContextMenu({ x: rect.right + 8, y: rect.top, userId: own ? undefined : author.id, items });
  };
  const react = (emoji: string): void => void toggleReaction(message.channelId, message.id, emoji);
  const pickReaction = (anchor: EmojiPickerAnchor): void => openEmojiPicker({ anchor, onPick: react });

  const onContextMenu = (e: MouseEvent): void => {
    if (!confirmed) return;
    e.preventDefault();
    const selection = window.getSelection()?.toString();
    const point = { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY };
    // Sağ tıklanan dosya (resim ya da dosya kartı)
    const attachmentId = (e.target as HTMLElement).closest<HTMLElement>('[data-attachment-id]')?.dataset.attachmentId;
    const attachment = message.attachments.find((a) => a.id === attachmentId);
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(canReact ? [{ label: 'Tepki Ekle', onClick: () => pickReaction(point) }] : []),
        ...(canMessageAuthor && author ? [{ label: 'Yazara Mesaj Gönder', onClick: () => void startDm(author.id) }] : []),
        ...(attachment
          ? [
              {
                label: isImageAttachment(attachment) ? 'Resmi Kaydet' : 'Dosyayı İndir',
                onClick: () => downloadAttachment(attachment),
              },
            ]
          : []),
        ...(selection || message.content
          ? [
              {
                label: selection ? 'Seçimi Kopyala' : 'Metni Kopyala',
                onClick: () => void navigator.clipboard.writeText(selection || message.content),
              },
            ]
          : []),
        ...(own ? [{ label: 'Mesajı Düzenle', onClick: () => setEditing(message.id) }] : []),
        ...(canDelete
          ? [{ label: 'Mesajı Sil', danger: true, onClick: () => void confirmDelete(message, false) }]
          : []),
      ],
    });
  };

  return (
    <div
      className={cn(
        'group relative flex pr-12 pl-4 transition-colors duration-75 hover:bg-black/[0.06]',
        compact ? 'py-0.5' : 'mt-[17px] py-0.5',
        mentioned && 'border-l-2 border-warn bg-warn/[0.08] pl-[14px] hover:bg-warn/[0.12]',
        editing && 'bg-black/[0.06]',
      )}
      onContextMenu={onContextMenu}
      data-message-id={message.id}
    >
      <div className="w-14 shrink-0">
        {compact ? (
          <span
            className="block pt-[3px] pr-2 text-right text-[11px] text-text-faint opacity-0 transition-opacity duration-100 group-hover:opacity-100"
            data-tooltip={formatFull(message.createdAt)}
          >
            {formatTime(message.createdAt)}
          </span>
        ) : (
          <button
            type="button"
            className="mt-0.5 block rounded-full"
            aria-label={author ? `${author.displayName} kişisinin menüsü` : undefined}
            onClick={openAuthorMenu}
          >
            <Avatar user={author} size={40} />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2 leading-snug">
            <span
              className={cn('font-medium', author ? 'cursor-pointer text-text-head hover:underline' : 'text-text-muted italic')}
              style={author && authorColor ? { color: authorColor } : undefined}
              onClick={openAuthorMenu}
            >
              {author?.displayName ?? 'Silinmiş Kullanıcı'}
            </span>
            <span className="text-xs text-text-faint" data-tooltip={formatFull(message.createdAt)}>
              {formatStamp(message.createdAt)}
            </span>
          </div>
        )}

        {editing ? (
          <EditBox message={message} />
        ) : (
          (message.content || message.editedAt) && (
            <div
              className={cn(
                'leading-[1.375rem] break-words whitespace-pre-wrap text-text-normal select-text',
                message.status === 'pending' && 'opacity-50',
                message.status === 'failed' && 'text-danger',
              )}
            >
              {renderMarkdown(message.content, md)}
              {message.editedAt && (
                <span className="ml-1 text-[10px] text-text-faint select-none" data-tooltip={formatFull(message.editedAt)}>
                  (düzenlendi)
                </span>
              )}
            </div>
          )
        )}

        {message.uploads ? (
          <UploadList message={message} />
        ) : (
          message.attachments.length > 0 && <AttachmentList attachments={message.attachments} />
        )}

        {message.status === 'failed' && message.nonce && (
          <div className="mt-0.5 text-xs text-text-muted">
            Gönderilemedi.{' '}
            <button className="text-[#00a8fc] hover:underline" onClick={() => retryMessage(message.channelId, message.nonce!)}>
              Tekrar dene
            </button>{' '}
            ·{' '}
            <button className="text-[#00a8fc] hover:underline" onClick={() => discardMessage(message.channelId, message.nonce!)}>
              Vazgeç
            </button>
          </div>
        )}

        {message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {message.reactions.map((r) => (
              <ReactionPill
                key={r.emoji}
                emoji={r.emoji}
                count={r.count}
                me={r.me}
                animateIn={mounted.current}
                onToggle={() => react(r.emoji)}
              />
            ))}
            {canReact && message.reactions.length < MESSAGE_MAX_REACTIONS && (
              <button
                data-tooltip="Tepki ekle"
                aria-label="Tepki ekle"
                className="press-icon flex h-6 items-center rounded-lg bg-bg-side px-1.5 text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-head focus-visible:opacity-100"
                onClick={(e) => pickReaction(e.currentTarget.getBoundingClientRect())}
              >
                <SmilePlus size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      {confirmed && !editing && (canReact || own || canDelete) && (
        // Üstüne gelince hafifçe belirip yükselen düğme şeridi
        <div className="pointer-events-none absolute -top-4 right-4 flex translate-y-1 overflow-hidden rounded-md border border-black/30 bg-bg-main opacity-0 shadow transition-[opacity,translate] duration-100 ease-out group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
          {canReact &&
            HOVER_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                className="emoji flex w-8 items-center justify-center text-lg hover:bg-bg-hover"
                data-tooltip={`${emoji} tepkisi ver`}
                aria-label={`${emoji} tepkisi ver`}
                onClick={() => react(emoji)}
              >
                <span className="transition-transform duration-150 ease-out hover:scale-125">{emoji}</span>
              </button>
            ))}
          {canReact && (
            <button
              className="p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-head"
              data-tooltip="Tepki ekle"
              aria-label="Tepki ekle"
              onClick={(e) => pickReaction(e.currentTarget.getBoundingClientRect())}
            >
              <SmilePlus size={18} />
            </button>
          )}
          {own && (
            <button
              className="p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-head"
              data-tooltip="Düzenle"
              aria-label="Düzenle"
              onClick={() => setEditing(message.id)}
            >
              <Pencil size={18} />
            </button>
          )}
          {canDelete && (
            <button
              className="p-1.5 text-danger transition-colors hover:bg-bg-hover"
              data-tooltip="Sil (Shift ile onaysız)"
              aria-label="Sil"
              onClick={(e) => void confirmDelete(message, e.shiftKey)}
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

function EditBox({ message }: { message: LocalMessage }) {
  const [value, setValue] = useState(message.content);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
  }, [value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = (): void => {
    const content = value.trim();
    // Dosyası olmayan mesajın metni silinirse mesajın kendisi silinir (Discord gibi)
    if (!content && message.attachments.length === 0) {
      setEditing(null);
      void confirmDelete(message, false);
      return;
    }
    if (content.length > MESSAGE_MAX_LENGTH) {
      toast(`Mesaj en fazla ${MESSAGE_MAX_LENGTH} karakter olabilir.`, 'error');
      return;
    }
    setEditing(null);
    if (content !== message.content) void editMessage(message, content);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setEditing(null);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div className="anim-fade-in py-1">
      <textarea
        ref={ref}
        value={value}
        rows={1}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        className="block w-full resize-none rounded-lg border border-transparent bg-bg-hover px-4 py-2.5 leading-[1.375rem] text-text-normal outline-none transition-colors focus:border-brand/50"
      />
      <div className="mt-1 text-xs text-text-muted">
        iptal için <span className="text-[#00a8fc]">esc</span> • kaydetmek için{' '}
        <span className="text-[#00a8fc]">enter</span>
      </div>
    </div>
  );
}
