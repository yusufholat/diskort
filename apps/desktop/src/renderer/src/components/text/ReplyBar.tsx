import { AtSign, CircleX } from 'lucide-react';
import {
  cancelReply,
  isOwnReplyTarget,
  setReplyMention,
  useGuild,
  useMemberColor,
  useMessages,
} from '@diskort/client-core';
import { useEscapeLayer } from '../../lib/escape';
import { usePresence } from '../../lib/motion';
import { cn } from '../../lib/utils';

/**
 * Yazma kutusunun üst şeridi (Discord'daki gibi): "@Ad kişisine yanıt veriliyor", asıl yazarın
 * bildirilip bildirilmeyeceği (@ AÇIK / KAPALI) ve iptal. Esc de yanıtı iptal eder.
 */
export function ReplyBar({ channelId }: { channelId: string }) {
  const draft = useMessages((s) => s.replies[channelId]);
  const { value: shown, closing } = usePresence(draft, 100);
  const author = useGuild((s) => (shown?.authorId ? s.users[shown.authorId] : undefined));
  const color = useMemberColor(shown?.authorId);
  useEscapeLayer(() => cancelReply(channelId), Boolean(draft));

  if (!shown) return null;
  const own = isOwnReplyTarget(shown);

  return (
    <div
      className={cn(
        'flex h-9 items-center gap-2 rounded-t-lg border-b border-black/20 bg-bg-side pr-2 pl-4 text-sm text-text-muted',
        closing ? 'anim-fade-out' : 'anim-slide-down',
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold text-text-normal" style={color ? { color } : undefined}>
          @{author?.displayName ?? 'Silinmiş Kullanıcı'}
        </span>{' '}
        kişisine yanıt veriliyor
      </span>
      {!own && (
        <button
          type="button"
          aria-pressed={shown.mention}
          aria-label={shown.mention ? 'Bildirim açık' : 'Bildirim kapalı'}
          data-tooltip={
            shown.mention
              ? 'Asıl yazara bildirim gidecek. Kapatmak için tıkla.'
              : 'Asıl yazara bildirim gitmeyecek. Açmak için tıkla.'
          }
          className={cn(
            'press flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-bold transition-colors hover:bg-bg-hover',
            shown.mention ? 'text-[#00a8fc]' : 'text-text-muted',
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setReplyMention(channelId, !shown.mention)}
        >
          <AtSign size={15} strokeWidth={2.5} />
          {shown.mention ? 'AÇIK' : 'KAPALI'}
        </button>
      )}
      <span className="h-4 w-px bg-line" />
      <button
        type="button"
        aria-label="Yanıtı iptal et"
        data-tooltip="Yanıtı iptal et (Esc)"
        className="press-icon rounded-full p-0.5 text-text-muted transition-colors hover:text-text-head"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => cancelReply(channelId)}
      >
        <CircleX size={18} />
      </button>
    </div>
  );
}
