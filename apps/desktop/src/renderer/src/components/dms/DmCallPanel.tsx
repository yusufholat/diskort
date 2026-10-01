import { Phone } from 'lucide-react';
import type { DmChannel } from '@diskort/shared';
import { useCallMembers, useCanCallDm, useDmCall, useGuild } from '@diskort/client-core';
import { joinDmCall } from '../../lib/calls';
import { cn } from '../../lib/utils';
import { useVoice } from '../../stores/voice';
import { VoiceStage } from '../stage/VoiceStage';
import { Avatar } from '../ui/Avatar';

/**
 * Konuşmanın üstündeki arama alanı: aramadaysan ses sahnesi (katılımcılar, yayınlar, kontroller); arama
 * sürüyor ama sen içinde değilsen aramadakiler ve "Aramaya katıl"; arama yoksa hiçbir şey.
 */
export function DmCallPanel({
  dm,
  expanded,
  onToggleExpand,
}: {
  dm: DmChannel;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const inThisCall = useVoice((s) => s.channelId === dm.id && s.status !== 'idle');
  const call = useDmCall(dm.id);
  const members = useCallMembers(dm.id);

  if (inThisCall) {
    return (
      <div
        className={cn(
          'anim-fade-in flex min-h-0 border-b border-edge',
          expanded ? 'flex-1' : 'h-[min(48vh,440px)] shrink-0',
        )}
      >
        <VoiceStage dm={dm} expanded={expanded} onToggleExpand={onToggleExpand} />
      </div>
    );
  }
  if (!call && members.length === 0) return null;
  return <JoinBar dm={dm} userIds={members.map((m) => m.userId)} />;
}

/** Süren aramaya katılma çubuğu: aramadakilerin resimleri ve "Aramaya katıl" */
function JoinBar({ dm, userIds }: { dm: DmChannel; userIds: string[] }) {
  const users = useGuild((s) => s.users);
  const canCall = useCanCallDm(dm.id);
  return (
    <div className="anim-fade-in flex shrink-0 flex-col items-center gap-3 border-b border-edge bg-bg-deep px-4 py-5">
      <div className="flex items-center -space-x-2">
        {userIds.slice(0, 6).map((id) => (
          <Avatar key={id} user={users[id]} size={48} className="rounded-full ring-4 ring-bg-deep" />
        ))}
      </div>
      <div className="text-sm text-text-muted">Arama sürüyor</div>
      {canCall && (
        <button
          type="button"
          onClick={() => void joinDmCall(dm.id)}
          className="press flex items-center gap-2 rounded-full bg-ok px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-ok-hover"
        >
          <Phone size={16} aria-hidden /> Aramaya katıl
        </button>
      )}
    </div>
  );
}
