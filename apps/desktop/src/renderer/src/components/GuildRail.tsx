import { MessageSquareHeart } from 'lucide-react';
import { useGuild } from '@diskort/client-core';
import { initials } from '../lib/utils';
import { useUi } from '../stores/ui';

/** Sol dikey sunucu çubuğu (şimdilik tek topluluk; ileride çoklu sunucu için yer hazır). */
export function GuildRail() {
  const guild = useGuild((s) => s.guild);
  const openModal = useUi((s) => s.openModal);
  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-bg-rail py-3">
      <div className="relative flex items-center">
        <span className="anim-indicator-in absolute -left-4 h-10 w-1 origin-left rounded-r bg-white" />
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-base font-semibold text-white"
          data-tooltip={guild?.name}
          data-tooltip-side="right"
          aria-label={guild?.name}
        >
          {initials(guild?.name ?? 'D')}
        </div>
      </div>
      <div className="h-0.5 w-8 rounded bg-bg-hover" />
      {/* Geri bildirim: Discord'un "Sunucu ekle" düğmesi gibi, en altta */}
      <button
        className="press mt-auto flex h-12 w-12 items-center justify-center rounded-3xl bg-bg-main text-ok transition-[border-radius,background-color,color] duration-200 hover:rounded-2xl hover:bg-ok hover:text-white"
        data-tooltip="Geri bildirim gönder"
        data-tooltip-side="right"
        aria-label="Geri bildirim gönder"
        onClick={() => openModal({ type: 'feedback' })}
      >
        <MessageSquareHeart size={22} />
      </button>
    </nav>
  );
}
