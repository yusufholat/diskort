import { useMemo, useState } from 'react';
import { Check, Plus, ShieldAlert, Slash, X } from 'lucide-react';
import { hasPermission, Permission, sortRoles, type Channel, type PermissionOverwrite } from '@diskort/shared';
import {
  api,
  channelPermissionInfos,
  errorMessage,
  overwriteState,
  permissionsOf,
  roleIsBelowFor,
  setOverwriteState,
  useGuild,
  useSession,
  type OverwriteState,
} from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { toast, useUi } from '../../stores/ui';
import { Button, Toggle } from '../ui/controls';

/**
 * Kanal izinleri: rol başına her yetki için izin ver / varsayılan (rolden gelir) / engelle. "Özel kanal"
 * kısayolu @everyone'dan kanalı görmeyi alır; kanalı görecek roller ayrıca eklenir.
 */
export function ChannelPermissions({ channel, onDone }: { channel: Channel; onDone: () => void }) {
  const rolesById = useGuild((s) => s.roles);
  const guildId = useGuild((s) => s.guild?.id ?? '');
  const selfId = useSession((s) => s.user?.id);
  const openContextMenu = useUi((s) => s.openContextMenu);
  const [overwrites, setOverwrites] = useState<PermissionOverwrite[]>(channel.overwrites ?? []);
  // Listede gösterilen roller: @everyone ve izni olanlar (yeni eklenenler boş izinle de görünür)
  const [listed, setListed] = useState<string[]>(() => [
    guildId,
    ...(channel.overwrites ?? []).map((o) => o.roleId).filter((id) => id !== guildId),
  ]);
  const [selectedId, setSelectedId] = useState(guildId);
  const [busy, setBusy] = useState(false);

  const roles = useMemo(
    () => sortRoles(listed.map((id) => rolesById[id]).filter((r) => r !== undefined)),
    [listed, rolesById],
  );
  const selected = rolesById[selectedId] ?? rolesById[guildId];
  const infos = channelPermissionInfos(channel.type);
  const s = useGuild.getState();
  const myPermissions = permissionsOf(s, selfId, channel.id);
  const admin = hasPermission(permissionsOf(s, selfId), Permission.ADMINISTRATOR);
  const editable = selected ? roleIsBelowFor(s, selfId, selected) : false;
  // Yönetici yetkisi olan rol kanal izinlerinden etkilenmez (engellense de her şeyi yapar)
  const selectedIsAdmin = selected ? hasPermission(selected.permissions, Permission.ADMINISTRATOR) : false;
  const dirty = JSON.stringify(normalize(overwrites)) !== JSON.stringify(normalize(channel.overwrites ?? []));

  const everyone = overwrites.find((o) => o.roleId === guildId);
  const isPrivate = everyone !== undefined && hasPermission(everyone.deny, Permission.VIEW_CHANNEL);

  const set = (roleId: string, flag: number, state: OverwriteState): void =>
    setOverwrites((list) => setOverwriteState(list, roleId, flag, state));

  const addable = sortRoles(Object.values(rolesById)).filter((r) => !listed.includes(r.id));

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.updateChannel(channel.id, { overwrites });
      toast('Kanal izinleri kaydedildi.', 'success');
      onDone();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!selected) return null;

  return (
    <div>
      <div className="mb-3 rounded-md bg-bg-side px-3">
        <Toggle
          label="Özel kanal"
          description={
            channel.type === 'text'
              ? 'Kanalı yalnızca aşağıda "Kanalı Gör" izni verilen roller (ve yöneticiler) görür.'
              : 'Kanalı yalnızca aşağıda "Kanalı Gör" izni verilen roller (ve yöneticiler) görür ve katılabilir.'
          }
          checked={isPrivate}
          disabled={!roleIsBelowFor(s, selfId, rolesById[guildId]!) || (!admin && !hasPermission(myPermissions, Permission.VIEW_CHANNEL))}
          onChange={(on) => set(guildId, Permission.VIEW_CHANNEL, on ? 'deny' : 'inherit')}
        />
      </div>

      <div className="grid h-[360px] grid-cols-[180px_1fr] gap-4">
        <div className="flex min-h-0 flex-col">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-bold text-text-muted uppercase">Roller</span>
            {addable.length > 0 && (
              <button
                data-tooltip="Rol ekle"
                aria-label="Rol ekle"
                className="rounded p-0.5 text-text-muted hover:text-text-head"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  openContextMenu({
                    x: rect.left,
                    y: rect.bottom + 4,
                    items: [
                      { label: 'Rol ekle', heading: true },
                      ...addable.map((r) => ({
                        label: r.name,
                        color: r.color,
                        onClick: () => {
                          setListed((l) => [...l, r.id]);
                          setSelectedId(r.id);
                        },
                      })),
                    ],
                  });
                }}
              >
                <Plus size={16} />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {roles.map((r) => (
              <button
                key={r.id}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                  r.id === selected.id ? 'bg-bg-active text-text-head' : 'text-text-normal hover:bg-bg-hover',
                )}
                onClick={() => setSelectedId(r.id)}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color ?? '#99aab5' }} />
                <span className="truncate">{r.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto pr-1">
          {!editable && (
            <div className="mb-2 rounded bg-warn/15 px-3 py-2 text-sm text-warn">
              Bu rol senin en üst rolünden aşağıda olmadığı için izinlerini değiştiremezsin.
            </div>
          )}
          {selectedIsAdmin && (
            <div className="mb-2 flex items-start gap-2 rounded bg-warn/15 px-3 py-2 text-sm text-warn">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                Bu rolde Yönetici yetkisi var: kanal izinleri bu roldekileri etkilemez, engellesen de her şeyi
                yapabilirler.
              </span>
            </div>
          )}
          {infos.map((p) => {
            const current = overwriteState(
              overwrites.find((o) => o.roleId === selected.id),
              p.flag,
            );
            const lacking = !admin && !hasPermission(myPermissions, p.flag);
            return (
              <div key={p.name} className="flex items-start gap-3 border-b border-line/60 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-text-head">{p.label}</div>
                  <div className="text-xs text-text-muted">{p.description}</div>
                </div>
                <TriState
                  value={current}
                  disabled={!editable || lacking}
                  onChange={(state) => set(selected.id, p.flag, state)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-xs text-text-muted">
        Sunucunun sahibi ve Yönetici yetkisi olanlar kanal izinlerinden etkilenmez. Bir üyenin rollerinden biri izin
        verip diğeri engellerse izin verme kazanır.
        {channel.type === 'text' && ' Mesaj gönderemeyen dosya ekleyemez ve @everyone/@here kullanamaz.'}
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={!dirty}
          onClick={() => setOverwrites(channel.overwrites ?? [])}
        >
          Sıfırla
        </Button>
        <Button variant="success" disabled={!dirty || busy} onClick={() => void save()}>
          İzinleri Kaydet
        </Button>
      </div>
    </div>
  );
}

/** Aynı izinlerin karşılaştırılabilmesi için sıralı biçim */
function normalize(list: PermissionOverwrite[]): PermissionOverwrite[] {
  return list.filter((o) => o.allow || o.deny).sort((a, b) => a.roleId.localeCompare(b.roleId));
}

const OPTIONS: { value: OverwriteState; label: string; icon: typeof Check; active: string }[] = [
  { value: 'deny', label: 'Engelle', icon: X, active: 'bg-danger text-white' },
  { value: 'inherit', label: 'Varsayılan (rolden gelir)', icon: Slash, active: 'bg-[#4e5058] text-white' },
  { value: 'allow', label: 'İzin ver', icon: Check, active: 'bg-ok text-white' },
];

function TriState({
  value,
  disabled,
  onChange,
}: {
  value: OverwriteState;
  disabled: boolean;
  onChange: (value: OverwriteState) => void;
}) {
  return (
    <div className={cn('flex shrink-0 overflow-hidden rounded border border-line', disabled && 'opacity-50')}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          data-tooltip={o.label}
          aria-label={o.label}
          aria-pressed={value === o.value}
          disabled={disabled}
          className={cn(
            'flex h-7 w-8 items-center justify-center text-text-muted',
            value === o.value ? o.active : 'hover:bg-bg-hover',
          )}
          onClick={() => onChange(o.value)}
        >
          <o.icon size={15} strokeWidth={3} />
        </button>
      ))}
    </div>
  );
}
