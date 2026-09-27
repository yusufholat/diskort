import { useMemo, useState, type MouseEvent } from 'react';
import { Copy, Crown, MoreHorizontal, Plus, X } from 'lucide-react';
import { Permission, type User } from '@diskort/shared';
import {
  api,
  canAssignRole,
  errorMessage,
  memberColorOf,
  moderation,
  outranksUser,
  useCan,
  useGuild,
  useSession,
} from '@diskort/client-core';
import { confirmDialog } from '../../lib/dialog';
import { memberMenuItems } from '../../lib/memberMenu';
import { cn } from '../../lib/utils';
import { toast, useUi, type ContextMenuItem } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { TextInput } from '../ui/controls';

/** Üyeler: roller, şifre sıfırlama kodu, atma, yasaklama, hesap silme (yetkiye göre). */
export function MembersSection() {
  const users = useGuild((s) => s.users);
  const online = useGuild((s) => s.online);
  const [query, setQuery] = useState('');
  const [resetCode, setResetCode] = useState<{ user: User; code: string; expiresAt: number } | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    return Object.values(users)
      .filter((u) => !u.removed)
      .filter((u) => !q || u.username.includes(q) || u.displayName.toLocaleLowerCase('tr').includes(q))
      .sort(
        (a, b) =>
          Number(Boolean(online[b.id])) - Number(Boolean(online[a.id])) ||
          a.displayName.localeCompare(b.displayName, 'tr'),
      );
  }, [users, online, query]);
  const total = useMemo(() => Object.values(users).filter((u) => !u.removed).length, [users]);

  return (
    <div>
      <h2 className="mb-2 text-xl font-bold text-text-head">Üyeler</h2>
      <p className="mb-4 text-sm text-text-muted">
        {total} üye · {Object.keys(online).length} çevrimiçi. Bir üyeye sağ tıklayarak ya da “…” düğmesiyle
        rollerini, sesli sohbetini ve üyeliğini yönetebilirsin. Yalnızca en üst rolü seninkinden aşağıda olanları
        yönetebilirsin.
      </p>
      <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Üye ara" className="mb-4" />

      {resetCode && <ResetCodeCard {...resetCode} />}

      <div className="flex flex-col gap-1">
        {list.map((u) => (
          <MemberRow key={u.id} user={u} onResetCode={(code, expiresAt) => setResetCode({ user: u, code, expiresAt })} />
        ))}
      </div>
    </div>
  );
}

function ResetCodeCard({ user, code, expiresAt }: { user: User; code: string; expiresAt: number }) {
  return (
    <div className="mb-4 rounded-md border border-brand/60 bg-brand/10 p-4">
      <div className="text-sm text-text-muted">
        <strong className="text-text-head">{user.displayName}</strong> için şifre sıfırlama kodu (tek kullanımlık,{' '}
        {new Date(expiresAt).toLocaleString('tr-TR')} tarihine kadar geçerli):
      </div>
      <div className="mt-2 flex items-center gap-3">
        <code className="font-mono text-2xl tracking-widest text-text-head">{code}</code>
        <button
          className="flex items-center gap-1.5 rounded bg-bg-hover px-2.5 py-1.5 text-sm hover:bg-bg-active"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            toast('Kopyalandı.');
          }}
        >
          <Copy size={14} /> Kopyala
        </button>
      </div>
      <div className="mt-2 text-xs text-text-muted">
        Kullanıcı adı: <strong>@{user.username}</strong> — ikisini birlikte gönder. Üye giriş ekranında “Sıfırlama
        koduyla yenile” ile yeni şifre belirler.
      </div>
    </div>
  );
}

