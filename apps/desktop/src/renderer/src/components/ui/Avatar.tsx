import { useState } from 'react';
import { STATUS_LABELS, type User } from '@diskort/shared';
import { avatarUrl, useStatus, type DisplayStatus } from '@diskort/client-core';
import { cn, initials } from '../../lib/utils';
import { StatusIcon } from './StatusIcon';

interface Props {
  user: Pick<User, 'displayName' | 'avatarColor' | 'avatarUrl'> | undefined;
  size?: number;
  speaking?: boolean;
  /** Eski biçim: çevrimiçi (yeşil) / çevrimdışı (gri halka). `status` verilirse o kullanılır */
  online?: boolean;
  /** Durum noktası (Discord biçimli); verilmezse ve `online` da yoksa nokta çizilmez */
  status?: DisplayStatus;
  /** Noktanın çevresindeki halkanın rengi (avatarın durduğu zemin) */
  ringClassName?: string;
  /** Halkanın rengi sınıfla verilemiyorsa (ör. temalı profil kartı); ringClassName'in önüne geçer */
  ringColor?: string;
  className?: string;
}

export function Avatar({
  user,
  size = 32,
  speaking,
  online,
  status,
  ringClassName = 'bg-bg-panel',
  ringColor,
  className,
}: Props) {
  // 32 piksellik avatarda 10 piksellik nokta, 3 piksellik halka; büyük avatarda (profil) orantılı daha küçük
  const dot = size > 40 ? Math.round(size * 0.22) : Math.max(8, Math.round(size * 0.3125));
  const ring = size > 40 ? Math.round(size * 0.075) : Math.max(2, Math.round(size * 0.094));
  const shown: DisplayStatus | undefined = status ?? (online === undefined ? undefined : online ? 'online' : 'offline');
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
      {shown !== undefined && (
        <span
          className={cn('absolute flex items-center justify-center rounded-full', ringClassName)}
          style={{
            padding: ring,
            right: -ring + Math.round(size * 0.03),
            bottom: -ring + Math.round(size * 0.03),
            background: ringColor,
          }}
          role="img"
          aria-label={STATUS_LABELS[shown]}
        >
          <StatusIcon status={shown} size={dot} />
        </span>
      )}
    </div>
  );
}

/** Kişinin güncel durum noktasıyla avatar (kendin için görünmezlik de görünür) */
export function PresenceAvatar({ userId, ...props }: Omit<Props, 'status' | 'online'> & { userId: string }) {
  const status = useStatus(userId);
  return <Avatar {...props} status={status} />;
}
