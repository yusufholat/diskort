import { useEffect, useState } from 'react';
import type { Ban } from '@diskort/shared';
import { api, errorMessage, moderation, useGuild } from '@diskort/client-core';
import { toast } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/controls';

/** Yasaklı hesaplar; yasak kalkınca kişi yeni bir davet koduyla geri dönebilir. */
export function BansSection() {
  const [bans, setBans] = useState<Ban[] | null>(null);
  const guildId = useGuild((s) => s.activeGuildId) ?? '';

  const load = (): void => {
    api
      .listBans(guildId)
      .then(setBans)
      .catch((err) => toast(errorMessage(err), 'error'));
  };
  useEffect(load, [guildId]);

  const unban = async (ban: Ban): Promise<void> => {
    if (!(await moderation.unban(ban.user.id))) return;
    toast(`${ban.user.displayName} kişisinin yasağı kaldırıldı. Yeni bir davetle geri dönebilir.`, 'success');
    load();
  };

  return (
    <div>
      <h2 className="mb-2 text-xl font-bold text-text-head">Yasaklar</h2>
      <p className="mb-5 text-sm text-text-muted">
        Yasaklı kişiler bu sunucuya davetle geri dönemez (hesapları ve diğer sunucuları etkilenmez). Yasağı kaldırılan
        kişi yeni bir davetle geri dönebilir.
      </p>
      {bans === null ? (
        <div className="text-sm text-text-muted">Yükleniyor…</div>
      ) : bans.length === 0 ? (
        <div className="text-sm text-text-muted">Yasaklı kimse yok.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {bans.map((ban) => (
            <div key={ban.user.id} className="flex items-center gap-3 rounded-md bg-bg-side px-3 py-2">
              <Avatar user={ban.user} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-text-head">
                  {ban.user.displayName} <span className="text-xs font-normal text-text-muted">@{ban.user.username}</span>
                </div>
                <div className="truncate text-xs text-text-muted">
                  {new Date(ban.bannedAt).toLocaleString('tr-TR')}
                  {ban.reason ? ` · ${ban.reason}` : ' · sebep belirtilmedi'}
                </div>
              </div>
              <Button variant="secondary" className="h-8" onClick={() => void unban(ban)}>
                Yasağı Kaldır
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
