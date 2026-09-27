import { useEffect } from 'react';
import { FEEDBACK_STATUS_LABELS } from '@diskort/shared';
import { onOwnFeedbackUpdate } from '@diskort/client-core';
import { toast } from '../../stores/ui';

/** Kendi geri bildirimimin durumu değişince kısa bir bildirim (ör. "tamamlandı"). */
export function useFeedbackToasts(): void {
  useEffect(
    () =>
      onOwnFeedbackUpdate((item, previous) => {
        if (previous && previous.status === item.status) return;
        const title = item.title ?? item.body.split('\n')[0]!.slice(0, 40);
        toast(
          `Geri bildirimin “${title}” → ${FEEDBACK_STATUS_LABELS[item.status]}`,
          item.status === 'tamamlandi' ? 'success' : 'info',
        );
      }),
    [],
  );
}
