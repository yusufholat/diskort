// Karadelik: döngü biçimi (dosyaya çizilen dikişsiz döngü; bkz. loop.ts). Canlı kalıp ve uygulamanın çizdiği
// gölgelendirici cosmeticShaders/karadelik.ts'te; bu dosya yalnızca çizim aracı ve masaüstü 2B katmanı içindir:
// client-core'un ana girişi buraya uzanmaz (telefon paketine girmez).

import { glslFloat, loopRate } from './loop';
import { karadelikSource as source } from '../cosmeticShaders/karadelik';

/**
 * Döngü biçiminin ayarları.
 * - drift: arka planın kayma hızı (css px/sn; canlıdakiyle aynı).
 * - starFade: bir yıldızın ömrünün başında ve sonunda yanıp söndüğü pay.
 * - windFrom: disk gürültüsünün bir kopyası, ömrünün başında bu kadar saniyelik Kepler sarılmasıyla başlar ve
 *   bir döngü boyunca sarılmaya devam eder (sarmal kollar hep aynı yönde, hiç düz ya da ters sarılı değil).
 * - radialPhase: iki kopya arasındaki geçişin yarıçapla kayması (döngünün kesri / RS): disk hep birden değil,
 *   içten dışa doğru dalga dalga yenilenir.
 * - plateX: isim plakasında deliğin sağ kenardan uzaklığı (satır yüksekliğinin katı). Canlıda 1.35; döngü
 *   biçiminde delik sağ kenara yakın durur: disk kenara değecek kadar sağda, sol taraf (avatar, ad) sakin ve koyu.
 */
export const KARADELIK_LOOP = { drift: [3, 0.8], starFade: 0.24, windFrom: 2, radialPhase: 0.22, plateX: 0.9 } as const;

/**
 * Döngü biçimi: zamana bağlı her terim `period` saniyede kendini yineler (u_time = 0 ile u_time = period aynı
 * kare) ve hiçbir an ötekilerden ayırt edilmez (başa sarma, toplu belirme ya da kaybolma yok):
 * - Yıldızlar: canlıda bütün gökyüzü durmadan kayar. Burada her yıldız kendi hücresinde doğar, canlıdaki hızla
 *   kayar, söner ve yerinde yeniden doğar; her yıldızın ömrü `period` ama başlangıcı rastgele. Parıltı hızı
 *   döngüye tam sayıda sığar. Merceğin yıldızları deliğin çevresinde bükmesi aynen kalır.
 * - Bulutsu: aynı hızla kayan, yarım döngü arayla başa dönen iki kopyanın karışımı (kopya, ağırlığı sıfırken döner).
 * - Disk: gürültünün iki kopyası yarım döngü arayla yenilenir; her biri Kepler hızıyla (iç kısım daha hızlı)
 *   dönüp sarılır, ağırlığı sıfırken başa döner. Karışım kontrastı korur (iki bağımsız gürültünün ortalaması
 *   soluk kalmasın).
 * - Yay: canlıdaki hıza en yakın tam tur.
 */
export function karadelikLoopShader(period: number): string {
  const P = glslFloat(period);
  const { drift, starFade, windFrom, radialPhase } = KARADELIK_LOOP;
  const tau = Math.PI * 2;
  const travel = `vec2(${glslFloat(drift[0] * period)},${glslFloat(drift[1] * period)})`;
  const velocity = `vec2(${glslFloat(drift[0])},${glslFloat(drift[1])})`;
  // parıltı: canlıdaki hız (saniyede .8–3.4 radyan) döngüye tam sayıda sığan en yakın hıza
  const twinkle = `max(1.,floor((.8+2.6*h21(id+9.1))*${glslFloat(period / tau)}+.5))*${glslFloat(tau / period)}`;
  const helpers = `// döngü: iki kopyanın zamanı (x, y: -P/2..P/2) ve ağırlığı (z, w); kopya, ağırlığı sıfırken başa döner
vec4 lp2(float s){return vec4((s-.5)*${P},(fract(s+.5)-.5)*${P},.5-.5*cos(TAU*s),.5+.5*cos(TAU*s));}
// döngü: her yıldız kendi hücresinde doğar, kayar, söner (komşu hücrelerin yıldızları da bakılır: yıldız
// hücresinden taşabilir)
vec3 starLayerL(vec2 p,float cell,float dens,float t,float seed){
  vec2 q=p/cell+seed; vec2 id0=floor(q); vec3 acc=vec3(0.);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 id=id0+vec2(float(i),float(j));
    float r=h21(id+seed); vec2 o=.2+.6*h22(id+seed*1.3);
    float u=fract(t/${P}+h21(id+seed+6.6));
    float d=length((q-id-o)*cell+${travel}*(u-.5));
    float m=pow(h21(id+seed+4.2),4.);
    float sz=.55+1.3*m;
    float tw=.6+.4*sin(t*${twinkle}+r*50.);
    float life=smoothstep(0.,${glslFloat(starFade)},u)*smoothstep(1.,${glslFloat(1 - starFade)},u);
    float s=exp(-d*d/(sz*sz))*step(1.-dens,r)*(.35+1.3*m)*tw*life;
    acc+=mix(vec3(1.,.83,.68),vec3(.72,.84,1.),h21(id+2.7))*s;
  }
  return acc;
}
vec3 starsL(vec2 p,float t){return starLayerL(p,11.,.3,t,0.)+starLayerL(p,23.,.4,t,7.3)*1.25;}
`;
  const sky = `col=starsL(src,t)*mag;
    vec4 L=lp2(fract(t/${P}));
    vec2 sa=src+${velocity}*L.x; vec2 sb=src+${velocity}*L.y;
    col+=vec3(.16,.07,.24)*sq(fbm(sa/110.)*L.z+fbm(sb/110.)*L.w)*1.6+vec3(.03,.07,.15)*(fbm(sa/48.+7.)*L.z+fbm(sb/48.+7.)*L.w);`;
  const wind = glslFloat(windFrom + period / 2);
  const disk = `vec4 K=lp2(fract(t/${P}-rd/RS*${glslFloat(radialPhase)}));
  float aa=ang+(K.x+${wind})*om; float ab=ang+(K.y+${wind})*om;
  float na=fbm(vec2(rd/RS*5.5,0.)+2.*vec2(cos(aa),sin(aa)));
  float nb=fbm(vec2(rd/RS*5.5,9.)+2.*vec2(cos(ab),sin(ab)));
  float nz=max(.5+((na-.5)*K.z+(nb-.5)*K.w)/sqrt(K.z*K.z+K.w*K.w),0.);`;
  return source({ helpers, sky, disk, archSpin: glslFloat(loopRate(1.3, period)), plateX: glslFloat(KARADELIK_LOOP.plateX) });
}
