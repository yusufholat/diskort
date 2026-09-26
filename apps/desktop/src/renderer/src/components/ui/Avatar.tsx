import type { User } from '@diskurt/shared';
import { cn, initials } from '../../lib/utils';

interface Props {
  user: Pick<User, 'displayName' | 'avatarColor'> | undefined;
  size?: number;
  speaking?: boolean;
  online?: boolean;
  className?: string;
}

export function Avatar({ user, size = 32, speaking, online, className }: Props) {
  const name = user?.displayName ?? '?';
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full font-semibold text-white transition-shadow duration-75',
          speaking && 'speaking-ring',
        )}
        style={{ background: user?.avatarColor ?? '#747f8d', fontSize: Math.max(10, size * 0.38) }}
      >
        {initials(name)}
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
