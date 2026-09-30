// Kristal Buz: kenarlardan büyüyen kırağı (Voronoi hücreleri, damarlar), kırılan yüzey ve parlama.
// 14 saniyelik döngü: büyür, durur, erir (iceG; 2B katmandaki dendritler de aynı eğriyi kullanır).
//
// İki biçimi var: canlı (SHADER_BUZ: uygulamanın çizdiği, değişmedi) ve döngü (buzLoopShader: dosyaya
// çizilen dikişsiz döngü, bkz. loop.ts). İkisi aynı kaynaktan kurulur; yalnızca zamana bağlı terimler
// (büyüme eğrisi iceG, eğrinin çağrısı ve ışık süpürmesinin yeri) değişir.

import { glslFloat } from './loop';

/** Canlı: 14 sn'lik büyüme eğrisi */
const ICE_G_LIVE =
  'float iceG(float t){float s=mod(t,14.)/14.; if(s<.45)return 1.-pow(1.-s/.45,3.); if(s<.84)return 1.; float k=clamp((s-.84)/.14,0.,1.); return 1.-k*k*(3.-2.*k);}';
/** Canlı: ışık süpürmesi 1.6 birimlik yolu saniyede .22 birimle geçer (7.27 sn'de bir) */
const SWEEP_LIVE = 'mod(t*.22,1.6)-.3';

/** `iceG`: büyüme eğrisinin tanımı, `sweep`: süpürmenin yeri, `g`: effect() içinde eğrinin çağrısı */
function source(iceG: string, sweep: string, g = 'iceG(t)'): string {
  return `
${iceG}
vec3 voro(vec2 p){
  vec2 i=floor(p); vec2 f=fract(p); float d1=8.,d2=8.; vec2 best=vec2(0.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y)); vec2 o=h22(i+g)*.85+.075; vec2 rr=g+o-f; float d=dot(rr,rr);
    if(d<d1){d2=d1;d1=d;best=i+g;}else if(d<d2){d2=d;}
  }
  return vec3(sqrt(d1),sqrt(d2)-sqrt(d1),h21(best));
}
vec4 frost(vec2 p,float e,float G,float t,float reach){
  vec3 v=voro(p/20.); vec3 v2=voro(p/7.+3.1);
  float veins=pow(1.-abs(fbm(p/30.)*2.-1.),7.);
  float front=e-veins*.12+.22*(fbm3(p/45.)-.5);
  float lim=G*reach;
  float mask=smoothstep(lim,lim-.06,front)*step(.001,G);
  float cell=v.z;
  float shade=.35+.5*cell;
  float edgeL=smoothstep(.06,0.,v.y)*.5+smoothstep(.04,0.,v2.y)*.14;
  float sweepPos=${sweep};
  float diag=(p.x+p.y)/(u_res.x+u_res.y);
  float sweep=exp(-sq((diag-sweepPos)/.035))*(.4+.6*cell);
  vec3 iri=mix(vec3(.55,.95,1.),vec3(1.,.72,.96),fract(cell*3.7));
  vec3 c=vec3(.55,.78,.95)*shade*.45+mix(vec3(.85,.97,1.),iri,.35)*edgeL*.6+vec3(.92,.98,1.)*veins*.55+vec3(1.)*sweep*.75;
  float rim=smoothstep(.04,0.,abs(front-lim))*step(.001,G)*step(lim,.98*reach+.5);
  return vec4(c*mask+vec3(.7,.95,1.)*rim*.35,mask);
}
vec4 effect(vec2 p){
  float t=u_time; float m=u_mode; float G=${g};
  if(m>2.5){
    float R=u_a.x; float r=length(p-u_res*.5);
    float e=(r-R)/(u_res.x*.5-R);
    vec4 f=frost(p,e,G,t,.95);
    float k=smoothstep(R*.98,R*1.03,r)*smoothstep(1.,.82,e);
    return vec4(f.rgb*k,f.a*.85*k);
  }
  if(m>.5&&m<1.5){
    float s=min(u_res.x,u_res.y)*.5;
    float bm=bannerMask(p);
    // gövdede sol kenar yazıların başladığı yer: kırağı orada ince kalır
    float ex=min(p.x*mix(2.6,1.,bm),u_res.x-p.x)/s, ey=min(p.y,u_res.y-p.y)/s;
    float e=(sqrt(ex*ey)*1.1+min(ex,ey)*.8)*mix(1.,.75,bm);
    vec4 f=frost(p,e,G,t,.45); float hole=avatarHole(p)*mix(.6,1.,bm);
    return vec4(f.rgb*hole,f.a*.62*hole);
  }
  vec2 uv=p/u_res;
  float e=m<.5?min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y))*2.:(u_res.x-p.x)/(u_res.x*.75)-(1.-min(p.y,u_res.y-p.y)/(u_res.y*.5))*.08;
  // plakada kırağı yalnızca sağdaki ~%45'i kaplar (yazıların altına uzanmaz)
  vec4 f=frost(p,e,G,t,m<.5?.62:.6);
  vec3 v=voro(p/20.);
  vec2 q=uv+(h22(vec2(v.z*91.,3.))-.5)*f.a*.12;   // yüzey kırılması: arka plan hücre başına kayar
  vec3 bg;
  if(m>1.5){
    // plaka: açık mavi değil koyu lacivert zemin; soğuk parlama sağ kenarda, buz daha sönük
    bg=mix(vec3(.008,.02,.05),vec3(.025,.08,.15),smoothstep(.25,1.,q.x));
    bg+=vec3(.15,.38,.6)*exp(-length((q-vec2(1.,.45))*vec2(2.2,1.))*2.6)*.3;
    f.rgb*=.7;
  } else {
    bg=mix(vec3(.02,.06,.13),vec3(.09,.27,.42),smoothstep(0.,1.2,q.y+q.x*.3));
    bg+=vec3(.25,.5,.7)*exp(-length(q-vec2(.3,.2))*3.)*.35;
  }
  vec3 c=bg*(1.-f.a*.55)+f.rgb;
  if(m>1.5)c=plateGrade(c,p);
  return vec4(c,1.);
}`;
}

