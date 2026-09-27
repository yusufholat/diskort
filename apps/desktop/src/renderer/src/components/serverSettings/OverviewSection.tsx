import { useMemo, useState } from 'react';
import { Crown } from 'lucide-react';
import { GUILD_NAME_MAX_LENGTH, Permission } from '@diskort/shared';
import { api, errorMessage, isOwner, useCan, useGuild, useSession } from '@diskort/client-core';
import { confirmDialog } from '../../lib/dialog';
import { toast } from '../../stores/ui';
import { Button, Divider, Field, Select, TextInput } from '../ui/controls';

/** Sunucunun adı ve sahipliğin devri. */
export function OverviewSection() {
  const guild = useGuild((s) => s.guild);
  const users = useGuild((s) => s.users);
  const selfId = useSession((s) => s.user?.id);
  const owner = useGuild((s) => isOwner(s, selfId));
  const canManage = useCan(Permission.MANAGE_GUILD);
  const [name, setName] = useState(guild?.name ?? '');
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(
    () =>
      Object.values(users)
        .filter((u) => !u.removed && u.id !== selfId)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr')),
    [users, selfId],
  );
  const [nextOwner, setNextOwner] = useState('');
  const ownerUser = guild?.ownerId ? users[guild.ownerId] : undefined;

  const saveName = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('Sunucu adı boş olamaz.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.updateGuild({ name: trimmed });
      toast('Kaydedildi.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const transfer = async (): Promise<void> => {
    const target = users[nextOwner];
    if (!target) return;
    const ok = await confirmDialog({
      title: 'Sahiplik devredilsin mi?',
      message: `${target.displayName} sunucunun sahibi olur ve herkesin üstüne geçer. Sen yalnızca rollerinin verdiği yetkilerle kalırsın; bu işlemi yalnızca yeni sahip geri alabilir.`,
      confirmLabel: 'Sahipliği Devret',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.updateGuild({ ownerId: target.id });
      toast(`${target.displayName} artık sunucunun sahibi.`, 'success');
      setNextOwner('');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <h2 className="mb-5 text-xl font-bold text-text-head">Genel</h2>
      <Field label="Sunucu adı">
        <div className="flex gap-2">
          <TextInput
            value={name}
            maxLength={GUILD_NAME_MAX_LENGTH}
            disabled={!canManage}
            onChange={(e) => setName(e.target.value)}
          />
          <Button disabled={!canManage || busy || !name.trim() || name.trim() === guild?.name} onClick={() => void saveName()}>
            Kaydet
          </Button>
        </div>
      </Field>

      <Divider />
      <h3 className="mb-2 flex items-center gap-2 font-semibold text-text-head">
        <Crown size={18} className="text-warn" /> Sahip: {ownerUser?.displayName ?? 'yok'}
      </h3>
      <p className="mb-4 text-sm text-text-muted">
        Sahip herkesin üstündedir ve her yetkiye sahiptir; kimse onu atamaz, yasaklayamaz ya da rollerini
        değiştiremez. Sahip hesabını silmeden önce sahipliği başka birine devretmelidir.
      </p>
      {owner && (
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Sahipliği devret">
            <Select
              value={nextOwner}
              onChange={setNextOwner}
              options={[
                { value: '', label: 'Üye seç…' },
                ...candidates.map((u) => ({ value: u.id, label: `${u.displayName} (@${u.username})` })),
              ]}
            />
          </Field>
          <div className="mb-4">
            <Button variant="danger" disabled={!nextOwner} onClick={() => void transfer()}>
              Devret
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
