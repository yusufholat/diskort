import { useEffect, useState } from 'react';
import type { UserBlock } from '@diskort/shared';
import { loadBlocks, useBlockedIds } from '@diskort/client-core';
import { unblock } from '../../lib/blocks';
import { Avatar } from '../ui/Avatar';
import { Button, SectionTitle } from '../ui/controls';

/**
 * Hesabım → Engellenenler: engellediğin kişiler ve "Engeli kaldır". Liste yalnızca sende görünür; engel
 * başka yerden (menü, profil kartı, başka cihaz) değişince yeniden yüklenir.
 */
export function BlockedUsers() {
  const ids = useBlockedIds();
  const key = ids.join(',');
  const [blocks, setBlocks] = useState<UserBlock[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadBlocks().then((list) => {
      if (!cancelled && list) setBlocks(list);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Yükleme sürerken kaldırılanlar listeden hemen düşer
  const shown = blocks?.filter((b) => ids.includes(b.userId)) ?? null;

  return (
    <div>
      <SectionTitle>Engellenenler</SectionTitle>
      <p className="mb-3 text-sm text-text-muted">
        Engellediğin kişiyle bire bir konuşman salt okunur olur, sana yeni konuşma açamaz ve seni arayamaz. Sunucu
        kanallarında hiçbir şey değişmez; engellendiği ona söylenmez.
      </p>
      {shown === null ? (
        <div className="text-sm text-text-muted">Yükleniyor…</div>
      ) : shown.length === 0 ? (
        <div className="text-sm text-text-muted">Engellediğin kimse yok.</div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-line">
          {shown.map((b) => (
            <li key={b.userId} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <Avatar user={b.user ?? undefined} size={32} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate font-medium text-text-head">{b.user?.displayName ?? 'Silinmiş Kullanıcı'}</div>
                {b.user && <div className="truncate text-xs text-text-muted">@{b.user.username}</div>}
              </div>
              <Button
                variant="secondary"
                disabled={busy === b.userId}
                onClick={() => {
                  setBusy(b.userId);
                  void unblock(b.userId).finally(() => setBusy(null));
                }}
              >
                Engeli kaldır
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
