// Sakura: döngü biçimi (dosyaya çizilen dikişsiz döngü; bkz. loop.ts). Canlı kalıp ve uygulamanın çizdiği
// gölgelendirici cosmeticShaders/sakura.ts'te; bu dosya yalnızca çizim aracı ve masaüstü 2B katmanı içindir:
// client-core'un ana girişi buraya uzanmaz (telefon paketine girmez).

import { glslFloat, loopRate } from './loop';
import { loopDriftGlsl } from './loopMotion';
import { sakuraSource as source } from '../cosmeticShaders/sakura';

/**
 * Döngü: ızgara kaymaz. Her diskin ömrü bir döngüdür: belirir, canlıdaki hızla (sola ve aşağı, diskten diske
 * biraz değişen yönde) süzülür, söner ve görünmezken başa döner; evreler dağınık olduğundan her an aynı sayıda
 * disk görünür. Disk hücresinden taşabildiği için komşu hücrelere de bakılır (kesik disk kalmaz).
 */
function bokehLoop(P: string): string {
  return `vec3 bokeh(vec2 p,float t,float cell,float seed,float dens){
  vec2 q=p/cell+vec2(seed,seed*.7);
  vec2 id0=floor(q); vec2 f=fract(q)-.5;
  vec3 acc=vec3(0.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y)); vec2 id=id0+g;
    float r=h21(id+seed);
    float u=fract(t/${P}+h21(id+seed+7.7));
    vec2 drift=rot((h21(id+seed+2.9)-.5)*1.2)*vec2(-.03,.05)*(.6+.8*h21(id+seed+6.1));
    vec2 o=(h22(id+seed+1.)-.5)*.45+drift*((u-.5)*${P});
    float rad=.14+.16*h21(id+3.3);
    float dd=length(f-g-o);
    float disc=smoothstep(rad,rad-.035,dd)*(.45+.55*smoothstep(rad*.3,rad,dd));
    float on=step(1.-dens,r)*sq(sin(PI*u));
    // doygun pembe: sönük hâlde de gri disk gibi değil pembe ışık gibi okunsun
    acc+=mix(vec3(1.,.4,.66),vec3(1.,.62,.8),h21(id+5.1))*disc*on;
  }
  return acc;
}`;
}

/**
 * Döngü biçimi: zamana bağlı her terim `period` saniyede kendini yineler (u_time = 0 ile u_time = period aynı
 * kare). Huzme ve zemin gürültüleri canlıdaki hızlarıyla süzülür (kaydırmalı kopyalar, bkz. loopMotion.ts);
 * bokeh diskleri bir döngülük ömürle belirip kaybolur; halenin nabzı döngüye sığan en yakın hıza yuvarlanır.
 * Kartın alt kenarına bağlı ışıma yoktur: standart kart tuvalinde efekt üste yaslanır, alt kenara bir şey bağlanmaz.
 */
export function sakuraLoopShader(period: number): string {
  return source({
    pre: loopDriftGlsl('skDrift3', 'fbm3', period) + loopDriftGlsl('skDrift5', 'fbm', period),
    bokeh: bokehLoop(glslFloat(period)),
    haloPulse: `sin(t*${glslFloat(loopRate(1.3, period))})`,
    rayWarp: 'skDrift3(vec2(an*5.,0.),vec2(0.,.12),t)',
    rayGrain: 'skDrift3(vec2(an*11.,3.),vec2(0.,.09),t)',
    bodyGlow: '',
    bgNoise: 'skDrift5(p/60.,vec2(.05,0.),t)',
  });
}

// ---------- Döngü biçiminin 2B katmanı (masaüstü layers.ts) için eğriler ----------

/**
 * Açıp dökülen bir çiçeğin döngüsü (döngü süresinin kesirleri): tomurcuk bekler, açar, açık kalır, yaprakları
 * kopar, yeniden tomurcuk olur. Canlıda bu tur 11 saniyedir ve dalın bütün çiçekleri aynı turu atar; döngü
 * biçiminde çiçeklerin bir kısmı hep açık kalır (dal hiç boşalmaz), geri kalanı bu turu bir döngüde atar.
 */
export const SAKURA_LOOP = { budUntil: 0.08, openFor: 0.3, detachAt: 0.7, detachFor: 0.06 } as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
/** Hafif taşıp yerine oturan açılış (masaüstü layers.ts easeOutBack ile aynı) */
const easeOutBack = (x: number): number => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

/**
 * Açıp dökülen çiçeğin `s` evresindeki (döngünün kesri) hâli: açıklık (0 kapalı, 1 açık; açılırken biraz taşar),
 * çiçeğin ve tomurcuğun görünürlüğü. Görünen her şey süreklidir: çiçek küçükken belirir, yaprakları koparken
 * söner; tomurcuk ikisinin arasında yumuşakça belirip kaybolur (canlıdaki gibi bir karede belirmez).
 */
export function sakuraLoopBloom(s: number): { open: number; flower: number; bud: number } {
  const { budUntil, openFor, detachAt, detachFor } = SAKURA_LOOP;
  s -= Math.floor(s);
  const open = easeOutBack(clamp01((s - budUntil) / openFor));
  const flower = smooth(budUntil, budUntil + 0.05, s) * (1 - smooth(detachAt, detachAt + detachFor, s));
  const bud = s < 0.5 ? 1 - smooth(budUntil + 0.02, budUntil + 0.12, s) : smooth(detachAt + 0.02, detachAt + 0.16, s);
  return { open, flower, bud };
}

/**
 * Kopan bir yaprağın `l` yaşındaki (ömrünün kesri) görünürlüğü: çiçeğin üstünde belirir (çiçek o sırada söner),
 * süzülürken kaybolur. İki ucu 0: yaprak görünmezken başa döner.
 */
export function sakuraLoopShed(l: number): number {
  l -= Math.floor(l);
  return smooth(0, 0.05, l) * (1 - smooth(0.6, 0.94, l));
}
