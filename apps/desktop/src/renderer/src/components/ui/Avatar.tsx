import { useState } from 'react';
import type { User } from '@diskort/shared';
import { avatarUrl } from '@diskort/client-core';
import { cn, initials } from '../../lib/utils';

interface Props {
  user: Pick<User, 'displayName' | 'avatarColor' | 'avatarUrl'> | undefined;
  size?: number;
  speaking?: boolean;
  online?: boolean;
  className?: string;
}

export function Avatar({ user, size = 32, speaking, online, className }: Props) {
  const name = user?.displayName ?? '?';
  const src = avatarUrl(user);
  // Yüklenemeyen fotoğrafın yerine baş harfler (adres değişince yeniden denenir)
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div
        className={cn(
          'avatar-ring flex h-full w-full items-center justify-center rounded-full font-semibold text-white',
          speaking && 'speaking-ring',
        )}
        style={{ background: user?.avatarColor ?? '#747f8d', fontSize: Math.max(10, size * 0.38) }}
      >
        {src && failed !== src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            decoding="async"
            className="h-full w-full rounded-full object-cover select-none"
            onError={() => setFailed(src)}
          />
        ) : (
          initials(name)
        )}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 rounded-full border-[3px] border-bg-panel',
            online ? 'bg-ok' : 'bg-text-faint',
          )}
          style={{ width: size * 0.42, height: size * 0.42 }}
        />
      )}
    </div>
  );
}
