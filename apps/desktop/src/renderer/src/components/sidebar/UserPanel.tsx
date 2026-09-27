import type { ReactNode } from 'react';
import { Headphones, HeadphoneOff, Mic, MicOff, Settings } from 'lucide-react';
import { voice } from '../../features/voice/voiceClient';
import { useMountedRef } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { STATUS_LABELS } from '@diskort/shared';
import { useCustomStatus, useGuild, useSession, useStatus } from '@diskort/client-core';
import { useSettings } from '../../stores/settings';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { CustomStatusLine } from '../status/CustomStatusLine';
import { toggleSelfProfile } from '../status/SelfProfilePopout';
import { Avatar } from '../ui/Avatar';

export function UserPanel() {
  const user = useSession((s) => s.user);
  const selfMute = useSettings((s) => s.selfMute);
  const selfDeaf = useSettings((s) => s.selfDeaf);
  const inputMode = useSettings((s) => s.inputMode);
  const speaking = useVoice((s) => (user ? s.speaking[user.id] === true : false));
  const pttActive = useVoice((s) => s.pttActive);
  // Konuşma izni yoksa (yetki ya da sunucuda susturma) mikrofon kapalı görünür
  const micAllowed = useVoice((s) => s.micAllowed || s.status === 'idle');
  const serverDeaf = useGuild((s) => (user ? s.voiceStates[user.id]?.serverDeaf === true : false));
  const openModal = useUi((s) => s.openModal);
  const status = useStatus(user?.id);
  const custom = useCustomStatus(user?.id);

  const muted = selfMute || selfDeaf || !micAllowed;
  const deaf = selfDeaf || serverDeaf;

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-t border-divider bg-bg-panel px-2">
      {/* Tıklayınca kendi profil kartın: durum ve özel durum buradan değişir */}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded py-1 pr-1 pl-0.5 text-left transition-colors hover:bg-bg-hover"
        aria-label="Profilin ve durumun"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          toggleSelfProfile({ left: rect.left, top: rect.top });
        }}
      >
        <Avatar user={user ?? undefined} size={32} speaking={speaking} status={status} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold text-text-head">{user?.displayName}</div>
          <div className="truncate text-xs text-text-muted">
            {inputMode === 'ptt' ? (
              pttActive ? (
                'Konuşuyor (bas-konuş)'
              ) : (
                'Bas-konuş'
              )
            ) : custom ? (
              <CustomStatusLine status={custom} />
            ) : (
              STATUS_LABELS[status]
            )}
          </div>
        </div>
      </button>
      <PanelButton
        active={muted}
        title={!micAllowed ? voice.micBlockedReason() : muted ? 'Sesi Aç' : 'Sustur'}
        onClick={() => voice.toggleMute()}
        icon={muted ? <MicOff size={20} /> : <Mic size={20} />}
      />
      <PanelButton
        active={deaf}
        title={serverDeaf ? 'Sunucuda sağırlaştırıldın' : selfDeaf ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}
        onClick={() => voice.toggleDeafen()}
        icon={deaf ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
      />
      <PanelButton
        title="Kullanıcı Ayarları"
        onClick={() => openModal({ type: 'settings' })}
        icon={<Settings size={20} className="transition-transform duration-300 group-hover:rotate-90" />}
      />
    </div>
  );
}

function PanelButton({
  icon,
  title,
  onClick,
  active,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  // Simge değişince (sustur ↔ sesi aç) kısa bir dönüşle yenisine geçer; ilk açılışta oynamaz
  const mounted = useMountedRef();
  return (
    <button
      data-tooltip={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'press-icon group flex h-8 w-8 items-center justify-center rounded hover:bg-bg-hover',
        active ? 'text-danger' : 'text-text-normal hover:text-text-head',
      )}
    >
      <span key={title} className={mounted.current ? 'anim-icon-swap' : 'inline-flex'}>
        {icon}
      </span>
    </button>
  );
}
