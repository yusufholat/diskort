// Kuzey Işıkları: gürültüyle şekillenen katmanlı aurora perdeleri ve parlayan yıldızlar.
//
// İki biçimi var: canlı (SHADER_KUZEY: uygulamanın çizdiği, değişmedi) ve döngü (cosmeticLoops/kuzey.ts: dosyaya
// çizilen dikişsiz döngü, bkz. ../cosmeticLoops/loop.ts). İkisi aynı kaynaktan kurulur; yalnızca zamana bağlı gürültü terimleri
// değişir (perdenin kenarı, dalgası, ışın çizgileri, parlaklık dalgası; dekorasyonda aynıları halka üstünde).

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

/** Setin kalıbı: döngü biçimi (cosmeticLoops/kuzey.ts) aynı kaynağı kendi parçalarıyla kurar */
export { source as kuzeySource };
