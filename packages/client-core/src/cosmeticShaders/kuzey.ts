// Kuzey Işıkları: gürültüyle şekillenen katmanlı aurora perdeleri ve parlayan yıldızlar.
//
// İki biçimi var: canlı (SHADER_KUZEY: uygulamanın çizdiği, değişmedi) ve döngü (kuzeyLoopShader: dosyaya
// çizilen dikişsiz döngü, bkz. loop.ts). İkisi aynı kaynaktan kurulur; yalnızca zamana bağlı gürültü terimleri
// değişir (perdenin kenarı, dalgası, ışın çizgileri, parlaklık dalgası; dekorasyonda aynıları halka üstünde).

import { glslFloat, loopRate } from './loop';

interface Parts {
  /** aurora()'dan önce tanımlanan yardımcılar (canlıda yok) */
  helpers: string;
  /** aurora() döngüsünün başında, katman başına tanımlar (canlıda yok) */
  layerInit: string;
  /** Perdenin alt kenarını şekillendiren gürültü (0..1) */
  edge: string;
  /** Kenardaki küçük dalganın fazı */
  ripple: string;
  /** Dikey ışın çizgileri (0..1) */
  rays: string;
  /** Perde boyunca gezen parlaklık dalgası (0..1) */
  swell: string;
  /** Dekorasyon: halkanın başında tanımlar (canlıda yok) */
  decoInit: string;
  decoEdge: string;
  decoWidth: string;
  decoRays: string;
  decoSwell: string;
}

/** Canlı: her terim gürültünün içinde düz bir çizgide sonsuza dek kayar (hiçbiri kendini yinelemez) */
const LIVE: Parts = {
  helpers: '',
  layerInit: '',
  edge: 'fbm3(vec2(x*.9-t*.05*(1.+fi*.4),fi*4.))',
  ripple: 't*.35',
  rays: 'vn(vec2(x*26.,t*.5+fi*9.))',
  swell: 'fbm3(vec2(x*2.2-t*.12,fi*2.+t*.03))',
  decoInit: '',
  decoEdge: 'fbm3(dir*1.6+vec2(t*.12,-t*.07))',
  decoWidth: 'fbm3(dir*2.3-t*.1)',
  decoRays: 'vn(dir*13.+vec2(t*.5,0.))',
  decoSwell: 'fbm3(dir*2.+vec2(-t*.15,t*.05))',
};

function source(x: Parts): string {
  return `
${x.helpers}vec3 aurora(vec2 q,float t){
  vec3 acc=vec3(0.);
  for(int i=0;i<3;i++){
    float fi=float(i);
    float x=q.x*(1.+fi*.3)+fi*3.7;
    ${x.layerInit}float edge=.62-fi*.14+.44*(${x.edge}-.5)+.04*sin(x*2.3+${x.ripple}+fi*2.);
    float dy=edge-q.y;
    float cur=dy>0.?exp(-dy/(.16+.07*fi)):exp(-sq(dy/.018));
    float str=.45+.55*${x.rays};
    str*=.5+.5*smoothstep(.2,.8,${x.swell});
    vec3 c=mix(vec3(.2,1.,.55),vec3(.1,.85,.8),smoothstep(0.,.08,dy));
    c=mix(c,vec3(.6,.3,1.),smoothstep(.06,.3,dy));
    acc+=c*cur*str*(1.-fi*.22);
  }
  return acc;
}
vec4 effect(vec2 p){
  float t=u_time; float m=u_mode;
  if(m>2.5){
    float R=u_a.x; vec2 d=p-u_res*.5; float r=length(d); vec2 dir=d/max(r,.001);
    float h=(r-R*1.02)/(u_res.x*.5-R);
    ${x.decoInit}float edge=.05+.12*${x.decoEdge};
    float dy=h-edge;
    float cur=dy>0.?exp(-dy/(.3+.25*${x.decoWidth})):exp(-sq(dy/.035));
    float str=.45+.55*${x.decoRays};
    str*=.35+.65*smoothstep(.25,.75,${x.decoSwell});
    vec3 c=mix(vec3(.2,1.,.55),vec3(.1,.85,.8),smoothstep(0.,.1,dy));
    c=mix(c,vec3(.62,.3,1.),smoothstep(.1,.5,dy));
    float fade=smoothstep(1.,.72,h)*smoothstep(R*.98,R*1.03,r);
    return vec4(c*cur*str*fade*2.,0.);
  }
  vec3 st=stars(p,t)*.9;
  if(m<.5||m>1.5){
    vec2 uv=p/u_res; float asp=u_res.x/u_res.y;
    vec2 q=m>1.5?vec2(p.x/150.,uv.y*.95):vec2(uv.x*asp,uv.y);
    vec3 a=aurora(q,t)*(m>1.5?1.6:1.); // plakada solma ve parlaklık sınırından sonra da perde seçilsin
    vec3 sky=mix(vec3(.01,.02,.06),vec3(.02,.1,.13),uv.y);
    vec3 c=sky+st*(1.-clamp(luma(a)*2.,0.,1.))+a;
    if(m<.5){
      float ridge=.8+.09*fbm3(vec2(p.x/38.,1.))-.05*abs(sin(p.x/47.));
      float mtn=smoothstep(ridge,ridge+.008,uv.y);
      c=mix(c,vec3(.005,.012,.02)+a*.06,mtn);
    } else c=plateGrade(c,p);
    return vec4(c,1.);
  }
  float bh=u_a.x; float bm=bannerMask(p); float hole=avatarHole(p);
  vec3 a=aurora(vec2(p.x/(bh*1.8),p.y/(bh*1.35)),t);
  vec3 c=(a*mix(.3,1.,bm)+st*mix(.35,1.,bm))*mix(.25,1.,hole);
  return vec4(c+vec3(0.,.012,.03)*bm*hole,bm*.55*hole);
}`;
}

/** Canlı gölgelendirici (uygulamanın çizdiği) */
export const SHADER_KUZEY = source(LIVE);

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