/** Canlı gölgelendirici (uygulamanın çizdiği) */
export const SHADER_BUZ = source(ICE_G_LIVE, SWEEP_LIVE);

/**
 * Döngü biçimi (6 sn'de kendini yineleyen, "bitip yeniden başlamayan" buz). Canlıda buz 14 sn'de büyür, durur,
 * erir ve kısa bir an hiç kalmaz; kısa döngüde bu boş an ve ardından gelen ilk kare "kesme" gibi okunuyordu
 * (kenar bandı G sıfırdan ayrıldığı karede bir anda beliriyor, sıfıra indiği karede bir anda kayboluyordu).
 * Döngü biçiminde:
 * - Kırağı hiç tümüyle kaybolmaz: kalınlığı `floor` ile 1 arasında gidip gelir (G hiç sıfıra inmez).
 * - Büyüme görünümün her yerinde aynı anda olmaz: evre, konuma göre kayar (dekorasyonda ve kartta merkezin
 *   çevresindeki açı, kartta çevrede cardWaves dalga; plakada yükseklik × platePhase). Kalınlaşma bir dalga gibi
 *   çevreyi dolaşır; bir yer
 *   erirken başka bir yer büyür, döngünün hiçbir anı "başlangıç" gibi görünmez.
 * - Bir yerin tek turu: büyüme (yumuşak başlar, yumuşak biter), bekleme, erime; paylar toplamı 1 (boş an yok).
 * sweepAt: ışık süpürmesinin görünümün ortasından geçtiği an.
 */
export const BUZ_LOOP = { grow: 0.45, hold: 0.25, melt: 0.3, floor: 0.3, platePhase: 0.35, cardWaves: 2, sweepAt: 0.53 } as const;

/** Canlıdaki süpürme hızıyla bir döngüye sığan süpürme sayısı (en az 1; 6 sn'de 1) */
const loopSweeps = (period: number): number => Math.max(1, Math.round((0.22 * period) / 1.6));

const smoothstep = (a: number, b: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * Döngü biçiminde bir yerin büyüme eğrisi (gölgelendiricideki iceL ile aynı): 0→1 büyür, durur, 0'a erir;
 * `phase` o yerin evre kayması (döngünün kesri; gölgelendiricide icePh). 2B katmandaki her dendrit kökü bunu
 * kendi evresiyle kullanır; gölgelendiricide kırağının kalınlığı floor + (1 − floor) × bu değerdir.
 */
export function buzLoopG(t: number, period: number, phase = 0): number {
  const u = (((t / period - phase) % 1) + 1) % 1;
  const { grow, hold } = BUZ_LOOP;
  return smoothstep(0, grow, u) * (1 - smoothstep(grow + hold, 1, u));
}

/**
 * Döngü biçimi: zamana bağlı her terim `period` saniyede kendini yineler (u_time = 0 ile u_time = period aynı
 * kare). Büyüme eğrisi her yerde kendi evresiyle tek tur atar; ışık süpürmesi canlıdaki hıza en yakın tam
 * sayıda geçer.
 */
export function buzLoopShader(period: number): string {
  const { grow, hold, floor, platePhase, cardWaves, sweepAt } = BUZ_LOOP;
  const P = glslFloat(period);
  const iceG =
    `float iceL(float u){u=fract(u);return smoothstep(0.,${glslFloat(grow)},u)*(1.-smoothstep(${glslFloat(grow + hold)},1.,u));}\n` +
    `float icePh(vec2 p){vec2 d=p-u_res*.5;return u_mode>1.5&&u_mode<2.5?p.y/u_res.y*${glslFloat(platePhase)}:atan(d.y,d.x)/TAU*(u_mode>.5&&u_mode<1.5?${glslFloat(cardWaves)}:1.);}\n` +
    `float iceG(float t,vec2 p){return ${glslFloat(floor)}+${glslFloat(1 - floor)}*iceL(t/${P}-icePh(p));}`;
  const sweep = `fract((t/${P}-${glslFloat(sweepAt)})*${glslFloat(loopSweeps(period))}+.5)*1.6-.3`;
  return source(iceG, sweep, 'iceG(t,p)');
}

