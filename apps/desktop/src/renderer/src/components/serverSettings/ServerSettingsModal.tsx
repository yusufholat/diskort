import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Permission } from '@diskort/shared';
import { isOwner, usePermissions, useGuild, useSession } from '@diskort/client-core';
import { useDialog } from '../../lib/dialog';
import { cn } from '../../lib/utils';
import { useUi, type ServerSettingsSection } from '../../stores/ui';
import { BansSection } from './BansSection';
import { InvitesSection } from './InvitesSection';
import { MembersSection } from './MembersSection';
import { OverviewSection } from './OverviewSection';
import { RolesSection } from './RolesSection';

const P = Permission;

/** Bölümler ve onları gösteren yetkiler (herhangi biri yeter) */
const SECTIONS: { id: ServerSettingsSection; label: string; any: number[] }[] = [
  { id: 'overview', label: 'Genel', any: [P.MANAGE_GUILD] },
  { id: 'roles', label: 'Roller', any: [P.MANAGE_ROLES] },
  {
    id: 'members',
    label: 'Üyeler',
    any: [P.MANAGE_ROLES, P.KICK_MEMBERS, P.BAN_MEMBERS, P.MUTE_MEMBERS, P.DEAFEN_MEMBERS, P.MOVE_MEMBERS],
  },
  { id: 'invites', label: 'Davetler', any: [P.MANAGE_INVITES] },
  { id: 'bans', label: 'Yasaklar', any: [P.BAN_MEMBERS] },
];

/** Kullanıcının görebildiği sunucu ayarları bölümleri (hiçbiri yoksa menüde "Sunucu Ayarları" çıkmaz) */
export function useServerSettingsSections(): { id: ServerSettingsSection; label: string }[] {
  const perms = usePermissions();
  const selfId = useSession((s) => s.user?.id);
  const owner = useGuild((s) => isOwner(s, selfId));
  return SECTIONS.filter((s) => (s.id === 'overview' && owner) || s.any.some((flag) => (perms & flag) === flag));
}

/** Sunucu Ayarları: genel, roller, üyeler, davetler, yasaklar (yetkiye göre). */
export function ServerSettingsModal({ initial }: { initial?: ServerSettingsSection }) {
  const close = useUi((s) => s.closeModal);
  const guildName = useGuild((s) => s.guild?.name);
  const sections = useServerSettingsSections();
  const [section, setSection] = useState<ServerSettingsSection>(initial ?? 'overview');
  const current = sections.find((s) => s.id === section)?.id ?? sections[0]?.id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // Üstte açık bir onay penceresi ya da menü varsa yalnızca o kapansın
      const ui = useUi.getState();
      if (useDialog.getState().current || ui.contextMenu || ui.banUser) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Yetki alınırsa ayarlar kapanır
  useEffect(() => {
    if (sections.length === 0) close();
  }, [sections.length, close]);

  return (
    <div className="animate-pop fixed inset-x-0 bottom-0 top-[var(--titlebar-h,0px)] z-40 flex bg-bg-main">
      <nav className="flex w-[30%] min-w-[220px] justify-end overflow-y-auto bg-bg-side py-14 pr-2">
        <div className="w-[190px]">
          <div className="truncate px-2.5 pb-1.5 text-xs font-bold text-text-muted uppercase">{guildName}</div>
          {sections.map((s) => (
            <NavItem key={s.id} active={current === s.id} onClick={() => setSection(s.id)}>
              {s.label}
            </NavItem>
          ))}
        </div>
      </nav>
      <main className="relative flex-1 overflow-y-auto py-14 pr-10 pl-10">
        <div className="max-w-[860px]">
          {current === 'overview' && <OverviewSection />}
          {current === 'roles' && <RolesSection />}
          {current === 'members' && <MembersSection />}
          {current === 'invites' && <InvitesSection />}
          {current === 'bans' && <BansSection />}
        </div>
        <button
          onClick={close}
          className="fixed top-14 right-10 flex flex-col items-center gap-1 text-text-muted hover:text-text-head"
          aria-label="Kapat"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-current">
            <X size={20} />
          </span>
          <span className="text-xs font-semibold">ESC</span>
        </button>
      </main>
    </div>
  );
}

function NavItem({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'mb-0.5 block w-full rounded px-2.5 py-1.5 text-left font-medium transition-colors',
        active ? 'bg-bg-active text-text-head' : 'text-text-muted hover:bg-bg-hover hover:text-text-normal',
      )}
    >
      {children}
    </button>
  );
}
