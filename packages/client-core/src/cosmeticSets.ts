// Hareketli kozmetik setlerinin görünüş bilgileri: renkler (seçici kutuları, WebGL yoksa 2B yedek
// zeminler, küçük avatarlardaki sabit halka) ve açıklamalar. Çizimin kendisi platformda (masaüstü:
// components/cosmetics), formüller cosmeticShaders'ta.

import type { CosmeticSet } from '@diskort/shared';

export interface CosmeticSetInfo {
  /** Vurgu rengi (seçili kutu, halka) */
  accent: string;
  /** Afiş degradesinin iki rengi (kutunun yüklenirkenki zemini) */
  from: string;
  to: string;
  /** WebGL yokken 2B zemin: iki degrade rengi ve bir parıltı (rgba) */
  fallback: readonly [string, string, string];
  /** Setin kısa açıklaması */
  description: string;
  /** Parçaların tek satırlık açıklamaları: profil efekti, avatar dekorasyonu, isim plakası */
  pieces: readonly [string, string, string];
}

export const COSMETIC_SET_INFO: Record<CosmeticSet, CosmeticSetInfo> = {
  karadelik: {
    accent: '#ffb35c',
    from: '#07060d',
    to: '#2b1636',
    fallback: ['#040308', '#140a1e', 'rgba(255,150,70,.35)'],
    description:
      'Işığı bile bırakmayan bir çekim. Arkadaki yıldızlar kütlenin çevresinde bükülür, yığılma diski yaklaşan tarafta parlar.',
    pieces: [
      'Kütleçekimsel mercek, Doppler parlaması, içeri çekilen yıldızlar',
      'Avatar olay ufku olur; foton halkası ve eğik disk döner',
      'Adının yanında dönen küçük bir tekillik',
    ],
  },
  sakura: {
    accent: '#ff8fb8',
    from: '#4a1233',
    to: '#d9809f',
    fallback: ['#2b0d22', '#b14f73', 'rgba(255,190,215,.45)'],
    description:
      'Köşeden uzanan dalda tomurcuklar açar; olgunlaşan çiçekler yapraklarını rüzgâra bırakır, yapraklar takla atarak süzülür.',
    pieces: [
      'Açan çiçekler, takla atan yapraklar, yumuşak ışık huzmeleri',
      'Avatarın çevresinde büyüyen asma, açan çiçekler',
      'Satır boyunca süzülen yapraklar',
    ],
  },
  kuzey: {
    accent: '#5dffb0',
    from: '#03121f',
    to: '#0c4a47',
    fallback: ['#02060f', '#0b3b3a', 'rgba(90,255,170,.35)'],
    description: 'Işık perdeleri gökyüzünde dalgalanır: alt kenarı keskin ve yeşil, yukarı çıktıkça mora dağılır.',
    pieces: [
      'Katmanlı aurora perdeleri, parlayan yıldızlar, kayan yıldız',
      'Avatardan dışa doğru yükselen aurora halkası',
      'Satır boyunca akan ışık şeridi',
    ],
  },
  atesbocegi: {
    accent: '#d9f56b',
    from: '#06130f',
    to: '#1d3a2c',
    fallback: ['#030a08', '#12302a', 'rgba(210,245,110,.3)'],
    description: 'Sisli bir çam ormanında sıcak ışıklar yanıp söner. Yakındakiler iri ve yumuşak, uzaktakiler küçük ve keskin.',
    pieces: [
      'Katmanlı orman silüeti, süzülen sis, ateşböcekleri',
      'Avatarın önünden ve arkasından geçen ateşböcekleri',
      'Karanlık orman şeridinde yanıp sönen ışıklar',
    ],
  },
  buz: {
    accent: '#9fe6ff',
    from: '#0b2a44',
    to: '#6fb3d9',
    fallback: ['#04101c', '#2a5d80', 'rgba(180,235,255,.35)'],
    description: 'Buz köşelerden dallanarak büyür, yüzeyler ışığı kırar, pırıltılar belirip kaybolur. Sonra erir ve yeniden başlar.',
    pieces: [
      'Kenarlardan büyüyen kırağı, kırılan yüzeyler, parlama',
      'Avatardan dışa doğru büyüyen buz kristalleri',
      'Sağdan satıra yayılan kırağı',
    ],
  },
  neon: {
    accent: '#ff4fd8',
    from: '#12051f',
    to: '#0a3346',
    fallback: ['#08040f', '#2a0f3d', 'rgba(255,80,220,.35)'],
    description: 'Tabelaların ışığı ıslak zeminde yansır, damlalar halkalar açar, neon tüp ara ara titrer.',
    pieces: [
      'Yağmur çizgileri, neon parıltısı, zeminde halkalar',
      'Çift neon tüp halka, çarpıp sıçrayan damlalar',
      'Titreşen neon çizgi ve yağmur',
    ],
  },
};
