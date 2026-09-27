import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import {
  FEEDBACK_NOTE_MAX_LENGTH,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPES,
  type Feedback,
  type FeedbackStatus,
  type FeedbackType,
} from '@diskort/shared';
import { deleteFeedback, errorMessage, loadAllFeedback, updateFeedback, useFeedback, useGuild } from '@diskort/client-core';
import { confirmDialog } from '../../lib/dialog';
import { cn } from '../../lib/utils';
import { toast } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { Skeleton } from '../ui/Skeleton';
import { Button, Select } from '../ui/controls';
import { ContextTable, ScreenshotThumb, StatusBadge, TypeBadge, feedbackSummary, formatDate } from './common';

type Filter<T extends string> = T | 'all';

/** Sunucu Ayarları > Geri Bildirimler: liste (durum/tür süzgeci, en yeni önce) ve ayrıntı. */
export function FeedbackAdminSection() {
  const all = useFeedback((s) => s.all);
  const [status, setStatus] = useState<Filter<FeedbackStatus>>('all');
  const [type, setType] = useState<Filter<FeedbackType>>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAllFeedback().catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  const counts = useMemo(() => {
    const result = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0])) as Record<FeedbackStatus, number>;
    for (const f of all ?? []) result[f.status]++;
    return result;
  }, [all]);

  const visible = useMemo(
    () => (all ?? []).filter((f) => (status === 'all' || f.status === status) && (type === 'all' || f.type === type)),
    [all, status, type],
  );

  const selected = selectedId === null ? undefined : all?.find((f) => f.id === selectedId);
  if (selected) return <FeedbackDetail key={selected.id} item={selected} onBack={() => setSelectedId(null)} />;

  return (
    <div>
      <h2 className="mb-2 text-xl font-bold text-text-head">Geri Bildirimler</h2>
      <p className="mb-5 text-sm text-text-muted">
        Üyelerin gönderdiği hata ve öneriler. Durumu değiştirince gönderen görür; notunu da okuyabilir.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select
            aria-label="Durum"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all' as const, label: `Tüm durumlar (${all?.length ?? 0})` },
              ...FEEDBACK_STATUSES.map((s) => ({ value: s, label: `${FEEDBACK_STATUS_LABELS[s]} (${counts[s]})` })),
            ]}
          />
        </div>
        <div className="w-44">
          <Select
            aria-label="Tür"
            value={type}
            onChange={setType}
            options={[
              { value: 'all' as const, label: 'Tüm türler' },
              ...FEEDBACK_TYPES.map((t) => ({ value: t, label: FEEDBACK_TYPE_LABELS[t] })),
            ]}
          />
        </div>
      </div>

      {error ? (
        <div className="text-sm text-[#fa777c]">{error}</div>
      ) : all === null ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Yükleniyor">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-md bg-bg-side px-4 py-6 text-center text-sm text-text-muted">
          {all.length === 0 ? 'Henüz geri bildirim yok.' : 'Bu süzgece uyan geri bildirim yok.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visible.map((f) => (
            <FeedbackRow key={f.id} item={f} onOpen={() => setSelectedId(f.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Author({ userId, size = 20 }: { userId: string | null; size?: number }) {
  const user = useGuild((s) => (userId ? s.users[userId] : undefined));
  if (!user) return <span className="text-text-muted italic">Silinmiş kullanıcı</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar user={user} size={size} />
      <span className="truncate text-text-normal">{user.displayName}</span>
    </span>
  );
}

function FeedbackRow({ item, onOpen }: { item: Feedback; onOpen: () => void }) {
  return (
    <li>
      <button
        onClick={onOpen}
        className={cn(
          'flex w-full items-center gap-3 rounded-md bg-bg-side px-3 py-2.5 text-left transition-colors hover:bg-bg-hover',
          item.status === 'yeni' && 'border-l-4 border-brand',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className={cn('truncate text-text-head', item.status === 'yeni' ? 'font-semibold' : 'font-medium')}>
            {feedbackSummary(item)}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-text-muted">
            <TypeBadge type={item.type} />
            <span>#{item.id}</span>
            <Author userId={item.userId} size={16} />
            <span className="shrink-0">{formatDate(item.createdAt)}</span>
            {item.screenshots.length > 0 && <span className="shrink-0">· {item.screenshots.length} resim</span>}
          </div>
        </div>
        <StatusBadge status={item.status} />
      </button>
    </li>
  );
}

function FeedbackDetail({ item, onBack }: { item: Feedback; onBack: () => void }) {
  const [note, setNote] = useState(item.adminNote ?? '');
  const [saving, setSaving] = useState<'status' | 'note' | null>(null);

  const setStatus = async (status: FeedbackStatus): Promise<void> => {
    setSaving('status');
    try {
      await updateFeedback(item.id, { status });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(null);
    }
  };

  const saveNote = async (): Promise<void> => {
    setSaving('note');
    try {
      await updateFeedback(item.id, { adminNote: note.trim() || null });
      toast('Not kaydedildi.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(null);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Geri bildirimi sil',
      message: `#${item.id} ve ekran görüntüleri kalıcı olarak silinir. Gönderenin listesinden de kalkar.`,
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteFeedback(item.id);
      onBack();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const noteChanged = note.trim() !== (item.adminNote ?? '');

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm text-text-muted hover:text-text-normal">
        <ArrowLeft size={16} /> Tüm geri bildirimler
      </button>

      <div className="mb-1 flex items-center gap-2 text-sm text-text-muted">
        <TypeBadge type={item.type} />
        <span>#{item.id}</span>
      </div>
      <h2 className="mb-2 text-xl font-bold break-words text-text-head select-text">{feedbackSummary(item)}</h2>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-text-muted">
        <Author userId={item.userId} />
        <span>· {formatDate(item.createdAt)}</span>
        {item.updatedAt !== item.createdAt && <span>· güncellendi {formatDate(item.updatedAt)}</span>}
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-2 block text-xs font-bold tracking-wide text-text-muted uppercase">Durum</span>
          <div className="w-48">
            <Select
              aria-label="Durum"
              value={item.status}
              disabled={saving === 'status'}
              onChange={(s) => void setStatus(s)}
              options={FEEDBACK_STATUSES.map((s) => ({ value: s, label: FEEDBACK_STATUS_LABELS[s] }))}
            />
          </div>
        </label>
        <div className="flex-1" />
        <Button variant="danger" className="flex items-center gap-1.5" onClick={() => void remove()}>
          <Trash2 size={16} /> Sil
        </Button>
      </div>

      <h3 className="mb-2 text-xs font-bold tracking-wide text-text-muted uppercase">Açıklama</h3>
      <p className="mb-5 rounded-md bg-bg-side px-3 py-2.5 break-words whitespace-pre-wrap text-text-normal select-text">
        {item.body}
      </p>

      {item.screenshots.length > 0 && (
        <>
          <h3 className="mb-2 text-xs font-bold tracking-wide text-text-muted uppercase">Ekran görüntüleri</h3>
          <div className="mb-5 flex flex-wrap gap-2">
            {item.screenshots.map((s) => (
              <ScreenshotThumb key={s.id} shot={s} className="h-28 w-48" />
            ))}
          </div>
        </>
      )}

      <h3 className="mb-2 text-xs font-bold tracking-wide text-text-muted uppercase">Teknik bilgiler</h3>
      <div className="mb-5">
        {item.context ? (
          <ContextTable context={item.context} />
        ) : (
          <div className="text-sm text-text-muted">Gönderen teknik bilgileri eklememiş.</div>
        )}
      </div>

      <h3 className="mb-2 text-xs font-bold tracking-wide text-text-muted uppercase">Not (gönderen de görür)</h3>
      <textarea
        value={note}
        rows={3}
        maxLength={FEEDBACK_NOTE_MAX_LENGTH}
        onChange={(e) => setNote(e.target.value)}
        placeholder="ör. 0.4.5 sürümünde düzeltildi"
        className="block w-full resize-y rounded-[3px] border border-transparent bg-bg-input px-2.5 py-2 text-[15px] leading-snug text-text-normal outline-none transition-colors placeholder:text-text-faint hover:border-black/60 focus:border-brand/70"
      />
      <div className="mt-2 flex justify-end">
        <Button disabled={!noteChanged || saving === 'note'} onClick={() => void saveNote()}>
          {saving === 'note' ? 'Kaydediliyor…' : 'Notu kaydet'}
        </Button>
      </div>
    </div>
  );
}
