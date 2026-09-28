import { useState } from 'react';
import { animatedDecorationSet, AVATAR_DECORATION_SCALE, STATUS_LABELS, type User } from '@diskort/shared';
import { avatarUrl, useCosmeticUrl, useStatus, type DisplayStatus } from '@diskort/client-core';
import { cn, initials } from '../../lib/utils';
import { AnimatedDecoration } from '../cosmetics/Cosmetics';
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
  /**
   * Avatar dekorasyonunun kimliği (user.avatarDecoration): avatarın üstüne, yerleşimi değiştirmeden çizilir.
   * Hareketli dekorasyon (anim:<set>) profil boyunda oynar, küçük avatarda sabit bir halkadır.
   */
  decoration?: string | null;
  /** Hareketli dekorasyon küçük avatarda da oynasın (ayarlardaki seçici) */
  animateDecoration?: boolean;
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
  decoration,
  animateDecoration,
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
  const animatedSet = animatedDecorationSet(decoration);
  const decorationSrc = useCosmeticUrl('decorations', animatedSet ? null : decoration);
  const over = (size * (AVATAR_DECORATION_SCALE - 1)) / 2;
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
      {decorationSrc && (
        <img
          src={decorationSrc}
          alt=""
          draggable={false}
          decoding="async"
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: -over, top: -over, width: size + 2 * over, height: size + 2 * over }}
        />
      )}
      {animatedSet && <AnimatedDecoration set={animatedSet} size={size} animate={animateDecoration} />}
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
