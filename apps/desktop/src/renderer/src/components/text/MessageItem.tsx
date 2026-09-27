import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Pencil, SmilePlus, Trash2 } from 'lucide-react';
import { isImageAttachment, MESSAGE_MAX_LENGTH, MESSAGE_MAX_REACTIONS, type User } from '@diskort/shared';
import {
  deleteMessage,
  discardMessage,
  editMessage,
  mentions,
  QUICK_REACTIONS,
  retryMessage,
  setEditing,
  toggleReaction,
  type LocalMessage,
} from '@diskort/client-core';
import { renderMarkdown, type MarkdownContext } from '../../features/messages/markdown';
import { cn } from '../../lib/utils';
import { toast, useUi, type EmojiPickerAnchor } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { downloadAttachment } from '../../features/messages/files';
import { AttachmentList, UploadList } from './Attachments';
import { formatFull, formatStamp, formatTime } from './format';

interface Props {
  message: LocalMessage;
  author: User | undefined;
  /** Aynı yazarın art arda mesajı: avatar/başlık gösterilmez */
  compact: boolean;
  editing: boolean;
  self: User;
  md: MarkdownContext;
}

function confirmDelete(message: LocalMessage, skipConfirm: boolean): void {
  if (!skipConfirm && !window.confirm('Bu mesaj silinsin mi?')) return;
  void deleteMessage(message);
}

/** Mesajın üstündeki düğmelerdeki hızlı tepkiler */
const HOVER_REACTIONS = QUICK_REACTIONS.slice(0, 3);

export const MessageItem = memo(function MessageItem({ message, author, compact, editing, self, md }: Props) {
  const openContextMenu = useUi((s) => s.openContextMenu);
  const openEmojiPicker = useUi((s) => s.openEmojiPicker);
  const own = message.authorId === self.id;
  const canDelete = own || self.isAdmin;
  const confirmed = !message.status;
  const mentioned = !own && mentions(message.content, self.username);
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
        { label: 'Tepki Ekle', onClick: () => pickReaction(point) },
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
          ? [{ label: 'Mesajı Sil', danger: true, onClick: () => confirmDelete(message, false) }]
          : []),
      ],
    });
  };

  return (
    <div
      className={cn(
        'group relative flex pr-12 pl-4 hover:bg-black/[0.06]',
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
            className="invisible block pt-[3px] pr-2 text-right text-[11px] text-text-faint group-hover:visible"
            title={formatFull(message.createdAt)}
          >
            {formatTime(message.createdAt)}
          </span>
        ) : (
          <Avatar user={author} size={40} className="mt-0.5" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2 leading-snug">
            <span className={cn('font-medium', author ? 'text-text-head' : 'text-text-muted italic')}>
              {author?.displayName ?? 'Silinmiş Kullanıcı'}
            </span>
            <span className="text-xs text-text-faint" title={formatFull(message.createdAt)}>
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
                <span className="ml-1 text-[10px] text-text-faint select-none" title={formatFull(message.editedAt)}>
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
              <button
                key={r.emoji}
                title={r.me ? 'Tepkini geri al' : 'Sen de tepki ver'}
                className={cn(
                  'flex h-6 items-center gap-1.5 rounded-lg border px-1.5 transition-colors',
                  r.me
                    ? 'border-brand bg-brand/20 text-text-head'
                    : 'border-transparent bg-bg-side text-text-muted hover:border-line hover:text-text-normal',
                )}
                onClick={() => react(r.emoji)}
              >
                <span className="emoji text-base leading-none">{r.emoji}</span>
                <span className="min-w-2 text-xs font-semibold">{r.count}</span>
              </button>
            ))}
            {message.reactions.length < MESSAGE_MAX_REACTIONS && (
              <button
                title="Tepki ekle"
                className="invisible flex h-6 items-center rounded-lg bg-bg-side px-1.5 text-text-muted group-hover:visible hover:text-text-head"
                onClick={(e) => pickReaction(e.currentTarget.getBoundingClientRect())}
              >
                <SmilePlus size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      {confirmed && !editing && (
        <div className="absolute -top-4 right-4 hidden overflow-hidden rounded-md border border-black/30 bg-bg-main shadow group-hover:flex">
          {HOVER_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              className="emoji flex w-8 items-center justify-center text-lg hover:bg-bg-hover"
              title={`${emoji} tepkisi ver`}
              onClick={() => react(emoji)}
            >
              {emoji}
            </button>
          ))}
          <button
            className="p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-head"
            title="Tepki ekle"
            onClick={(e) => pickReaction(e.currentTarget.getBoundingClientRect())}
          >
            <SmilePlus size={18} />
          </button>
          {own && (
            <button
              className="p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-head"
              title="Düzenle"
              onClick={() => setEditing(message.id)}
            >
              <Pencil size={18} />
            </button>
          )}
          {canDelete && (
            <button
              className="p-1.5 text-danger hover:bg-bg-hover"
              title="Sil (Shift ile onaysız)"
              onClick={(e) => confirmDelete(message, e.shiftKey)}
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
      confirmDelete(message, false);
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
    <div className="py-1">
      <textarea
        ref={ref}
        value={value}
        rows={1}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        className="block w-full resize-none rounded-lg bg-bg-hover px-4 py-2.5 leading-[1.375rem] text-text-normal outline-none"
      />
      <div className="mt-1 text-xs text-text-muted">
        iptal için <span className="text-[#00a8fc]">esc</span> • kaydetmek için{' '}
        <span className="text-[#00a8fc]">enter</span>
      </div>
    </div>
  );
}
