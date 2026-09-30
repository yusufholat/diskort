// Neon Yağmur: döngü biçimi (dosyaya çizilen dikişsiz döngü; bkz. loop.ts). Canlı kalıp ve uygulamanın çizdiği
// gölgelendirici cosmeticShaders/neon.ts'te; bu dosya yalnızca çizim aracı ve masaüstü 2B katmanı içindir:
// client-core'un ana girişi buraya uzanmaz (telefon paketine girmez).

import { glslFloat, loopRate } from './loop';
import { neonSource as source } from '../cosmeticShaders/neon';

/**
 * Döngü biçiminin seçenekleri. flicker: tabelaların ve tüplerin titremesi. Titreme setin kimliğidir ve BİLEREK
 * anidir (tüp bir an söner); kesintisizlik denetimi onu "kesme" sayacağından denetim, titreme kapalıyken de
 * çizer (scripts/cosmetic-render/sets/neon.mjs): geriye kalan her şeyin kesintisiz olduğu öyle görülür.
 */
export interface NeonLoopOptions {
  flicker?: boolean;
}

/**
 * Döngü biçimi: zamana bağlı her terim `period` saniyede kendini yineler (u_time = 0 ile u_time = period aynı
 * kare).
 * - Titreme: adım sayısı döngüye tam sığar (6 sn'de 78 / 72 / 54 adım), adım numarası döngü içinde sayılır:
 *   aynı rastgele dizi her döngüde yinelenir.
 * - Yağmur: her sütunun hızı döngüde tam sayıda tur atacak biçimde yuvarlanır (en çok ~%8 fark).
 * - Su halkaları: döngüde tam sayıda halka (6 sn'de 4).
 * - Renk dönüşleri ve dalgalanma: en yakın tam tur (loopRate). Kesik çizgiler döngüde bir çizgi boyu kayar.
 * - Kart, standart tuvale göre yeniden kuruldu (üste yaslı, alt kenara bağlı hiçbir şey yok): tabelalar afişin
 *   üst kısmında; afişin alt üçte biri ıslak zemin (tabelaların yansıması ve canlıda kartın dibinde duran su
 *   halkaları artık burada); gövdenin iki kenarında aşağı doğru sönen ince neon tüpler; her yerde yağmur.
 *   Avatar deliği efektin kendisinde yok (araç yarıçapı eksi verir); kartın dibindeki pembe parıltı kalktı.
 */
export function neonLoopShader(period: number, options: NeonLoopOptions = {}): string {
  const flicker = options.flicker ?? true;
  const P = glslFloat(period);
  const ticks = (perSecond: number): string => {
    const n = glslFloat(Math.max(1, Math.round(perSecond * period)));
    // küçük pay: kare anı adım sınırına denk gelince (tam saniyeler) yuvarlama bir o yana bir bu yana düşmesin
    return `mod(floor(fract(t/${P})*${n}+.001),${n})`;
  };
  const turn = (rate: number): string => `t*${glslFloat(loopRate(rate, period))}`;
  const dip = (amount: string): string => (flicker ? amount : '0.');
  return source({
    signTick: ticks(13),
    rainFlow: `t/${P}*max(1.,floor(spd*(.75+.5*r)*${P}+.5))`,
    ripple: `fract(t/${P}*${glslFloat(Math.max(1, Math.round(0.7 * period)))}+r)`,
    decoA: turn(0.8),
    decoB: turn(0.6),
    decoTick: ticks(9),
    decoDash: `t*${glslFloat(loopRate(0.04, period, 1))}`,
    wobble: turn(3),
    plateFlow: turn(1.5),
    plateTick: ticks(12),
    signDip: dip('.28'),
    plateDip: dip('.2'),
    decoDip: dip('.55'),
    card: `  float bh=u_a.x; float bm=bannerMask(p); float hole=avatarHole(p);
  vec2 uv=vec2(p.x/u_res.x,p.y/bh);
  // afiş: üstte tabelalar, altta ıslak zemin (ufuk afişin %56'sında; yansıma bakış açısıyla basık: tabelalar
  // afişin solmaya başladığı alt kenarına değil, zeminin ortasına düşer)
  float hy=.56;
  vec3 c=signs(vec2(uv.x,uv.y*.9+.04),t)*.9;
  if(uv.y>hy){
    float dz=(uv.y-hy)/(1.-hy); float depth=1./(dz+.06);
    float rp=ripples(vec2((uv.x-.5)*depth*1.6,depth*.7)*2.4,t);
    vec3 rf=signs(vec2(uv.x+rp*.02,(hy-(uv.y-hy)*1.6)*.9+.04),t);
    c=mix(c,rf*.7*(.5+.5*dz)+vec3(.6,.8,1.)*rp*.6*(luma(rf)+.25),smoothstep(hy,hy+.06,uv.y));
  }
  // zemin afişi biraz daha koyultur: yansıma ıslak yüzey gibi okunsun
  float gnd=smoothstep(hy,hy+.06,uv.y);
  c*=bm;
  c+=rain(p,t)*mix(.4,1.,bm);
  // gövde: iki kenarda aşağı doğru sönen ince tüpler (solda pembe, sağda camgöbeği; renk tüp boyunca akar)
  float by=smoothstep(bh+4.,bh+30.,p.y)*smoothstep(u_res.y*.8,u_res.y*.42,p.y);
  float fl=${flicker ? `.8+.2*step(.1,h21(vec2(${ticks(12)},4.)))` : '1.'};
  float wv=.5+.5*sin(p.y*.02-${turn(1.5)});
  vec3 tl=mix(vec3(1.,.15,.7),vec3(.7,.3,1.),wv); vec3 tr=mix(vec3(.1,.85,1.),vec3(.7,.3,1.),1.-wv);
  float dl=abs(p.x-4.); float dr=abs(u_res.x-4.-p.x);
  c+=((tl*exp(-dl/6.)*.4+mix(tl,vec3(1.),.6)*exp(-sq(dl/.9))*.8)+(tr*exp(-dr/6.)*.4+mix(tr,vec3(1.),.6)*exp(-sq(dr/.9))*.8))*by*fl;
  return vec4(c*mix(.3,1.,hole),bm*(.35+.3*gnd)*hole);`,
  });
}
