// Karadelik: kütleçekimsel mercek, Doppler parlaması, eğik yığılma diski ve foton halkası.
//
// İki biçimi var: canlı (SHADER_KARADELIK: uygulamanın çizdiği, değişmedi) ve döngü (karadelikLoopShader:
// dosyaya çizilen dikişsiz döngü, bkz. loop.ts). İkisi aynı kaynaktan kurulur; yalnızca zamana bağlı üç yer
// değişir: arka plan (yıldızlar ve bulutsu), diskin gürültüsü ve yayın dönüş hızı.

import { glslFloat, loopRate } from './loop';

interface Parts {
  /** effect()'ten önce tanımlanan yardımcılar (canlıda yok) */
  helpers: string;
  /** Mercekten geçen arka plan: `src` noktasından `col`'u doldurur */
  sky: string;
  /** Diskin gürültüsü: `ang`, `om`, `rd`'den `nz`'yi tanımlar */
  disk: string;
  /** Gölgenin üstündeki yayın dönüş hızı (saniyede radyan) */
  archSpin: string;
}

/** Canlı: arka plan saniyede (3, .8) piksel kayar (sonsuza dek; gürültü ve yıldız hücreleri yinelenmez) */
const SKY_LIVE = `vec2 sp=src+vec2(t*3.,t*.8);
    col=stars(sp,t)*mag;
    col+=vec3(.16,.07,.24)*sq(fbm(sp/110.))*1.6+vec3(.03,.07,.15)*fbm(sp/48.+7.);`;
/** Canlı: her yarıçap kendi hızıyla döner (hız yarıçapla sürekli değişir: desen bir daha aynı hizaya gelmez) */
const DISK_LIVE = `float a=ang+t*om;
  float nz=fbm(vec2(rd/RS*5.5,0.)+2.*vec2(cos(a),sin(a)));`;

function source(x: Parts): string {
  return `
${x.helpers}vec3 diskCol(float temp,float dop){
  vec3 c=mix(vec3(1.,.34,.07),vec3(1.,.88,.66),clamp(temp,0.,1.));
  c=mix(c,vec3(.8,.88,1.),clamp((dop-1.)*.45,0.,.55));
  c=mix(c,c*vec3(1.,.55,.4),clamp((1.-dop)*1.2,0.,.6));
  return c;
}
vec4 effect(vec2 p){
  float t=u_time; float m=u_mode;
  vec2 C=u_res*.5; float RS=min(u_res.x,u_res.y)*.14; float tilt=.2;
  if(m>.5&&m<1.5){C=vec2(u_res.x*.73,u_a.x*.48);RS=u_a.x*.15;}
  // plaka: 42 piksellik satırda da delik seçilsin diye büyükçe
  else if(m>1.5&&m<2.5){C=vec2(u_res.x-u_res.y*1.35,u_res.y*.5);RS=u_res.y*.24;tilt=.22;}
  else if(m>2.5){RS=u_a.x;tilt=.3;}
  bool deco=m>2.5;
  vec2 d=p-C; float r=length(d); vec2 n=d/max(r,.001);
  vec3 col=vec3(0.);
  if(!deco){
    // kütleçekimsel mercek: arka plan noktası theta - thetaE^2/theta konumundan örneklenir
    float thE=RS*1.6; float rr=max(r,RS*.95);
    vec2 src=C+d*(1.-thE*thE/(rr*rr));
    float mag=1.+1.4*exp(-sq((r-thE)/(RS*.3)));
    ${x.sky}
    // kartta yazıların üstündeki yıldızlar iyice sönük (okunurluk)
    if(m>.5&&m<1.5)col*=mix(.22,1.,bannerMask(p));
  }
  vec2 dr=rot(-.12)*d;
  vec2 dp=vec2(dr.x,dr.y/tilt); float rd=length(dp);
  float rin=deco?RS*1.1:RS*1.35;
  float rout=deco?u_res.x*.49:RS*3.6;
  float ang=atan(dp.y,dp.x);
  float om=1.4*pow(rin/max(rd,rin*.6),1.5);          // Kepler: iç kısım daha hızlı
  ${x.disk}
  float band=smoothstep(rin*.95,rin*1.15,rd)*smoothstep(rout,mix(rin,rout,.35),rd);
  float temp=pow(rin/max(rd,1.),1.4);
  float dop=pow(max(1.-.6*dp.x/max(rd,.001),.05),1.9); // yaklaşan (sol) taraf parlak
  float I=band*(.2+1.5*nz*nz)*temp*dop*1.5;
  vec3 disk=diskCol(temp*1.15,dop)*I;
  float front=smoothstep(-1.,1.5,dr.y);
  float shadow=1.-smoothstep(RS-1.,RS+.8,r);
  // diskin arka yarısının bükülmüş görüntüsü: gölgenin üstünde yay
  float ar=(r-RS*1.04)/(RS*(deco?.36:.75));
  float archB=smoothstep(0.,.12,ar)*smoothstep(1.,.15,ar);
  float archW=mix(.14,1.,smoothstep(-.35,.8,-n.y));
  float a2=atan(n.y,n.x)+t*${x.archSpin};
  float nz2=fbm(vec2(ar*3.,4.)+2.*vec2(cos(a2),sin(a2)));
  float dop2=pow(max(1.-.5*n.x,.05),1.7);
  vec3 arch=diskCol(.75-ar*.5,dop2)*archB*archW*(.2+1.3*nz2*nz2)*dop2*.85;
  float pr=exp(-sq((r-RS*1.025)/(RS*.022+.45)));
  vec3 ring=vec3(1.,.9,.76)*pr*(.5+.55*dop2);
  col+=disk*(1.-front);
  col*=1.-shadow;
  col+=arch*(1.-shadow)+ring;
  col+=disk*front*(deco?mix(1.,.72,shadow):1.);
  col+=vec3(1.,.48,.18)*.12*exp(-max(r-RS,0.)/(RS*1.3))*(1.-shadow);
  float alpha=0.;
  if(m<.5){alpha=1.;}
  else if(m<1.5){
    float hole=avatarHole(p); float bm=bannerMask(p);
    float voidA=smoothstep(RS*6.,RS*1.3,r);
    col*=mix(.2,1.,hole)*mix(.5,1.,bm);
    alpha=max(max(voidA*.95,bm*.7)*hole,shadow);
  } else if(m<2.5){alpha=1.;col=plateGrade(col,p);}
  return vec4(col,alpha);
}`;
}

/** Canlı gölgelendirici (uygulamanın çizdiği) */
export const SHADER_KARADELIK = source({ helpers: '', sky: SKY_LIVE, disk: DISK_LIVE, archSpin: '1.3' });

/**
 * Döngü biçiminin ayarları.
 * - drift: arka planın kayma hızı (css px/sn; canlıdakiyle aynı).
 * - starFade: bir yıldızın ömrünün başında ve sonunda yanıp söndüğü pay.
 * - windFrom: disk gürültüsünün bir kopyası, ömrünün başında bu kadar saniyelik Kepler sarılmasıyla başlar ve
 *   bir döngü boyunca sarılmaya devam eder (sarmal kollar hep aynı yönde, hiç düz ya da ters sarılı değil).
 * - radialPhase: iki kopya arasındaki geçişin yarıçapla kayması (döngünün kesri / RS): disk hep birden değil,
 *   içten dışa doğru dalga dalga yenilenir.
 */
export const KARADELIK_LOOP = { drift: [3, 0.8], starFade: 0.24, windFrom: 2, radialPhase: 0.22 } as const;

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
  return source({ helpers, sky, disk, archSpin: glslFloat(loopRate(1.3, period)) });
}
