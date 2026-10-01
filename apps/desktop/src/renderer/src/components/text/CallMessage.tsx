import { memo } from 'react';
import { Phone, PhoneMissed } from 'lucide-react';
import type { User } from '@diskort/shared';
import type { LocalMessage } from '@diskort/client-core';
import { callRecordState, callRecordText } from '../../features/calls/callLogic';
import { cn } from '../../lib/utils';
import { formatFull, formatStamp } from './format';

/**
 * Arama kaydı (sunucunun konuşmaya yazdığı 'call' mesajı): tek satırlık sistem satırı, simge + "Ad arama
 * başlattı · 12 dk sürdü" / cevapsız arama. Düzenle, yanıtla ya da tepki yok.
 */
export const CallMessage = memo(function CallMessage({
  message,
  author,
  self,
}: {
  message: LocalMessage;
  author: User | undefined;
  self: User;
}) {
  const state = callRecordState(message);
  const missed = state.kind === 'missed';
  const own = message.authorId === self.id;
  const Icon = missed ? PhoneMissed : Phone;
  return (
    <div className="mt-[17px] flex items-center pr-12 pl-4 py-0.5" data-message-id={message.id}>
      <div className="flex w-14 shrink-0 justify-center pr-4">
        <Icon
          size={18}
          aria-hidden
          className={cn(missed && !own ? 'text-danger' : state.kind === 'ongoing' ? 'text-ok' : 'text-text-muted')}
        />
      </div>
      <div className="min-w-0 flex-1 text-sm text-text-muted">
        <span className="font-medium text-text-head">{author?.displayName ?? 'Silinmiş Kullanıcı'}</span>{' '}
        {callRecordText(state, own)}
        <span className="ml-2 text-xs text-text-faint" data-tooltip={formatFull(message.createdAt)}>
          {formatStamp(message.createdAt)}
        </span>
      </div>
    </div>
  );
});
