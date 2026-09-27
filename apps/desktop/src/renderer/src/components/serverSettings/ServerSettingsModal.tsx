import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Permission } from '@diskort/shared';
import { canManageFeedback, isOwner, useFeedback, usePermissions, useGuild, useSession } from '@diskort/client-core';
import { useEscapeLayer } from '../../lib/escape';
import { usePresenceClosing } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { useUi, type ServerSettingsSection } from '../../stores/ui';
import { BansSection } from './BansSection';
import { InvitesSection } from './InvitesSection';
import { MembersSection } from './MembersSection';
import { OverviewSection } from './OverviewSection';
import { RolesSection } from './RolesSection';
import { FeedbackAdminSection } from '../feedback/FeedbackAdminSection';

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
  { id: 'invites', label: 'Davetler', any: [P.CREATE_INVITE, P.MANAGE_INVITES] },
  { id: 'bans', label: 'Yasaklar', any: [P.BAN_MEMBERS] },
  { id: 'feedback', label: 'Geri Bildirimler', any: [P.MANAGE_GUILD] },
];

/** Kullanıcının görebildiği sunucu ayarları bölümleri (hiçbiri yoksa menüde "Sunucu Ayarları" çıkmaz) */
export function useServerSettingsSections(): { id: ServerSettingsSection; label: string }[] {
  const perms = usePermissions();
  const selfId = useSession((s) => s.user?.id);
  const owner = useGuild((s) => isOwner(s, selfId));
  // Geri bildirimler uygulamanın kendisi hakkındadır: yalnızca ana sunucunun ayarlarında
  const primary = useGuild((s) => s.activeGuildId === s.primaryGuildId);
  return SECTIONS.filter((s) =>
    s.id === 'feedback'
      ? primary && canManageFeedback()
      : (s.id === 'overview' && owner) || s.any.some((flag) => (perms & flag) === flag),
  );
}

/** Sunucu Ayarları: genel, roller, üyeler, davetler, yasaklar (yetkiye göre). */
export function ServerSettingsModal({ initial }: { initial?: ServerSettingsSection }) {
  const close = useUi((s) => s.closeModal);
  const guildName = useGuild((s) => s.guild?.name);
  const sections = useServerSettingsSections();
  const [section, setSection] = useState<ServerSettingsSection>(initial ?? 'overview');
  const current = sections.find((s) => s.id === section)?.id ?? sections[0]?.id;
  const newFeedback = useFeedback((s) => s.newCount);

  // Esc yalnızca en üstteki katmanı kapatır (üstte açık menü ya da onay penceresi varsa önce o)
  const closing = usePresenceClosing();
  useEscapeLayer(close, !closing);

  // Yetki alınırsa ayarlar kapanır
  useEffect(() => {
    if (sections.length === 0) close();
  }, [sections.length, close]);

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 top-[var(--titlebar-h,0px)] z-40 flex bg-bg-main',
        closing ? 'anim-settings-out pointer-events-none' : 'anim-settings-in',
      )}
    >
      <nav className="flex w-[30%] min-w-[220px] justify-end overflow-y-auto border-r border-divider bg-bg-side py-14 pr-2">
        <div className="w-[190px]">
          <div className="truncate px-2.5 pb-1.5 text-xs font-bold text-text-muted uppercase">{guildName}</div>
          {sections.map((s) => (
            <NavItem key={s.id} active={current === s.id} onClick={() => setSection(s.id)}>
              {s.label}
              {s.id === 'feedback' && newFeedback > 0 && <CountBadge count={newFeedback} />}
            </NavItem>
          ))}
        </div>
      </nav>
      <main className="relative flex-1 overflow-y-auto py-14 pr-10 pl-10">
        {/* Bölüm değişince içerik hafifçe yükselerek belirir */}
        <div key={current} className="anim-rise-in max-w-[860px]">
          {current === 'overview' && <OverviewSection />}
          {current === 'roles' && <RolesSection />}
          {current === 'members' && <MembersSection />}
          {current === 'invites' && <InvitesSection />}
          {current === 'bans' && <BansSection />}
          {current === 'feedback' && <FeedbackAdminSection />}
        </div>
        <button
          onClick={close}
          className="group fixed top-14 right-10 flex flex-col items-center gap-1 text-text-muted transition-colors hover:text-text-head"
          aria-label="Kapat"
        >
          <span className="press-icon flex h-9 w-9 items-center justify-center rounded-full border-2 border-current transition-transform group-hover:rotate-90 group-active:scale-90">
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

/** Yeni geri bildirim sayısı (Discord'un kırmızı rozeti gibi) */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        'anim-pill-in ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 align-[1px] text-[11px] leading-none font-bold text-white',
        className,
      )}
      aria-label={`${count} yeni`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
