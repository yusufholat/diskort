import { memo, type CSSProperties } from 'react';
import type { ProfileEffect, ProfileTheme, User } from '@diskort/shared';
import { bannerUrl, effectParticles, profileGradient } from '@diskort/client-core';
import { cn } from '../../lib/utils';

// Profil süsleri (afiş, tema, efekt) masaüstünde: profil kartı ve Ayarlar > Profil'deki önizleme kullanır.

/**
 * Temalı kartın zemini: tema degradesinin üstüne uygulamanın kart rengi yarı saydam serilir (yazılar
 * açık ve koyu temada okunur kalsın). Tema yoksa undefined: kart kendi rengini kullanır.
 */
export function themedCardStyle(theme: ProfileTheme | null | undefined): CSSProperties | undefined {
  if (!theme) return undefined;
  const veil = 'color-mix(in srgb, var(--color-bg-float) 55%, transparent)';
  return { background: `linear-gradient(${veil}, ${veil}), ${profileGradient(theme)}` };
}

/**
 * Avatarın çevresindeki halkanın rengi: kartın o hizadaki rengi (temada üst renk, tüle karışmış).
 * Tema yoksa undefined.
 */
export function themedRingColor(theme: ProfileTheme | null | undefined): string | undefined {
  return theme ? `color-mix(in srgb, var(--color-bg-float) 55%, ${theme.primary})` : undefined;
}

/** Kartın üstündeki afiş: resim, yoksa tema rengi, o da yoksa profil rengi */
export function ProfileBanner({
  user,
  className,
}: {
  user: Pick<User, 'bannerUrl' | 'profileTheme' | 'avatarColor'>;
  className?: string;
}) {
  const src = bannerUrl(user);
  return (
    <div
      className={cn('relative shrink-0 overflow-hidden', className)}
      style={{ background: user.profileTheme?.primary ?? user.avatarColor }}
    >
      {src && <img src={src} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />}
    </div>
  );
}

/** Kartın üstünde oynayan efekt (tıklamaları engellemez; "hareketi azalt" açıkken görünmez) */
export const ProfileEffectLayer = memo(function ProfileEffectLayer({ effect }: { effect: ProfileEffect | null | undefined }) {
  if (!effect) return null;
  return (
    <div className="fx-layer" aria-hidden>
      {effectParticles(effect).map((p, i) =>
        p.kind === 'twinkle' ? (
          <span
            key={i}
            className="fx-star"
            style={
              {
                left: `${p.x}%`,
                top: `${p.y}%`,
                fontSize: p.size,
                color: p.color,
                animationDuration: `${p.duration}s`,
                animationDelay: `${p.delay}s`,
                '--spin': `${p.spin}deg`,
              } as CSSProperties
            }
          >
            ✦
          </span>
        ) : (
          <span
            key={i}
            className="fx-fall"
            style={{ left: `${p.x}%`, animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` }}
          >
            <span
              className="fx-sway"
              style={
                {
                  '--drift': `${p.drift}px`,
                  animationDuration: `${p.duration / 3}s`,
                  animationDelay: `${p.delay}s`,
                } as CSSProperties
              }
            >
              <span
                className={p.shape === 'petal' ? 'fx-petal' : 'fx-dot'}
                style={
                  {
                    width: p.size,
                    height: p.shape === 'petal' ? p.size * 0.7 : p.size,
                    background: p.color,
                    opacity: p.opacity,
                    animationDuration: `${p.duration / 2}s`,
                    '--spin': `${p.spin}deg`,
                  } as CSSProperties
                }
              />
            </span>
          </span>
        ),
      )}
    </div>
  );
});
