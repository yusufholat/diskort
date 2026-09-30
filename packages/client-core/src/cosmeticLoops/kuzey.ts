// Kuzey Işıkları: döngü biçimi (dosyaya çizilen dikişsiz döngü; bkz. loop.ts). Canlı kalıp ve uygulamanın çizdiği
// gölgelendirici cosmeticShaders/kuzey.ts'te; bu dosya yalnızca çizim aracı ve masaüstü 2B katmanı içindir:
// client-core'un ana girişi buraya uzanmaz (telefon paketine girmez).

import { glslFloat, loopRate } from './loop';
import { kuzeySource as source } from '../cosmeticShaders/kuzey';

/**
 * Döngü biçiminin ayarları: karışan iki kopyanın (yarım döngü arayla kaymış aynı gürültü) birbirine benzerliği
 * (ilinti, 6 sn'lik döngüde ölçüldü). Karışımın kontrastı buna göre düzeltilir: kopyalar neredeyse aynıysa
 * (kenar) düzeltme gerekmez, ayrıştıkça ortadaki soluklaşma geri alınır. decoRayCells: dekorasyon halkasının
 * çevresindeki ışın hücresi sayısı (canlıda 13 yarıçaplı çemberin çevresi ≈ 82).
 */
export const KUZEY_LOOP = { edgeRho: 0.87, swellRho: 0.69, decoEdgeRho: 0.64, decoWidthRho: 0.63, decoSwellRho: 0.58, decoRayCells: 82 } as const;

/** Işın çizgilerinin zaman ekseninde döngüye sığan hücre sayısı (canlıda saniyede .5 hücre; en az 1) */
const rayCells = (period: number): number => Math.max(1, Math.round(0.5 * period));

/**
 * Döngü biçimi: zamana bağlı her terim `period` saniyede kendini yineler (u_time = 0 ile u_time = period aynı
 * kare) ve hiçbir an ötekilerden ayırt edilmez:
 * - Gürültüde düz kayan terimler (perdenin kenarı, parlaklık dalgası; dekorasyonda kenar, genişlik, dalga):
 *   canlıdaki hızla kayan, yarım döngü arayla başa dönen iki kopyanın karışımı. Kopya, ağırlığı sıfırken başa
 *   döner; kopyalar birbirinin az kaymış hâli olduğundan karışım perdeyi bulandırmaz. Üç katmanın geçişleri
 *   birbirine göre üçte bir döngü kaydırılır (hepsi aynı anda yenilenmesin).
 * - Işın çizgileri: gürültünün zaman ekseni döngüye tam sayıda hücreyle sarılır (karışım yok, ışınlar yerinde
 *   yanıp söner). Dekorasyonda ışınlar açıya göre dizilir (halkayı tam dolanır), zamanla yerinde değişir.
 * - Kenardaki dalga ve yıldızların parıltısı: döngüye tam sayıda sığan en yakın hız (yıldızlar: ortak kısmın
 *   döngü biçimi, cosmeticShaderCommon).
 */
export function kuzeyLoopShader(period: number): string {
  const P = glslFloat(period);
  const N = rayCells(period);
  const rayRate = glslFloat(N / period);
  const K = KUZEY_LOOP;
  const helpers = `// döngü: iki kopyanın zamanı (x, y: -P/2..P/2) ve ağırlığı (z, w); kopya, ağırlığı sıfırken başa döner
vec4 lp2(float s){return vec4((s-.5)*${P},(fract(s+.5)-.5)*${P},.5-.5*cos(TAU*s),.5+.5*cos(TAU*s));}
// döngü: iki kopyanın karışımı; rho kopyaların ilintisi (kontrast, karışımın ortasında da aynı kalır)
float lmix(float a,float b,vec4 k,float rho){return .5+((a-.5)*k.z+(b-.5)*k.w)/sqrt(k.z*k.z+k.w*k.w+2.*rho*k.z*k.w);}
// döngü: iki ekseni de sarılan değer gürültüsü (per: eksenlerdeki hücre sayısı)
float vnp(vec2 p,vec2 per){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.-2.*f);
  vec2 a=mod(i,per);vec2 b=mod(i+1.,per);
  return mix(mix(h21(a),h21(vec2(b.x,a.y)),u.x),mix(h21(vec2(a.x,b.y)),h21(b),u.x),u.y);}
`;
  return source({
    helpers,
    layerInit: `vec4 L=lp2(fract(t/${P}+fi/3.));\n    `,
    edge: `lmix(fbm3(vec2(x*.9-L.x*.05*(1.+fi*.4),fi*4.)),fbm3(vec2(x*.9-L.y*.05*(1.+fi*.4),fi*4.)),L,${glslFloat(K.edgeRho)})`,
    ripple: `t*${glslFloat(loopRate(0.35, period))}`,
    rays: `vnp(vec2(x*26.,t*${rayRate}+fi*9.),vec2(4096.,${glslFloat(N)}))`,
    swell: `lmix(fbm3(vec2(x*2.2-L.x*.12,fi*2.+L.x*.03)),fbm3(vec2(x*2.2-L.y*.12,fi*2.+L.y*.03)),L,${glslFloat(K.swellRho)})`,
    decoInit: `vec4 L=lp2(fract(t/${P})); vec4 M=lp2(fract(t/${P}+.33));\n    `,
    decoEdge: `lmix(fbm3(dir*1.6+vec2(L.x*.12,-L.x*.07)),fbm3(dir*1.6+vec2(L.y*.12,-L.y*.07)),L,${glslFloat(K.decoEdgeRho)})`,
    decoWidth: `lmix(fbm3(dir*2.3-M.x*.1),fbm3(dir*2.3-M.y*.1),M,${glslFloat(K.decoWidthRho)})`,
    decoRays: `vnp(vec2(atan(dir.y,dir.x)/TAU*${glslFloat(K.decoRayCells)},t*${rayRate}),vec2(${glslFloat(K.decoRayCells)},${glslFloat(N)}))`,
    decoSwell: `lmix(fbm3(dir*2.+vec2(-M.x*.15,M.x*.05)),fbm3(dir*2.+vec2(-M.y*.15,M.y*.05)),M,${glslFloat(K.decoSwellRho)})`,
  });
}
