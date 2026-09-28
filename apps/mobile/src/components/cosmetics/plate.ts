// İsim plakalarının (üye listesi satırı) telefondaki 2B katman ayarları. Zemin gölgelendiricisi masaüstüyle
// ortaktır (client-core cosmeticShaders, plaka dalı ve plateFade) ve oradan kendiliğinden gelir; burada
// yalnızca üstüne çizilen parçacıkların yeri, sayısı ve sönükleşmesi durur. Plakanın görünüşü (ör. adın
// okunması için sol tarafın sakin kalması) değişince bu değerler ayrıca ayarlanabilir.

export const PLATE = {
  /** Karadelik: deliğin yeri ve yarıçapı plaka yüksekliğine göre (gölgelendiricinin plaka dalıyla aynı olmalı) */
  karadelik: {
    hole: (w: number, h: number) => ({ cx: w - h * 1.35, cy: h * 0.5, RS: h * 0.24 }),
    /** İçeri çekilen yıldız sayısı ve en uzak başlangıç uzaklığı (genişliğin katı) */
    stars: 9,
    reach: 0.55,
  },
  sakura: {
    /** Süzülen yaprak sayısı ve boyu */
    petals: 7,
    petalScale: 0.6,
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
    /** Sol taraf (ad) sönük: soldan sağa bu aralıkta tam parlaklığa çıkar (genişliğin oranı) */
    dim: { from: 0.35, x0: 0.1, x1: 0.6 },
  },
  buz: {
    /** Dendritlerin kökleri: sağ kenardan satıra yayılır */
    roots: (w: number, h: number) => [
      { x: w, y: 0, a: 2.4, len: h * 1.2 },
      { x: w, y: h, a: -2.4, len: h * 1.1, delay: 4 },
      { x: w, y: h / 2, a: Math.PI, len: h * 1.4, delay: 2 },
      { x: w - h * 1.6, y: h, a: -1.9, len: h * 0.8, delay: 10 },
    ],
  },
} as const;
