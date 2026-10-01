import type { ReactNode } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import type { DmCall } from '@diskort/shared';
import { dmTitle, useGuild, useSession } from '@diskort/client-core';
import { useCallEffects, useKnownIncomingCalls } from '../../features/calls/useCallEffects';
import { declineCall, joinDmCall } from '../../lib/calls';
import { DmAvatar } from '../dms/DmAvatar';

/**
 * Gelen arama penceresi (her görünümde, ekranın üst ortasında): kim arıyor, Kabul / Reddet. Birden çok
 * arama varsa en yenisi gösterilir, altında kaç arama daha olduğu yazar (biri bitince sıradaki görünür).
 * Zil sesi, pencere uyarısı ve bildirim de buradan yönetilir (useCallEffects).
 */
export function IncomingCall() {
  useCallEffects();
  const calls = useKnownIncomingCalls();
  const call = calls[0];
  if (!call) return null;
  return <IncomingCallCard key={`${call.channelId}:${call.startedAt}`} call={call} more={calls.length - 1} />;
}

function IncomingCallCard({ call, more }: { call: DmCall; more: number }) {
  const selfId = useSession((s) => s.user?.id);
  const dm = useGuild((s) => s.dms[call.channelId]);
  const title = useGuild((s) => (dm ? dmTitle(dm, s.users, selfId) : ''));
  const caller = useGuild((s) => s.users[call.startedBy]?.displayName ?? 'Biri');
  if (!dm) return null;
  const subtitle = dm.group ? `${caller} grup araması başlattı` : 'Gelen arama…';

  return (
    <div
      role="alertdialog"
      aria-label={`${title} arıyor`}
      className="anim-pop-in fixed top-[calc(var(--titlebar-h,0px)+16px)] left-1/2 z-50 w-[300px] -translate-x-1/2 overflow-hidden rounded-xl border border-edge bg-bg-float p-5 text-center shadow-[0_8px_32px_rgb(0_0_0/0.5)]"
    >
      <div className="relative mx-auto mb-3 flex h-20 w-20 items-center justify-center">
        <span aria-hidden className="anim-call-ring absolute inset-0 rounded-full border-2 border-ok" />
        <DmAvatar dm={dm} size={80} />
      </div>
      <div className="truncate text-lg font-bold text-text-head">{title}</div>
      <div className="truncate text-sm text-text-muted">{subtitle}</div>
      <div className="mt-5 flex items-center justify-center gap-6">
        <CallButton label="Reddet" danger onClick={() => declineCall(call.channelId)}>
          <PhoneOff size={22} />
        </CallButton>
        <CallButton label="Kabul et" onClick={() => void joinDmCall(call.channelId)}>
          <Phone size={22} />
        </CallButton>
      </div>
      {more > 0 && <div className="mt-3 text-xs text-text-muted">+{more} arama daha</div>}
    </div>
  );
}

function CallButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={
          danger
            ? 'press-icon flex h-12 w-12 items-center justify-center rounded-full bg-danger text-white hover:bg-danger-hover'
            : 'press-icon flex h-12 w-12 items-center justify-center rounded-full bg-ok text-white hover:bg-ok-hover'
        }
      >
        {children}
      </button>
      <span className="text-xs font-medium text-text-normal">{label}</span>
    </div>
  );
}
