import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Lock, Plus, ShieldAlert, X } from 'lucide-react';
import {
  hasPermission,
  Permission,
  ROLE_COLOR_PATTERN,
  ROLE_NAME_MAX_LENGTH,
  sortRoles,
  type Role,
  type UpdateRoleRequest,
} from '@diskort/shared';
import {
  api,
  canAssignRole,
  canManageRole,
  errorMessage,
  moderation,
  PERMISSION_GROUPS,
  rolePermissionSource,
  useCan,
  useGuild,
  usePermissions,
  useSession,
} from '@diskort/client-core';
import { confirmDialog } from '../../lib/dialog';
import { cn } from '../../lib/utils';
import { toast, useUi } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { Button, Field, TextInput, Toggle } from '../ui/controls';

/** Rol renkleri (Discord'daki paletin benzeri) */
const ROLE_COLORS = [
  '#1abc9c',
  '#2ecc71',
  '#3498db',
  '#9b59b6',
  '#e91e63',
  '#f1c40f',
  '#e67e22',
  '#e74c3c',
  '#95a5a6',
  '#607d8b',
  '#11806a',
  '#1f8b4c',
  '#206694',
  '#71368a',
  '#ad1457',
  '#c27c0e',
  '#a84300',
  '#992d22',
];

/** Roller: oluşturma, sıralama, görünüm, yetkiler ve üyeler. */
export function RolesSection() {
  const rolesById = useGuild((s) => s.roles);
  const guildId = useGuild((s) => s.guild?.id);
  const users = useGuild((s) => s.users);
  const selfId = useSession((s) => s.user?.id);
  const canCreate = useCan(Permission.MANAGE_ROLES);
  const roles = useMemo(() => sortRoles(Object.values(rolesById)), [rolesById]);
  const members = useMemo(() => Object.values(users).filter((u) => !u.removed), [users]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0];

  const create = async (): Promise<void> => {
    try {
      const role = await api.createRole(guildId ?? '', { name: 'yeni rol' });
      setSelectedId(role.id);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  /** Rolü bir sıra yukarı/aşağı taşır (yalnızca kendi en üst rolünün altındakiler arasında) */
  const move = async (role: Role, direction: -1 | 1): Promise<void> => {
    const order = roles.filter((r) => r.id !== guildId).map((r) => r.id);
    const i = order.indexOf(role.id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    try {
      await api.reorderRoles(guildId ?? '', order);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const movable = (role: Role, direction: -1 | 1): boolean => {
    const s = useGuild.getState();
    const others = roles.filter((r) => r.id !== guildId);
    const neighbor = others[others.indexOf(role) + direction];
    return Boolean(neighbor) && canManageRole(s, selfId, role) && canManageRole(s, selfId, neighbor!);
  };

  if (!selected || !guildId) return null;

  return (
    <div>
      <h2 className="mb-2 text-xl font-bold text-text-head">Roller</h2>
      <p className="mb-5 text-sm text-text-muted">
        Üyeleri rollerle gruplayıp yetki ver. Üstteki rol alttakileri yönetebilir; kimse kendi en üst rolünden
        yukarıdakileri düzenleyemez. Bir üyenin adının rengi, renkli rollerinden en üsttekinden gelir.
      </p>
      <div className="grid grid-cols-[230px_1fr] gap-6">
        <div>
          {canCreate && (
            <Button className="mb-3 flex w-full items-center justify-center gap-1.5" onClick={() => void create()}>
              <Plus size={16} /> Rol Oluştur
            </Button>
          )}
          <div className="flex flex-col gap-0.5">
            {roles.map((role) => {
              const count =
                role.id === guildId ? members.length : members.filter((u) => u.roles.includes(role.id)).length;
              return (
                <div
                  key={role.id}
                  className={cn(
                    'group flex items-center gap-2 rounded px-2 py-1.5',
                    role.id === selected.id ? 'bg-bg-active text-text-head' : 'text-text-normal hover:bg-bg-hover',
                  )}
                >
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setSelectedId(role.id)}>
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: role.color ?? '#99aab5' }} />
                    <span className="min-w-0 flex-1 truncate font-medium">{role.name}</span>
                    <span className="text-xs text-text-muted">{count}</span>
                  </button>
                  {role.id !== guildId && (
                    <span className="flex opacity-0 group-hover:opacity-100">
                      <button
                        data-tooltip="Yukarı taşı"
                        aria-label="Yukarı taşı"
                        disabled={!movable(role, -1)}
                        className="rounded p-0.5 text-text-muted hover:text-text-head disabled:invisible"
                        onClick={() => void move(role, -1)}
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        data-tooltip="Aşağı taşı"
                        aria-label="Aşağı taşı"
                        disabled={!movable(role, 1)}
                        className="rounded p-0.5 text-text-muted hover:text-text-head disabled:invisible"
                        onClick={() => void move(role, 1)}
                      >
                        <ChevronDown size={16} />
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Rol sunucuda değişince (kaydedildi ya da başkası düzenledi) düzenleyici tazelenir */}
        <RoleEditor
          key={`${selected.id}:${selected.name}:${selected.color}:${selected.hoist}:${selected.permissions}`}
          role={selected}
          everyone={selected.id === guildId}
          onDeleted={() => setSelectedId(null)}
          onShowEveryone={() => setSelectedId(guildId)}
        />
      </div>
    </div>
  );
}

type Tab = 'display' | 'permissions' | 'members';

interface Draft {
  name: string;
  color: string | null;
  hoist: boolean;
  permissions: number;
}

function RoleEditor({
  role,
  everyone,
  onDeleted,
  onShowEveryone,
}: {
  role: Role;
  everyone: boolean;
  onDeleted: () => void;
  /** @everyone rolünü seçer (herkeste olan bir yetkiyi kısıtlamak için) */
  onShowEveryone: () => void;
}) {
  const selfId = useSession((s) => s.user?.id);
  // Yetkiler birleşir: @everyone'da açık olan bir yetki her rolde de fiilen açıktır
  const everyonePermissions = useGuild((s) => (s.guild ? (s.roles[s.guild.id]?.permissions ?? 0) : 0));
  const myPermissions = usePermissions();
  const manageable = useGuild((s) => canManageRole(s, selfId, role));
  const admin = hasPermission(myPermissions, Permission.ADMINISTRATOR);
  const original: Draft = { name: role.name, color: role.color, hoist: role.hoist, permissions: role.permissions };
  const [draft, setDraft] = useState<Draft>(original);
  const [colorText, setColorText] = useState(role.color ?? '');
  const [tab, setTab] = useState<Tab>(everyone ? 'permissions' : 'display');
  const [busy, setBusy] = useState(false);
  const dirty =
    draft.name !== original.name ||
    draft.color !== original.color ||
    draft.hoist !== original.hoist ||
    draft.permissions !== original.permissions;

  const set = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }));

  const save = async (): Promise<void> => {
    const name = draft.name.trim();
    if (!name) {
      toast('Rol adı boş olamaz.', 'error');
      return;
    }
    const patch: UpdateRoleRequest = {};
    if (draft.permissions !== original.permissions) patch.permissions = draft.permissions;
    if (!everyone) {
      if (name !== original.name) patch.name = name;
      if (draft.color !== original.color) patch.color = draft.color;
      if (draft.hoist !== original.hoist) patch.hoist = draft.hoist;
    }
    setBusy(true);
    try {
      await api.updateRole(useGuild.getState().activeGuildId ?? '', role.id, patch);
      toast('Rol kaydedildi.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: `"${role.name}" rolü silinsin mi?`,
      message: 'Rol bütün üyelerden alınır ve kanal izinlerinden kaldırılır. Bu işlem geri alınamaz.',
      confirmLabel: 'Rolü Sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteRole(useGuild.getState().activeGuildId ?? '', role.id);
      toast('Rol silindi.', 'success');
      onDeleted();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const tabs: { id: Tab; label: string }[] = everyone
    ? [{ id: 'permissions', label: 'Yetkiler' }]
    : [
        { id: 'display', label: 'Görünüm' },
        { id: 'permissions', label: 'Yetkiler' },
        { id: 'members', label: 'Üyeler' },
      ];

  return (
    <div className="min-w-0 pb-20">
      <div className="mb-1 truncate text-lg font-bold" style={{ color: draft.color ?? undefined }}>
        {everyone ? '@everyone' : draft.name || 'Adsız rol'}
      </div>
      {!manageable && (
        <div className="mb-3 rounded bg-warn/15 px-3 py-2 text-sm text-warn">
          Bu rol senin en üst rolünden aşağıda olmadığı için düzenleyemezsin.
        </div>
      )}
      <div className="mb-4 flex gap-4 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={cn(
              '-mb-px border-b-2 pb-2 text-sm font-medium',
              tab === t.id ? 'border-brand text-text-head' : 'border-transparent text-text-muted hover:text-text-normal',
            )}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'display' && (
        <div>
          <Field label="Rol adı">
            <TextInput
              value={draft.name}
              maxLength={ROLE_NAME_MAX_LENGTH}
              disabled={!manageable}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <div className="mb-2 text-xs font-bold tracking-wide text-text-muted uppercase">Rol rengi</div>
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              data-tooltip="Renksiz"
              aria-label="Renksiz"
              disabled={!manageable}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded border-2 border-[#99aab5] text-[#99aab5] disabled:cursor-not-allowed disabled:opacity-50',
                draft.color === null && 'ring-2 ring-text-head ring-offset-2 ring-offset-bg-main',
              )}
              onClick={() => {
                set({ color: null });
                setColorText('');
              }}
            >
              <X size={14} />
            </button>
            {ROLE_COLORS.map((color) => (
              <button
                key={color}
                aria-label={color}
                disabled={!manageable}
                className={cn(
                  'h-8 w-8 rounded transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100',
                  draft.color === color && 'ring-2 ring-text-head ring-offset-2 ring-offset-bg-main',
                )}
                style={{ background: color }}
                onClick={() => {
                  set({ color });
                  setColorText(color);
                }}
              />
            ))}
          </div>
          <div className="mb-4 flex items-center gap-2">
            <span className="h-8 w-8 shrink-0 rounded" style={{ background: draft.color ?? '#99aab5' }} />
            <div className="w-36 shrink-0">
              <TextInput
                value={colorText}
                disabled={!manageable}
                maxLength={7}
                placeholder="#rrggbb"
                aria-label="Özel renk"
                className="font-mono"
                onChange={(e) => {
                  const text = e.target.value.trim();
                  setColorText(text);
                  if (text === '') set({ color: null });
                  else if (ROLE_COLOR_PATTERN.test(text)) set({ color: text.toLowerCase() });
                }}
              />
            </div>
            {colorText !== '' && !ROLE_COLOR_PATTERN.test(colorText) && (
              <span className="text-xs text-danger">Renk #rrggbb biçiminde olmalı.</span>
            )}
          </div>
          <Toggle
            label="Üyeleri ayrı göster"
            description="Bu roldeki çevrimiçi üyeler üye listesinde kendi başlıkları altında görünür."
            checked={draft.hoist}
            disabled={!manageable}
            onChange={(hoist) => set({ hoist })}
          />
          {manageable && (
            <Button variant="danger" className="mt-6" onClick={() => void remove()}>
              Rolü Sil
            </Button>
          )}
        </div>
      )}

      {tab === 'permissions' && (
        <div>
          {everyone ? (
            <p className="mb-4 text-sm text-text-muted">
              Bu yetkiler herkese verilir. Burada açık olan bir yetki, başka bir rolde kapalı olsa bile herkeste kalır
              (yetkiler birleşir). Bir yetkiyi yalnızca bazı rollere vermek için burada kapat, o rollerde aç. Bir kanal
              için ayrıca kanalın ayarlarındaki İzinler bölümünden değiştirilebilir (ör. özel ya da salt okunur kanal).
            </p>
          ) : hasPermission(draft.permissions, Permission.ADMINISTRATOR) ? (
            <div className="mb-4 flex items-start gap-2 rounded bg-warn/15 px-3 py-2 text-sm text-warn">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                Bu rolde Yönetici yetkisi açık: roldekiler aşağıdaki bütün yetkilere sahiptir ve kanal izinlerinden
                etkilenmez.
              </span>
            </div>
          ) : (
            <p className="mb-4 text-sm text-text-muted">
              Üyeler @everyone rolünün ve sahip oldukları bütün rollerin yetkilerini birlikte alır. Kilitli yetkiler
              @everyone rolünde açık olduğu için herkeste zaten var; burada kapatmak kimseyi kısıtlamaz.
            </p>
          )}
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.title} className="mb-6">
              <div className="mb-1 text-xs font-bold tracking-wide text-text-muted uppercase">{group.title}</div>
              {group.permissions.map((p) => {
                const lacking = !admin && !hasPermission(myPermissions, p.flag);
                const own = hasPermission(draft.permissions, p.flag);
                // @everyone'dan ya da Yönetici yetkisinden zaten geliyorsa açık ve kilitli görünür
                const source = rolePermissionSource(
                  { permissions: draft.permissions, isEveryone: everyone },
                  everyonePermissions,
                  p.flag,
                );
                const locked = source !== 'role';
                return (
                  <div key={p.name} className="border-b border-line/60 py-1">
                    <Toggle
                      label={p.label}
                      description={lacking ? `${p.description} (Sende olmayan bir yetkiyi veremezsin.)` : p.description}
                      checked={own || locked}
                      disabled={!manageable || lacking || locked}
                      onChange={(on) =>
                        set({ permissions: on ? draft.permissions | p.flag : draft.permissions & ~p.flag })
                      }
                    />
                    {source === 'everyone' && (
                      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                        <Lock size={12} className="shrink-0" />
                        <span>
                          Bu izin @everyone rolünde açık; herkeste zaten var. Kısıtlamak için @everyone rolünde kapat.
                        </span>
                        <button className="font-medium text-link hover:underline" onClick={onShowEveryone}>
                          @everyone rolüne git
                        </button>
                        {own && (
                          <span className="flex basis-full items-center gap-2 pl-5">
                            Bu rolde de ayrıca açık: @everyone rolünde kapatsan da bu roldekilerde kalır.
                            {manageable && !lacking && (
                              <button
                                className="font-medium text-link hover:underline"
                                onClick={() => set({ permissions: draft.permissions & ~p.flag })}
                              >
                                Bu rolden kaldır
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                    {source === 'administrator' && (
                      <div className="mb-2 flex items-center gap-2 text-xs text-text-muted">
                        <Lock size={12} className="shrink-0" /> Yönetici yetkisi açık olduğu için bu roldekilerde zaten
                        var.
                      </div>
                    )}
                    {p.flag === Permission.ADMINISTRATOR && hasPermission(draft.permissions, p.flag) && (
                      <div className="mb-2 flex items-center gap-2 text-xs text-warn">
                        <ShieldAlert size={14} /> Bu roldekiler her şeyi yapabilir; diğer yetkilerin önemi kalmaz.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {tab === 'members' && <RoleMembers role={role} />}

      {dirty && (
        <div className="fixed right-10 bottom-6 left-[calc(30%+2.5rem)] z-10 flex max-w-[820px] items-center gap-3 rounded-lg bg-bg-rail px-4 py-3 shadow-2xl">
          <span className="flex-1 text-sm text-text-normal">Dikkat — kaydedilmemiş değişikliklerin var!</span>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(original);
              setColorText(original.color ?? '');
            }}
          >
            Sıfırla
          </Button>
          <Button variant="success" disabled={busy || !manageable} onClick={() => void save()}>
            Kaydet
          </Button>
        </div>
      )}
    </div>
  );
}

/** Roldeki üyeler; yetkiliyse üye ekleyip çıkarabilir */
function RoleMembers({ role }: { role: Role }) {
  const users = useGuild((s) => s.users);
  const selfId = useSession((s) => s.user?.id);
  const openContextMenu = useUi((s) => s.openContextMenu);
  const holders = useMemo(
    () =>
      Object.values(users)
        .filter((u) => !u.removed && u.roles.includes(role.id))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr')),
    [users, role.id],
  );
  const s = useGuild.getState();
  const candidates = Object.values(users)
    .filter((u) => !u.removed && !u.roles.includes(role.id) && canAssignRole(s, selfId, u.id, role))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'));

  return (
    <div>
      {candidates.length > 0 && (
        <Button
          variant="secondary"
          className="mb-3 flex items-center gap-1.5"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            openContextMenu({
              x: rect.left,
              y: rect.bottom + 4,
              items: candidates.map((u) => ({
                label: u.displayName,
                onClick: () => void moderation.setRole(u.id, role.id, true),
              })),
            });
          }}
        >
          <Plus size={16} /> Üye Ekle
        </Button>
      )}
      {holders.length === 0 && <div className="text-sm text-text-muted">Bu rolde kimse yok.</div>}
      <div className="flex flex-col gap-1">
        {holders.map((u) => (
          <div key={u.id} className="flex items-center gap-3 rounded bg-bg-side px-3 py-1.5">
            <Avatar user={u} size={28} />
            <span className="min-w-0 flex-1 truncate text-text-head">{u.displayName}</span>
            {canAssignRole(s, selfId, u.id, role) && (
              <button
                data-tooltip={`${u.displayName} kişisini rolden çıkar`}
                aria-label={`${u.displayName} kişisini rolden çıkar`}
                className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-danger"
                onClick={() => void moderation.setRole(u.id, role.id, false)}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
