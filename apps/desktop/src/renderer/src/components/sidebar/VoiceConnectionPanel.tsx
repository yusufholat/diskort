import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  AudioWaveform,
  LayoutGrid,
  MonitorCog,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Signal,
  Video,
} from 'lucide-react';
import type { LinkQuality } from '@diskort/client-core';
import { voice } from '../../features/voice/voiceClient';
import { cn } from '../../lib/utils';
import { Permission } from '@diskort/shared';
import { channelById, useCan, useGuild } from '@diskort/client-core';
import { useSettings } from '../../stores/settings';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { useConnectionStats } from '../../stores/connectionStats';
import { ConnectionInfoPopover } from './ConnectionInfoPopover';
import { NoiseMenu, noiseSummary } from './AudioMenus';

const STATUS_TEXT = {
  connecting: 'Bağlanıyor…',
  reconnecting: 'Yeniden bağlanıyor…',
  connected: 'Ses Bağlantısı Kuruldu',
  idle: '',
} as const;

/** Son ölçümlerin ping ve paket kaybına göre (Discord'daki gibi yeşil/sarı/kırmızı) */
const QUALITY_COLOR: Record<LinkQuality, string> = {
  good: 'text-ok',
  fair: 'text-warn',
  poor: 'text-danger',
  unknown: 'text-ok',
};

/** Soldaki sinyal simgesinin yuvarlak kare zemini */
const QUALITY_TILE: Record<LinkQuality, string> = {
  good: 'bg-ok/15',
  fair: 'bg-warn/15',
  poor: 'bg-danger/15',
  unknown: 'bg-ok/15',
};

const QUALITY_TEXT: Record<LinkQuality, string> = {
  good: 'Bağlantı iyi',
  fair: 'Bağlantı dalgalı',
  poor: 'Bağlantı zayıf',
  unknown: 'Bağlantı bilgisi',
};

/**
 * Discord'daki gibi ses bağlantısı kartı (yalnızca ses kanalındayken): bağlantı kalitesi, kanal / sunucu,
 * gürültü engelleme ve bağlantıyı kesme; altında kamera, ekran paylaşımı, sahne ve yayın ayarları.
 * Alttaki kullanıcı paneliyle birlikte tek yuvarlak kart gibi görünür (üst yarısı).
 */
