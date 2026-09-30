// Ateşböceği Ormanı: katmanlı çam silüetleri, ay ışığı ve süzülen sis (ateşböcekleri 2B katmanda).
//
// İki biçimi var: canlı (SHADER_ATESBOCEGI: uygulamanın çizdiği, değişmedi) ve döngü (cosmeticLoops/atesbocegi.ts:
// dosyaya çizilen dikişsiz döngü, bkz. ../cosmeticLoops/loop.ts). İkisi aynı kaynaktan kurulur; yalnızca zamana bağlı terimler
// (ve kartta sisin alt kenara bağlı sınırı) değişir.

interface Parts {
  /** Setin kendi yardımcıları (döngü biçiminde süzülen gürültü) */
  pre: string;
  /** Ağaç katmanının yatay kayması (fi: katman, 0 en uzak) */
  parallax: string;
  /** Katmanların arasındaki sis */
  layerFog: string;
  /** Dekorasyon: halkanın nabzı ve avatarın çevresindeki sis */
  decoMist: string;
  decoPulse: string;
  /** Kartın gövdesindeki sis ve yoğunluğunun yukarıdan aşağıya dağılımı (0-1) */
  cardFog: string;
  cardFogBand: string;
}

function source(s: Parts): string {
  return `
${s.pre}// Çam silüeti: her hücrede bir ağaç; genişlik yükseldikçe daralır, testere dişi kademeler dal katlarını verir
float pines(vec2 uv,float base,float amp,float dens,float seed,out float line){
  float ridge=base-amp*.3*fbm3(vec2(uv.x*.7+seed,seed*1.3));
  line=ridge;
  float cov=smoothstep(ridge-.004,ridge+.004,uv.y);
  float k=uv.x*dens; float id=floor(k); float f=fract(k);
  for(int j=-1;j<=1;j++){
    float cid=id+float(j);
    float hh=amp*(.55+.45*h21(vec2(cid,seed)));
    float cx=float(j)+.5+(h21(vec2(cid,seed+3.))-.5)*.7;
    float dx=abs(f-cx)/dens;
    float up=(ridge+.01-uv.y)/hh;
    float w=hh*.2*(1.-up)*(.68+.32*fract(up*6.5+h21(vec2(cid,seed+9.))));
    float inT=step(0.,up)*step(up,1.)*smoothstep(w+.004,w-.004,dx);
    cov=max(cov,inT);
  }
  return cov;
}
vec4 forest(vec2 uv,float t,float asp,bool sky){
  vec3 c=vec3(0.); float a=0.;
  if(sky){
    c=mix(vec3(.015,.035,.05),vec3(.04,.11,.12),uv.y);
    vec2 mp=vec2(asp*.78,.2); float md=length(uv-mp);
    c+=vec3(.5,.62,.55)*exp(-md*6.)*.35+vec3(.92,.96,.86)*smoothstep(.045,.038,md)*.85;
    a=1.;
  }
  for(int i=0;i<4;i++){
    float fi=float(i);
    float x=uv.x+${s.parallax};
    float line;
    float cov=pines(vec2(x,uv.y),.66+fi*.1,.3+fi*.07,6.5-fi*1.3,fi*7.3,line);
    vec3 lc=mix(vec3(.05,.12,.125),vec3(.003,.009,.01),pow(fi/3.,.7));
    c=mix(c,lc,cov); a=max(a,cov);
    float fog=${s.layerFog};
    float fb=smoothstep(.5,1.,fog)*smoothstep(line-.25,line+.05,uv.y)*(1.-fi*.2);
    c+=vec3(.2,.34,.32)*fb*.24;
  }
  return vec4(c,a);
}
vec4 effect(vec2 p){
  float t=u_time; float m=u_mode;
  if(m>2.5){
    float R=u_a.x; vec2 d=p-u_res*.5; float r=length(d); vec2 dir=d/max(r,.001);
    float h=(r-R)/(u_res.x*.5-R);
    float w=${s.decoMist};
    vec3 c=vec3(.6,.88,.35)*exp(-sq((r-R*1.06)/(R*.1)))*(.22+.1*${s.decoPulse});
    c+=vec3(.3,.5,.4)*smoothstep(.45,.8,w)*smoothstep(1.,.2,h)*smoothstep(0.,.12,h)*.4;
    return vec4(c,0.);
  }
  if(m<.5){ vec4 f=forest(p/u_res.y,t,u_res.x/u_res.y,true); return vec4(f.rgb,1.); }
  if(m>1.5){ vec4 f=forest(vec2(p.x/u_res.y*.5,p.y/u_res.y*.9+.08),t,u_res.x/u_res.y*.5,true); return vec4(plateGrade(f.rgb,p),1.); }
  float bh=u_a.x; float hole=avatarHole(p);
  vec2 q=vec2(p.x,p.y+bh*.06)/(bh*1.12);
  vec4 f=forest(q,t,u_res.x/bh,false);
  float mk=smoothstep(bh+2.,bh-10.,p.y)*hole;
  // afişte ay ışığıyla aydınlanan gökyüzü: ağaçlar karanlığa gömülmesin
  vec2 mp=vec2(u_res.x/(bh*1.12)*.8,.24); float md=length(q-mp);
  vec3 sky=mix(vec3(.02,.07,.08),vec3(.07,.18,.17),q.y)+vec3(.5,.62,.55)*exp(-md*5.)*.4+vec3(.92,.96,.86)*smoothstep(.05,.042,md)*.8;
  vec3 c=mix(sky*.5,f.rgb*1.4,f.a)*mk; float a=max(f.a*.92,.5)*mk;
  float fog=${s.cardFog};
  float fb=smoothstep(.55,1.,fog)*${s.cardFogBand}*.3;
  c+=vec3(.25,.4,.36)*fb*hole;
  return vec4(c,a);
}`;
}

/** Canlı gölgelendirici (uygulamanın çizdiği): ağaç katmanları durmadan kayar, sis zamanı koordinat olarak kullanır */
export const SHADER_ATESBOCEGI = source({
  pre: '',
  parallax: 't*.004*(fi+1.)',
  layerFog: 'fbm3(vec2(x*2.2-t*.03*(fi+1.),uv.y*4.+fi*3.))',
  decoMist: 'fbm3(dir*2.+vec2(t*.1,0.)+h*1.5)',
  decoPulse: 'sin(t*1.7)',
  cardFog: 'fbm3(vec2(p.x/90.-t*.05,p.y/40.+t*.02))',
  // sis kartın alt kenarına doğru yoğunlaşır
  cardFogBand: 'smoothstep(bh*.8,u_res.y,p.y)',
});

/** Setin kalıbı: döngü biçimi (cosmeticLoops/atesbocegi.ts) aynı kaynağı kendi parçalarıyla kurar */
export { source as atesbocegiSource };
