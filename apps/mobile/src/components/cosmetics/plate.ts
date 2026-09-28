// İsim plakalarının (üye listesi satırı) telefondaki 2B katman ayarları. Zemin gölgelendiricisi masaüstüyle
// ortaktır (client-core cosmeticShaders, plaka dalları ve plateGrade) ve oradan kendiliğinden gelir; burada
// yalnızca üstüne çizilen parçacıkların yeri, sayısı ve sönükleşmesi ile en son çizilen koyu perde durur
// (masaüstündeki desktop cosmetics/layers.ts'in plaka ayarlarıyla aynı). Avatar, ad ve durumun durduğu sol
// taraf sakin ve koyu kalır, sahne sağdadır.

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const PLATE = {
  /** Karadelik: deliğin yeri ve yarıçapı plaka yüksekliğine göre (gölgelendiricinin plaka dalıyla aynı olmalı) */
  karadelik: {
    hole: (w: number, h: number) => ({ cx: w - h * 1.35, cy: h * 0.5, RS: h * 0.24 }),
    /** İçeri çekilen yıldız sayısı ve en uzak başlangıç uzaklığı (genişliğin katı) */
    stars: 9,
    reach: 0.4,
  },
  sakura: {
    /** Süzülen yaprak sayısı ve boyu */
    petals: 7,
    petalScale: 0.6,
    /** Yapraklar yazıların altına süzülmez: sola doğru kaybolur (x'e göre örtücülük katı) */
    petalAlpha: (x: number, w: number) => smooth(w * 0.38, w * 0.75, x),
    /** Sağ üst köşedeki dal: yeri (sağ kenardan) ve ölçeği */
    branch: { dx: 2, y: -2, scale: 0.36 },
  },
  atesbocegi: {
    fireflies: 8,
    /** Satırın üst ve alt kenarından boşluk (px) */
    inset: 4,
    /** Dikey salınımın katı (satır alçak) */
    sway: 0.3,
    size: 0.6,
    /** Yalnızca sağda: yazıların altında parlayan nokta olmasın (x'e göre parlaklık katı) */
    dim: (x: number, w: number) => smooth(w * 0.4, w * 0.8, x),
  },
  buz: {
    /** Dendritlerin kökleri: sağ kenardan satıra yayılır */
    roots: (w: number, h: number) => [
      { x: w, y: 0, a: 2.4, len: h * 1.2 },
      { x: w, y: h, a: -2.4, len: h * 1.1, delay: 4 },
      { x: w, y: h / 2, a: Math.PI, len: h * 1.4, delay: 2 },
      { x: w - h * 1.6, y: h, a: -1.9, len: h * 0.8, delay: 10 },
    ],
    dim: 0.8,
  },
  /**
   * Son adım: soldan sağa açılan, setin en koyu renginde perde. Duraklar: (satır genişliğine oran,
   * örtücülük); yumuşak iniş, keskin kenar yok.
   */
  scrim: [
    [0, 0.86],
    [0.3, 0.78],
    [0.45, 0.52],
    [0.6, 0.24],
    [0.72, 0.07],
    [0.8, 0],
  ] as readonly (readonly [number, number])[],
} as const;