export function VoiceConnectionPanel() {
  const status = useVoice((s) => s.status);
  const channelId = useVoice((s) => s.channelId);
  const ping = useVoice((s) => s.pingMs);
  const quality = useConnectionStats((s) => s.quality);
  const sharing = useVoice((s) => s.sharing);
  const channel = useGuild((s) => channelById(s, channelId));
  const canStream = useCan(Permission.STREAM, channelId ?? undefined);
  // Ses kanalının sunucusu (seçili sunucu başka olabilir)
  const guildName = useGuild((s) => (channel ? s.guilds[channel.guildId]?.guild.name : undefined));
  const noise = useSettings((s) => s.noise);
  const noiseStrength = useSettings((s) => s.noiseStrengthDb);
  const openModal = useUi((s) => s.openModal);
  const setView = useUi((s) => s.setView);
  const [infoOpen, setInfoOpen] = useState(false);
  const [noiseOpen, setNoiseOpen] = useState(false);
  const labelRef = useRef<HTMLButtonElement>(null);
  const noiseRef = useRef<HTMLButtonElement>(null);
  const closeInfo = useCallback(() => setInfoOpen(false), []);
  const closeNoise = useCallback(() => setNoiseOpen(false), []);
  useEffect(() => {
    if (status === 'idle') {
      setInfoOpen(false);
      setNoiseOpen(false);
    }
  }, [status]);

  if (status === 'idle') return null;
  const connected = status === 'connected';
  const shownQuality: LinkQuality = connected ? quality : 'unknown';
  const color = connected ? QUALITY_COLOR[quality] : 'text-warn';
  const tile = connected ? QUALITY_TILE[quality] : 'bg-warn/15';
  const noiseLabel = `Gürültü engelleme: ${noiseSummary(noise, noiseStrength)}`;
  const shareBlocked = !sharing && !canStream;

  return (
    <div className="anim-rise-in rounded-t-lg border border-b-0 border-divider bg-bg-panel px-2 pt-2 pb-2">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-300',
            tile,
            color,
          )}
          aria-hidden
        >
          <Signal size={18} strokeWidth={2.5} className={cn(!connected && 'animate-pulse')} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <button
            ref={labelRef}
            type="button"
            className={cn(
              'block max-w-full truncate text-left text-sm font-semibold transition-colors duration-300 hover:underline',
              color,
            )}
            data-tooltip={infoOpen ? undefined : `${QUALITY_TEXT[shownQuality]}${ping !== null ? ` · ${ping} ms` : ''}`}
            aria-expanded={infoOpen}
            aria-haspopup="dialog"
            onClick={() => setInfoOpen((v) => !v)}
          >
            {STATUS_TEXT[status]}
          </button>
          <button
            type="button"
            className="block max-w-full truncate text-left text-xs text-text-muted hover:text-text-normal hover:underline"
            data-tooltip="Ses kanalına git"
            onClick={() => setView({ kind: 'voice' })}
          >
            {channel?.name} / {guildName}
          </button>
        </div>
        <IconButton
          ref={noiseRef}
          label={noiseLabel}
          active={noiseOpen}
          hideTooltip={noiseOpen}
          aria-haspopup="menu"
          aria-expanded={noiseOpen}
          onClick={() => setNoiseOpen((v) => !v)}
        >
          <AudioWaveform size={20} className={cn(noise === 'off' && 'opacity-50')} />
        </IconButton>
        <IconButton label="Bağlantıyı Kes" danger onClick={() => void voice.leave()}>
          <PhoneOff size={20} />
        </IconButton>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <ActionButton label="Kamera · Yakında" disabled>
          <Video size={20} />
        </ActionButton>
        <ActionButton
          label={sharing ? 'Yayını Durdur' : shareBlocked ? 'Bu kanalda ekran paylaşma iznin yok' : 'Ekranını Paylaş'}
          disabled={!connected || shareBlocked}
          active={sharing}
          onClick={() => (sharing ? void voice.stopScreenShare() : openModal({ type: 'screenPicker' }))}
        >
          {sharing ? <ScreenShareOff size={20} /> : <ScreenShare size={20} />}
        </ActionButton>
        <ActionButton label="Ses Sahnesini Aç" onClick={() => setView({ kind: 'voice' })}>
          <LayoutGrid size={20} />
        </ActionButton>
        <ActionButton label="Yayın Ayarları" onClick={() => openModal({ type: 'settings', section: 'stream' })}>
          <MonitorCog size={20} />
        </ActionButton>
      </div>
      <ConnectionInfoPopover open={infoOpen} anchorRef={labelRef} onClose={closeInfo} />
      <NoiseMenu open={noiseOpen} anchorRef={noiseRef} onClose={closeNoise} />
    </div>
  );
}

function IconButton({
  ref,
  label,
  danger,
  active,
  hideTooltip,
  onClick,
  children,
  ...aria
}: {
  ref?: Ref<HTMLButtonElement>;
  label: string;
  danger?: boolean;
  active?: boolean;
  hideTooltip?: boolean;
  onClick: () => void;
  children: ReactNode;
  'aria-haspopup'?: 'menu';
  'aria-expanded'?: boolean;
}) {
  return (
    <button
      ref={ref}
      type="button"
      data-tooltip={hideTooltip ? undefined : label}
      aria-label={label}
      className={cn(
        'press-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
        danger
          ? 'text-text-normal hover:bg-danger hover:text-white'
          : active
            ? 'bg-bg-active text-text-head'
            : 'text-text-normal hover:bg-bg-hover hover:text-text-head',
      )}
      onClick={onClick}
      {...aria}
    >
      {children}
    </button>
  );
}

/**
 * Alt sıradaki eşit genişlikte yuvarlak düğme. Devre dışıyken de ipucu gösterilsin diye `disabled` yerine
 * `aria-disabled` kullanılır (devre dışı öğeler fare olayı almaz).
 */
function ActionButton({
  label,
  disabled,
  active,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-tooltip={label}
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        'flex h-8 items-center justify-center rounded-md transition-colors',
        disabled
          ? 'cursor-not-allowed bg-bg-hover text-text-muted opacity-50'
          : active
            ? 'press bg-ok/20 text-ok hover:bg-ok/30'
            : 'press bg-bg-hover text-text-normal hover:bg-bg-active hover:text-text-head',
      )}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </button>
  );
}
