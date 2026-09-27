import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, MonitorOff, PhoneOff, Signal } from 'lucide-react';
import type { LinkQuality } from '@diskort/client-core';
import { voice } from '../../features/voice/voiceClient';
import { cn } from '../../lib/utils';
import { Permission } from '@diskort/shared';
import { channelById, useCan, useGuild } from '@diskort/client-core';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { useConnectionStats } from '../../stores/connectionStats';
import { ConnectionInfoPopover } from './ConnectionInfoPopover';

const STATUS_TEXT = {
  connecting: 'Bağlanıyor…',
  reconnecting: 'Yeniden bağlanıyor…',
  connected: 'Ses Bağlandı',
  idle: '',
} as const;

/** Son ölçümlerin ping ve paket kaybına göre (Discord'daki gibi yeşil/sarı/kırmızı) */
const QUALITY_COLOR: Record<LinkQuality, string> = {
  good: 'text-ok',
  fair: 'text-warn',
  poor: 'text-danger',
  unknown: 'text-ok',
};

const QUALITY_TEXT: Record<LinkQuality, string> = {
  good: 'Bağlantı iyi',
  fair: 'Bağlantı dalgalı',
  poor: 'Bağlantı zayıf',
  unknown: 'Bağlantı bilgisi',
};

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
  const openModal = useUi((s) => s.openModal);
  const setView = useUi((s) => s.setView);
  const [infoOpen, setInfoOpen] = useState(false);
  const labelRef = useRef<HTMLButtonElement>(null);
  const closeInfo = useCallback(() => setInfoOpen(false), []);
  useEffect(() => {
    if (status === 'idle') setInfoOpen(false);
  }, [status]);

  if (status === 'idle') return null;
  const connected = status === 'connected';
  const color = connected ? QUALITY_COLOR[quality] : 'text-warn';

  return (
    <div className="anim-rise-in border-b border-line/60 bg-bg-panel px-2 py-2">
      <div className="flex items-center gap-2 px-1">
        <Signal size={18} className={cn('shrink-0 transition-colors duration-300', color, !connected && 'animate-pulse')} />
        <div className="min-w-0 flex-1">
          <button
            ref={labelRef}
            type="button"
            className={cn(
              'block max-w-full truncate text-left text-sm font-semibold transition-colors duration-300 hover:underline',
              color,
            )}
            data-tooltip={infoOpen ? undefined : `${QUALITY_TEXT[connected ? quality : 'unknown']}${ping !== null ? ` · ${ping} ms` : ''}`}
            aria-expanded={infoOpen}
            aria-haspopup="dialog"
            onClick={() => setInfoOpen((v) => !v)}
          >
            {STATUS_TEXT[status]}
            {connected && ping !== null && <span className="ml-1.5 text-xs font-normal text-text-muted">{ping} ms</span>}
          </button>
          <button
            className="block max-w-full truncate text-left text-xs text-text-muted hover:text-text-normal hover:underline"
            data-tooltip="Ses kanalını göster"
            onClick={() => setView({ kind: 'voice' })}
          >
            {channel?.name} / {guildName}
          </button>
        </div>
        <button
          className="press-icon rounded p-1.5 text-text-normal hover:bg-bg-hover hover:text-text-head"
          data-tooltip="Bağlantıyı Kes"
          aria-label="Bağlantıyı Kes"
          onClick={() => void voice.leave()}
        >
          <PhoneOff size={20} />
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          disabled={!connected || (!sharing && !canStream)}
          aria-label={!canStream && !sharing ? 'Bu kanalda ekran paylaşma iznin yok' : undefined}
          className={cn(
            'press flex h-8 flex-1 items-center justify-center gap-2 rounded text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40',
            sharing ? 'bg-ok/20 text-ok hover:bg-ok/30' : 'bg-bg-hover text-text-normal hover:bg-bg-active',
          )}
          onClick={() => (sharing ? void voice.stopScreenShare() : openModal({ type: 'screenPicker' }))}
        >
          {sharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
          {sharing ? 'Yayını Durdur' : 'Ekran'}
        </button>
      </div>
      <ConnectionInfoPopover open={infoOpen} anchorRef={labelRef} onClose={closeInfo} />
    </div>
  );
}
