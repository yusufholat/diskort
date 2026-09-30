// Döngü biçimlerinin (bkz. loop.ts) hareket yardımcıları: doğal temposu döngüden yavaş olan setler için
// (sakura, ateşböceği). Hız yuvarlamak (loopRate) bunlarda işe yaramaz: 20 saniyede inen bir yaprağı 6 saniyeye
// sığdırmak onu üç kat hızlandırır. Bunun yerine iki yol var:
// - ray (loopTrackPhase): yol döngüden uzun sürer, üstünde birer döngü arayla birbirinin eşi parçacıklar ilerler;
// - kaydırmalı kopyalar (loopDriftGlsl): süzülen gürültü, evreleri dağıtılmış ve her biri kendi ömrünün
//   sonunda görünmezken başa dönen kopyaların toplamıdır.
// Canlı uygulama bu dosyadaki hiçbir şeyi kullanmaz: yalnızca çizim aracı (scripts/cosmetic-render).

import { glslFloat } from './loop';

/** Kesirli kısım [0,1): çok küçük eksi sayılarda yuvarlama 1 verebilir, o da 0 sayılır */
function fract(x: number): number {
  const f = x - Math.floor(x);
  return f < 1 ? f : 0;
}

/** Döngünün evresi [0,1): `offset` (döngünün kesri) kadar kaydırılmış */
export function loopPhase(t: number, period: number, offset = 0): number {
  return fract(t / period + offset);
}

/**
 * Ray: `span` döngü süren bir yol ve üstünde birer döngü arayla ilerleyen, birbirinin eşi `span` parçacık.
 * Bir döngü sonra her parçacık bir öndekinin yerindedir, yani kare aynıdır; ama hiçbir parçacık hızlanmak
 * zorunda kalmaz (yol 3 döngü sürüyorsa parçacık onu 18 saniyede geçer). Dönen değer `index`'inci parçacığın
 * yoldaki yeri [0,1). Yol kapalı bir eğri değilse parçacık iki ucunda görünmez olmalıdır (görünümün dışında
 * ya da sönmüş): 1'den 0'a dönüş orada olur.
 */
export function loopTrackPhase(t: number, period: number, span: number, index: number, offset = 0): number {
  return fract((t / period + offset + index) / span);
}

/** Belirip kaybolma penceresi: evrenin iki ucunda 0 (eğimi de 0), ortasında 1 */
export function loopWindow(u: number): number {
  const s = Math.sin(Math.PI * u);
  return s * s;
}

/**
 * Döngüde süzülen gürültü: `float name(vec2 q, vec2 v, float t)`. q gürültü koordinatı, v saniyedeki kayma
 * (gürültü birimi). Canlıda `fbm3(q + v*t)` zamanı koordinat olarak kullanır ve kendini hiç yinelemez. Burada
 * `copies` ayrı desen toplanır: her biri ömrü (bir döngü) boyunca aynı hızla kayar, sin² penceresiyle belirip
 * kaybolur ve görünmezken başa döner; evreleri eşit aralıklıdır. Pencerelerin toplamı (copies/2) ve karelerinin
 * toplamı (3·copies/8) sabit olduğundan ortalama ve kontrast döngü boyunca değişmez: dikiş anı öteki anlardan
 * ayırt edilemez (iki kopyayı çapraz geçirmek döngünün ortasında deseni soldururdu).
 */
export function loopDriftGlsl(name: string, noise: 'fbm' | 'fbm3', period: number, copies = 3): string {
  if (!Number.isInteger(copies) || copies < 3) throw new Error(`kopya sayısı en az 3 olmalı: ${copies}`);
  const P = glslFloat(period);
  return `float ${name}(vec2 q,vec2 v,float t){
  float s=0.;
  for(int k=0;k<${copies};k++){
    float fk=float(k);
    float u=fract(t/${P}+fk/${glslFloat(copies)});
    s+=sq(sin(PI*u))*(${noise}(q+v*((u-.5)*${P})+fk*vec2(17.3,9.7))-.5);
  }
  return .5+s/${glslFloat(Math.sqrt((3 * copies) / 8))};
}
`;
}
