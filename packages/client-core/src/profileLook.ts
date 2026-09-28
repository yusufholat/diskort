// Profil süsleri (afiş, tema): iki platformun ortak kısmı. Tema hazır renkleri ve degradesi burada
// tanımlanır. Profil efektleri hareketli setlerdir (bkz. cosmeticSets.ts, cosmeticShaders.ts).

import type { ProfileTheme } from '@diskort/shared';

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

/** Tema degradesi (CSS ve React Native'in backgroundImage'ı aynı sözdizimini kullanır) */
export const profileGradient = (theme: ProfileTheme): string =>
  `linear-gradient(180deg, ${theme.primary} 0%, ${theme.accent} 100%)`;
