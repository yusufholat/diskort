import { useMemo, useRef, useState } from 'react';
import { Camera, Crown } from 'lucide-react';
import { GUILD_NAME_MAX_LENGTH, Permission } from '@diskort/shared';
import {
  api,
  deleteGuild,
  errorMessage,
  formatBytes,
  isOwner,
  removeGuildIcon,
  uploadGuildIcon,
  useCan,
  useGuild,
  useSession,
} from '@diskort/client-core';
import { confirmDialog } from '../../lib/dialog';
import { PresenceProvider, usePresence } from '../../lib/motion';
import { toast, useUi } from '../../stores/ui';
import { AvatarCropper } from '../settings/AvatarCropper';
import { GuildIcon } from '../ui/GuildIcon';
import { Button, Divider, Field, SectionTitle, Select, TextInput } from '../ui/controls';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
/** Tarayıcıda açılıp kırpılacak resmin en büyük boyutu (sunucuya kırpılmış küçük kopya gider) */
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

/** Sunucunun adı, simgesi, sahipliğin devri ve sunucuyu silmek. */
export function OverviewSection() {
  const guild = useGuild((s) => s.guild);
  const guildId = guild?.id ?? '';
  const users = useGuild((s) => s.users);
  const selfId = useSession((s) => s.user?.id);
  const owner = useGuild((s) => isOwner(s, selfId));
  const isPrimary = useGuild((s) => s.activeGuildId === s.primaryGuildId);
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
      await api.updateGuild(guildId, { name: trimmed });
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
      await api.updateGuild(guildId, { ownerId: target.id });
      toast(`${target.displayName} artık sunucunun sahibi.`, 'success');
      setNextOwner('');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: `"${guild?.name}" silinsin mi?`,
      message:
        'Sunucu bütün kanalları, mesajları, dosyaları, rolleri ve davetleriyle kalıcı olarak silinir. Üyeler sunucuya bir daha erişemez. Bu işlem geri alınamaz.',
      confirmLabel: 'Sunucuyu Sil',
      danger: true,
    });
    if (!ok) return;
    if (await deleteGuild(guildId)) {
      useUi.getState().closeModal();
      toast('Sunucu silindi.', 'success');
    }
  };

  return (
    <div>
      <h2 className="mb-5 text-xl font-bold text-text-head">Genel</h2>
      {canManage && <IconPicker guildId={guildId} />}
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
        değiştiremez. Sahip sunucudan ayrılmadan ya da hesabını silmeden önce sahipliği başka birine devretmelidir.
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

      {owner && !isPrimary && (
        <>
          <Divider />
          <SectionTitle>Sunucuyu Sil</SectionTitle>
          <div className="flex items-center justify-between gap-4 rounded-md border border-danger/40 px-4 py-3">
            <p className="text-sm text-text-muted">
              Sunucu, kanalları ve bütün mesajlarıyla kalıcı olarak silinir. Bu işlem geri alınamaz.
            </p>
            <Button variant="danger" className="shrink-0" onClick={() => void remove()}>
              Sunucuyu Sil
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Sunucu simgesi: seçilen resim kırpılıp yüklenir; kaldırılınca adın baş harfleri görünür. */
function IconPicker({ guildId }: { guildId: string }) {
  const guild = useGuild((s) => s.guilds[guildId]?.guild);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const cropper = usePresence(file);
  const pick = (): void => input.current?.click();

  const save = async (image: Blob): Promise<void> => {
    try {
      await uploadGuildIcon(guildId, { name: 'simge.png', size: image.size, type: image.type, blob: image });
      setFile(null);
      toast('Sunucu simgesi güncellendi.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await removeGuildIcon(guildId);
      toast('Sunucu simgesi kaldırıldı.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="mb-5 flex items-center gap-4">
      <button
        type="button"
        className="press-icon group relative shrink-0 rounded-full"
        onClick={pick}
        data-tooltip="Simgeyi değiştir"
        aria-label="Sunucu simgesini değiştir"
      >
        <GuildIcon guild={guild} size={80} className="rounded-full" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Camera size={22} />
        </span>
      </button>
      <div>
        <div className="flex gap-2">
          <Button type="button" onClick={pick}>
            {guild?.iconUrl ? 'Simgeyi Değiştir' : 'Simge Yükle'}
          </Button>
          {guild?.iconUrl && (
            <Button type="button" variant="secondary" onClick={() => void remove()}>
              Kaldır
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-text-muted">PNG, JPEG, WebP ya da GIF. En az 256×256 önerilir.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (!picked) return;
          if (picked.size > MAX_SOURCE_BYTES) {
            toast(`Resim çok büyük (en fazla ${formatBytes(MAX_SOURCE_BYTES)}).`, 'error');
            return;
          }
          setFile(picked);
        }}
      />
      <PresenceProvider value={cropper.closing}>
        {cropper.value && <AvatarCropper file={cropper.value} onCancel={() => setFile(null)} onSave={save} title="Sunucu simgesini düzenle" />}
      </PresenceProvider>
    </div>
  );
}
