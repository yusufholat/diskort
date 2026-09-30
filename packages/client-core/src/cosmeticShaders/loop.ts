// Önceden çizilmiş (dosyaya kaydedilen) dikişsiz döngüler için ortak kurallar. Canlı çizimde zaman sınırsız
// akar ve terimlerin süreleri birbirine uymaz (14 sn, 7.27 sn, ...); dosyaya çizilen döngüde ise zamana bağlı
// her terim aynı T süresiyle kendini yinelemelidir: son kareden ilk kareye geçiş fark edilmez. T tek bir
// değerdir (bütün setler aynı standardı kullanır), setlerin döngü biçimleri onu parametre olarak alır.
// Canlı uygulama bu dosyadaki hiçbir şeyi kullanmaz: yalnızca çizim aracı (scripts/cosmetic-render).

/** Standart döngü süresi (saniye) */
export const COSMETIC_LOOP_SECONDS = 6;

/** GLSL ondalık sabiti: tam sayılarda da nokta bulunur (GLSL ES 1.00'de `6` tam sayıdır, `6.` ondalık) */
export function glslFloat(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`GLSL sabiti sonlu olmalı: ${x}`);
  const s = String(Number(x.toFixed(6)));
  return /[.e]/.test(s) ? s : `${s}.`;
}

/**
 * Bir hızı döngüye sığdırır: `rate` (saniyede `cycle` birimlik bir turun kaçta kaçı; açısal hızda cycle = 2π)
 * döngü boyunca tam sayıda tur atan en yakın hıza yuvarlanır (en az bir tur). Böylece `sin(t * hız + faz)`
 * gibi bir terim t = 0 ile t = period'da aynı değeri verir.
 */
export function loopRate(rate: number, period: number, cycle = Math.PI * 2): number {
  const turns = Math.max(1, Math.round((Math.abs(rate) * period) / cycle));
  return ((rate < 0 ? -turns : turns) * cycle) / period;
}
