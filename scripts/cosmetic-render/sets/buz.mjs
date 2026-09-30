// Kristal Buz'un çizim aracı ayarları (render.mjs loadSetConfig).
export default {
  // Canlı biçimden karşılaştırma kareleri: 14 sn'lik canlı döngüde büyüme, bekleme, erime
  liveAt: [1.4, 3.5, 6.3, 8.4, 12.3, 13.0],
  pieces: {
    // Kırağı canlıda kartı dört kenardan sarar. Standart tuval üste yaslandığından alt kenar olmamalı: efekt
    // 540 px'lik bir kart çiziyormuş gibi çalışır, tuval üstteki 450'yi gösterir; alt kenarın kırağısı ve alt
    // köşe dendritleri tuvalin dışında kalır (kırpılan ya da solan yerde bant olmaz).
    card: { layoutH: 540 },
  },
};
