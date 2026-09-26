import { Monitor, MonitorOff, PhoneOff, Signal } from 'lucide-react';
import { voice } from '../../features/voice/voiceClient';
import { cn } from '../../lib/utils';
import { useGuild } from '../../stores/guild';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';

const STATUS_TEXT = {
  connecting: 'Bağlanıyor…',
  reconnecting: 'Yeniden bağlanıyor…',
  connected: 'Ses Bağlandı',
  idle: '',
} as const;

function pingColor(ping: number | null): string {
  if (ping === null) return 'text-ok';
  if (ping < 120) return 'text-ok';
  if (ping < 250) return 'text-warn';
  return 'text-danger';
}

export function VoiceConnectionPanel() {
  const status = useVoice((s) => s.status);
  const channelId = useVoice((s) => s.channelId);
  const ping = useVoice((s) => s.pingMs);
  const sharing = useVoice((s) => s.sharing);
  const channel = useGuild((s) => s.channels.find((c) => c.id === channelId));
  const guildName = useGuild((s) => s.guild?.name);
  const openModal = useUi((s) => s.openModal);

  if (status === 'idle') return null;
  const connected = status === 'connected';

  return (
    <div className="border-b border-line/60 bg-bg-panel px-2 py-2">
      <div className="flex items-center gap-2 px-1">
        <Signal
          size={18}
          className={cn(connected ? pingColor(ping) : 'text-warn', !connected && 'animate-pulse')}
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn('text-sm font-semibold', connected ? pingColor(ping) : 'text-warn')}
            title={ping !== null ? `Gecikme: ${ping} ms` : undefined}
          >
            {STATUS_TEXT[status]}
            {connected && ping !== null && <span className="ml-1.5 text-xs font-normal text-text-muted">{ping} ms</span>}
          </div>
          <div className="truncate text-xs text-text-muted">
            {channel?.name} / {guildName}
          </div>
        </div>
        <button
          className="rounded p-1.5 text-text-normal hover:bg-bg-hover hover:text-text-head"
          title="Bağlantıyı Kes"
          onClick={() => void voice.leave()}
        >
          <PhoneOff size={20} />
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          disabled={!connected}
          className={cn(
            'flex h-8 flex-1 items-center justify-center gap-2 rounded text-sm font-medium transition-colors',
            sharing ? 'bg-ok/20 text-ok hover:bg-ok/30' : 'bg-bg-hover text-text-normal hover:bg-bg-active',
          )}
          onClick={() => (sharing ? void voice.stopScreenShare() : openModal({ type: 'screenPicker' }))}
        >
          {sharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
          {sharing ? 'Yayını Durdur' : 'Ekran'}
        </button>
      </div>
    </div>
  );
}
