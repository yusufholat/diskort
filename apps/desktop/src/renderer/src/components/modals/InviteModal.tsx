import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Permission, type Invite } from '@diskort/shared';
import { errorMessage, guildInvites, inviteLink, useCan, useGuild, useSession } from '@diskort/client-core';
import { useUi } from '../../stores/ui';
import { Modal } from '../ui/Modal';
import { Button, TextInput } from '../ui/controls';

/** Arkadaşlarını davet et: 7 gün geçerli bir davet bağlantısı oluşturur ve kopyalamayı kolaylaştırır. */
export function InviteModal() {
  const close = useUi((s) => s.closeModal);
  const openModal = useUi((s) => s.openModal);
  const guildId = useGuild((s) => s.activeGuildId) ?? '';
  const guildName = useGuild((s) => s.guild?.name ?? '');
  const canCreate = useCan(Permission.CREATE_INVITE);
  const canManage = useCan(Permission.MANAGE_INVITES);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!guildId || !(canCreate || canManage)) return;
    let cancelled = false;
    // Her açılışta yeni davet birikmesin: kendi oluşturduğun, en az bir gün daha geçerli sınırsız davet kullanılır
    const selfId = useSession.getState().user?.id;
    guildInvites
      .list(guildId)
      .then((list) => {
        const reusable = list.find(
          (i) => i.createdBy === selfId && i.maxUses === null && i.expiresAt !== null && i.expiresAt > Date.now() + 86_400_000,
        );
        return reusable ?? guildInvites.create(guildId, { maxUses: null, expiresInHours: 168 });
      })
      .then((found) => !cancelled && setInvite(found))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [guildId, canCreate, canManage]);

  const link = invite ? inviteLink(invite.code) : '';
  const copy = (): void => {
    if (!link) return;
    void navigator.clipboard.writeText(link).then(() => setCopied(true));
  };

  return (
    <Modal title={`Arkadaşlarını ${guildName} sunucusuna davet et`} onClose={close}>
      {!(canCreate || canManage) ? (
        <p className="text-sm text-text-muted">Bu sunucuya davet oluşturma yetkin yok.</p>
      ) : (
        <>
          <p className="mb-2 text-sm text-text-muted">
            Bu bağlantıyı gönder. Diskort'u kuran arkadaşın <b>Sunucuya Katıl</b> ekranına yapıştırır; hesabı yoksa
            giriş ekranında <b>Davet koduyla kaydol</b> seçeneğiyle hesap açar ve doğrudan bu sunucuya katılır.
          </p>
          <div className="flex gap-2">
            <TextInput readOnly value={error ?? (link || 'Oluşturuluyor…')} onFocus={(e) => e.currentTarget.select()} />
            <Button disabled={!link} variant={copied ? 'success' : 'primary'} onClick={copy} className="flex shrink-0 items-center gap-1.5">
              <Copy size={16} />
              {copied ? 'Kopyalandı' : 'Kopyala'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Davet en az 1 gün daha geçerli, kullanım sınırı yok{invite ? ` · Kod: ${invite.code}` : ''}.{' '}
            <button
              type="button"
              className="text-[#00a8fc] hover:underline"
              onClick={() => openModal({ type: 'serverSettings', section: 'invites' })}
            >
              Davet ayarları
            </button>
          </p>
        </>
      )}
    </Modal>
  );
}
