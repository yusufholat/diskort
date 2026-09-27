import { useEffect, useState } from 'react';
import { Copy, Link2, Trash2 } from 'lucide-react';
import { Permission, type Invite } from '@diskort/shared';
import { api, errorMessage, guildInvites, inviteLink, useCan, useGuild, useSession } from '@diskort/client-core';
import { confirmDialog } from '../../lib/dialog';
import { cn } from '../../lib/utils';
import { toast } from '../../stores/ui';
import { Button, Field, SectionTitle, Select, Toggle } from '../ui/controls';

/** Davet bağlantısını ya da kodunu panoya kopyalar */
export async function copyInvite(code: string, asLink = true): Promise<void> {
  await navigator.clipboard.writeText(asLink ? inviteLink(code) : code).catch(() => undefined);
  toast(asLink ? 'Davet bağlantısı kopyalandı.' : 'Davet kodu kopyalandı.');
}

/**
 * Sunucunun davetleri. Davet oluşturma yetkisi olan (varsayılan: herkes) kendi davetlerini, Davetleri
 * Yönet yetkisi olan hepsini görür ve siler. Hesap yöneticisi ana sunucuda ayrıca yalnızca hesap açtıran
 * (sunucuya katılmayan) davet de oluşturabilir.
 */
export function InvitesSection() {
  const guildId = useGuild((s) => s.activeGuildId) ?? '';
  const isPrimary = useGuild((s) => s.activeGuildId !== null && s.activeGuildId === s.primaryGuildId);
  const instanceAdmin = useSession((s) => s.user?.isAdmin === true) && isPrimary;
  const canManage = useCan(Permission.MANAGE_INVITES);
  const users = useGuild((s) => s.users);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [maxUses, setMaxUses] = useState<number>(0);
  const [expires, setExpires] = useState<number>(168);
  const [accountOnly, setAccountOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    Promise.all([guildInvites.list(guildId), instanceAdmin ? api.listAccountInvites() : Promise.resolve([])])
      .then(([own, account]) => setInvites([...own, ...account].sort((a, b) => b.createdAt - a.createdAt)))
      .catch((err) => toast(errorMessage(err), 'error'));
  };
  useEffect(load, [guildId, instanceAdmin]);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const body = { maxUses: maxUses === 0 ? null : maxUses, expiresInHours: expires === 0 ? null : expires };
      const invite = accountOnly ? await api.createAccountInvite(body) : await guildInvites.create(guildId, body);
      await copyInvite(invite.code, !accountOnly);
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (inv: Invite): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Daveti sil',
      message: `${inv.code} daveti silinsin mi? Bu davetle artık katılınamaz ve kayıt olunamaz.`,
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    const request = inv.guildId ? guildInvites.remove(guildId, inv.code) : api.deleteAccountInvite(inv.code);
    request.then(load).catch((err) => toast(errorMessage(err), 'error'));
  };

  return (
    <div>
      <h2 className="mb-2 text-xl font-bold text-text-head">Davetler</h2>
      <p className="mb-5 text-sm text-text-muted">
        Davet bağlantısını arkadaşına gönder. Diskort'u kurduysa uygulamada <b>Sunucuya Katıl</b> düğmesine
        yapıştırır; hesabı yoksa giriş ekranında <b>Davet koduyla kaydol</b> seçeneğiyle hesap açar ve sunucuya
        katılır. Sunucudan ayrılan ya da atılan biri de yeni bir davetle geri dönebilir.
      </p>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
        <Field label="Kullanım hakkı">
          <Select
            value={maxUses}
            onChange={setMaxUses}
            options={[
              { value: 1, label: '1 kişi' },
              { value: 5, label: '5 kişi' },
              { value: 10, label: '10 kişi' },
              { value: 25, label: '25 kişi' },
              { value: 0, label: 'Sınırsız' },
            ]}
          />
        </Field>
        <Field label="Geçerlilik">
          <Select
            value={expires}
            onChange={setExpires}
            options={[
              { value: 1, label: '1 saat' },
              { value: 24, label: '1 gün' },
              { value: 168, label: '7 gün' },
              { value: 0, label: 'Süresiz' },
            ]}
          />
        </Field>
        <div className="mb-4">
          <Button disabled={busy} onClick={() => void create()}>
            Davet Oluştur
          </Button>
        </div>
      </div>
      {instanceAdmin && (
        <Toggle
          checked={accountOnly}
          onChange={setAccountOnly}
          label="Yalnızca hesap daveti"
          description="Kişi hesap açar ama hiçbir sunucuya katılmaz; kendi sunucusunu kurabilir ya da davetle katılır. Bunu yalnızca hesap yöneticileri oluşturabilir."
        />
      )}

      <SectionTitle>{canManage ? 'Aktif Davetler' : 'Oluşturduğun Davetler'}</SectionTitle>
      <div className="flex flex-col gap-1">
        {invites.length === 0 && <div className="text-sm text-text-muted">Henüz davet yok.</div>}
        {invites.map((inv) => {
          const expired = inv.expiresAt !== null && inv.expiresAt < Date.now();
          const used = inv.maxUses !== null && inv.uses >= inv.maxUses;
          const creator = users[inv.createdBy]?.displayName;
          return (
            <div key={inv.code} className="anim-rise-in flex items-center gap-3 rounded bg-bg-side px-3 py-2">
              <code className={cn('font-mono text-base text-text-head', (expired || used) && 'line-through opacity-50')}>
                {inv.code}
              </code>
              <span className="flex-1 text-xs text-text-muted">
                {inv.guildId === null && <span className="mr-1 rounded bg-warn/20 px-1 text-warn">Hesap daveti</span>}
                {inv.uses}/{inv.maxUses ?? '∞'} kullanım ·{' '}
                {inv.expiresAt ? `${new Date(inv.expiresAt).toLocaleString('tr-TR')} tarihine kadar` : 'süresiz'}
                {canManage && creator ? ` · ${creator}` : ''}
              </span>
              {inv.guildId !== null && (
                <button
                  data-tooltip="Bağlantıyı kopyala"
                  aria-label="Bağlantıyı kopyala"
                  className="press-icon rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-head"
                  onClick={() => void copyInvite(inv.code)}
                >
                  <Link2 size={16} />
                </button>
              )}
              <button
                data-tooltip="Kodu kopyala"
                aria-label="Kodu kopyala"
                className="press-icon rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-head"
                onClick={() => void copyInvite(inv.code, false)}
              >
                <Copy size={16} />
              </button>
              <button
                data-tooltip="Daveti sil"
                aria-label="Daveti sil"
                className="press-icon rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-danger"
                onClick={() => void remove(inv)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
