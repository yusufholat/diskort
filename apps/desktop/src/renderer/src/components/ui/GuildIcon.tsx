import { useState } from 'react';
import type { Guild } from '@diskort/shared';
import { guildIconUrl, guildInitials } from '@diskort/client-core';
import { cn } from '../../lib/utils';

/** Sunucu simgesi: yüklenmiş resim ya da adın baş harfleri (Discord gibi) */
export function GuildIcon({
  guild,
  size = 48,
  className,
}: {
  guild: Pick<Guild, 'name' | 'iconUrl'> | null | undefined;
  size?: number;
  className?: string;
}) {
  const src = guildIconUrl(guild);
  const [failed, setFailed] = useState<string | null>(null);
  const text = guildInitials(guild?.name ?? '');
  return (
    <div
      className={cn('flex shrink-0 items-center justify-center overflow-hidden bg-brand font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size * (text.length > 2 ? 0.28 : 0.36)) }}
    >
      {src && failed !== src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          className="h-full w-full object-cover select-none"
          onError={() => setFailed(src)}
        />
      ) : (
        text
      )}
    </div>
  );
}
