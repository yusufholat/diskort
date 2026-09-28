// Profil süsleri (afiş, tema, efekt): iki platformun ortak kısmı. Tema hazır renkleri ve efektlerin
// parçacıkları burada tanımlanır; çizimi her platform kendisi yapar (masaüstü CSS animasyonu, telefon
// Reanimated). Efektler kodla çizilir: dosya indirilmez, uygulama büyümez.

import type { ProfileEffect, ProfileTheme } from '@diskort/shared';

/** Hazır temalar (ayarlarda seçilir; masaüstünde renkler ayrıca elle de seçilebilir) */
export const PROFILE_THEME_PRESETS: readonly (ProfileTheme & { name: string })[] = [
  { name: 'Kor', primary: '#5c0f0f', accent: '#ea580c' },
  { name: 'Gün batımı', primary: '#f97316', accent: '#be185d' },
  { name: 'Gece', primary: '#1e3a8a', accent: '#6d28d9' },
  { name: 'Okyanus', primary: '#0e7490', accent: '#1e40af' },
  { name: 'Orman', primary: '#14532d', accent: '#65a30d' },
  { name: 'Nane', primary: '#059669', accent: '#0ea5e9' },
  { name: 'Şeker', primary: '#f472b6', accent: '#8b5cf6' },
  { name: 'Gece yarısı', primary: '#0f172a', accent: '#475569' },
];

/**
 * Tek bir parçacık. Konumlar kartın genişliğine/yüksekliğine göre yüzde; süreler saniye.
 * - fall: yukarıdan aşağı düşer, `drift` kadar sağa sola salınır, `spin` derece döner (kar, yaprak)
 * - twinkle: yerinde belirip kaybolur, bu sırada biraz döner (ışıltı)
 */
export interface Particle {
  kind: 'fall' | 'twinkle';
  shape: 'dot' | 'petal' | 'star';
  /** Yatay konum (%) */
  x: number;
  /** Dikey konum (%, yalnızca twinkle) */
  y: number;
  /** Boyut (px) */
  size: number;
  color: string;
  opacity: number;
  duration: number;
  /** İlk başlangıç gecikmesi (s): parçacıklar aynı anda başlamasın */
  delay: number;
  /** Salınım genişliği (px, fall) */
  drift: number;
  /** Bir turdaki dönüş (derece) */
  spin: number;
}

/** Aynı efekt her açılışta aynı görünsün: sabit tohumlu basit rastgele sayı üreteci */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const between = (r: () => number, min: number, max: number): number => min + (max - min) * r();

const PETAL_COLORS = ['#ffc1d9', '#ff9ec4', '#ffd6e5', '#f9a8d4'];
const SPARKLE_COLORS = ['#ffffff', '#fff3b0', '#ffe27a', '#e0f2ff'];

function build(effect: ProfileEffect): Particle[] {
  switch (effect) {
    case 'snow': {
      const r = seeded(7);
      return Array.from({ length: 22 }, () => ({
        kind: 'fall' as const,
        shape: 'dot' as const,
        x: between(r, 0, 100),
        y: 0,
        size: between(r, 2, 5),
        color: '#ffffff',
        opacity: between(r, 0.55, 0.95),
        duration: between(r, 6, 11),
        delay: between(r, -11, 0),
        drift: between(r, 6, 16),
        spin: 0,
      }));
    }
    case 'petals': {
      const r = seeded(11);
      return Array.from({ length: 12 }, (_, i) => ({
        kind: 'fall' as const,
        shape: 'petal' as const,
        x: between(r, 0, 100),
        y: 0,
        size: between(r, 7, 11),
        color: PETAL_COLORS[i % PETAL_COLORS.length]!,
        opacity: between(r, 0.75, 1),
        duration: between(r, 8, 13),
        delay: between(r, -13, 0),
        drift: between(r, 14, 28),
        spin: (r() < 0.5 ? -1 : 1) * between(r, 180, 420),
      }));
    }
    case 'sparkles': {
      const r = seeded(3);
      return Array.from({ length: 14 }, (_, i) => ({
        kind: 'twinkle' as const,
        shape: 'star' as const,
        x: between(r, 4, 96),
        y: between(r, 4, 96),
        size: between(r, 8, 16),
        color: SPARKLE_COLORS[i % SPARKLE_COLORS.length]!,
        opacity: 1,
        duration: between(r, 2, 3.6),
        delay: between(r, -3.6, 0),
        drift: 0,
        spin: 90,
      }));
    }
  }
}

const cache = new Map<ProfileEffect, Particle[]>();

/** Efektin parçacıkları (her efekt için sabit) */
export function effectParticles(effect: ProfileEffect): Particle[] {
  let list = cache.get(effect);
  if (!list) {
    list = build(effect);
    cache.set(effect, list);
  }
  return list;
}

/** Tema degradesi (CSS ve React Native'in backgroundImage'ı aynı sözdizimini kullanır) */
export const profileGradient = (theme: ProfileTheme): string =>
  `linear-gradient(180deg, ${theme.primary} 0%, ${theme.accent} 100%)`;
