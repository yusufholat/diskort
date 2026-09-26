import { useGuild } from '@diskort/client-core';
import { initials } from '../lib/utils';

/** Sol dikey sunucu çubuğu (şimdilik tek topluluk; ileride çoklu sunucu için yer hazır). */
export function GuildRail() {
  const guild = useGuild((s) => s.guild);
  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-bg-rail py-3">
      <div className="relative flex items-center">
        <span className="absolute -left-4 h-10 w-1 rounded-r bg-white" />
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-base font-semibold text-white"
          title={guild?.name}
        >
          {initials(guild?.name ?? 'D')}
        </div>
      </div>
      <div className="h-0.5 w-8 rounded bg-bg-hover" />
    </nav>
  );
}