function MemberRow({ user, onResetCode }: { user: User; onResetCode: (code: string, expiresAt: number) => void }) {
  const selfId = useSession((s) => s.user?.id);
  const isSelf = user.id === selfId;
  const color = useGuild((s) => memberColorOf(s, user.id));
  const roles = useGuild((s) => s.roles);
  const ownerId = useGuild((s) => s.guild?.ownerId);
  const online = useGuild((s) => Boolean(s.online[user.id]));
  const voiceChannel = useGuild((s) => {
    const state = s.voiceStates[user.id];
    return state ? s.channels.find((c) => c.id === state.channelId)?.name : undefined;
  });
  const isAdmin = useCan(Permission.ADMINISTRATOR);
  const openContextMenu = useUi((s) => s.openContextMenu);

  const held = user.roles.map((id) => roles[id]).filter((r) => r !== undefined).sort((a, b) => b.position - a.position);

  /** Yönetim menüsü: seste yönetim, roller, atma/yasaklama + yöneticiye şifre kodu ve hesap silme */
  const menuItems = (): ContextMenuItem[] => {
    const items = memberMenuItems(user.id);
    const s = useGuild.getState();
    const above = isSelf || outranksUser(s, selfId, user.id);
    if (isAdmin && above) {
      items.push({ label: 'Yönetici', heading: true });
      items.push({
        label: 'Şifre sıfırlama kodu üret',
        onClick: () =>
          void api
            .createResetCode(user.id)
            .then((r) => onResetCode(r.code, r.expiresAt))
            .catch((err) => toast(errorMessage(err), 'error')),
      });
      if (!isSelf) {
        items.push({
          label: 'Hesabı kalıcı olarak sil',
          danger: true,
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Hesap silinsin mi?',
              message: `${user.displayName} (@${user.username}) hesabı kalıcı olarak silinir; mesajları "Silinmiş Kullanıcı" adıyla kalır. Geri dönmesini istiyorsan atman yeterli.`,
              confirmLabel: 'Hesabı Sil',
              danger: true,
            });
            if (!ok) return;
            api
              .deleteUser(user.id)
              .then(() => toast(`${user.displayName} silindi.`, 'success'))
              .catch((err) => toast(errorMessage(err), 'error'));
          },
        });
      }
    }
    return items;
  };

  const openMenu = (e: MouseEvent, x: number, y: number): void => {
    e.preventDefault();
    const items = menuItems();
    if (items.length === 0) {
      toast('Bu üye için yapabileceğin bir şey yok.');
      return;
    }
    openContextMenu({ x, y, items });
  };

  /** Verilebilecek (henüz sahip olmadığı) roller */
  const addableRoles = (): ContextMenuItem[] => {
    const s = useGuild.getState();
    return Object.values(s.roles)
      .filter((r) => !user.roles.includes(r.id) && canAssignRole(s, selfId, user.id, r))
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ label: r.name, color: r.color, onClick: () => void moderation.setRole(user.id, r.id, true) }));
  };

  return (
    <div
      className="group flex items-center gap-3 rounded-md bg-bg-side px-3 py-2"
      onContextMenu={(e) => openMenu(e, e.clientX, e.clientY)}
    >
      <Avatar user={user} size={36} online={online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-text-head" style={color ? { color } : undefined}>
            {user.displayName}
          </span>
          {user.id === ownerId && <Crown size={14} aria-label="Sunucunun sahibi" className="shrink-0 text-warn" />}
          {isSelf && <span className="text-xs text-text-muted">(sen)</span>}
        </div>
        <div className="truncate text-xs text-text-muted">
          @{user.username}
          {voiceChannel && ` · 🔊 ${voiceChannel}`}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {held.map((role) => {
            const removable = canAssignRole(useGuild.getState(), selfId, user.id, role);
            return (
              <span
                key={role.id}
                className="flex h-6 items-center gap-1.5 rounded bg-bg-main px-1.5 text-xs text-text-normal"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: role.color ?? '#99aab5' }} />
                {role.name}
                {removable && (
                  <button
                    aria-label={`${role.name} rolünü al`}
                    className="text-text-muted hover:text-danger"
                    onClick={() => void moderation.setRole(user.id, role.id, false)}
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            );
          })}
          <AddRoleButton items={addableRoles} />
        </div>
      </div>
      <button
        aria-label="Üyeyi yönet"
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-hover hover:text-text-head',
          'opacity-70 group-hover:opacity-100',
        )}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          openMenu(e, rect.left, rect.bottom + 4);
        }}
      >
        <MoreHorizontal size={18} />
      </button>
    </div>
  );
}

function AddRoleButton({ items }: { items: () => ContextMenuItem[] }) {
  const openContextMenu = useUi((s) => s.openContextMenu);
  // Verilebilecek rol yoksa düğme hiç görünmez
  if (items().length === 0) return null;
  return (
    <button
      className="flex h-6 items-center gap-1 rounded bg-bg-main px-1.5 text-xs text-text-muted hover:text-text-head"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        openContextMenu({ x: rect.left, y: rect.bottom + 4, items: [{ label: 'Rol ver', heading: true }, ...items()] });
      }}
    >
      <Plus size={12} /> Rol
    </button>
  );
}
