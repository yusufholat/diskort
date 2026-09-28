// Neon Yağmur: titreşen tabelalar, ıslak zeminde yansıma, yağmur çizgileri ve su halkaları.

export const SHADER_NEON = `
vec3 signs(vec2 uv,float t){
  vec3 c=vec3(0.);
  for(int i=0;i<4;i++){
    float fi=float(i);
    vec2 cen=vec2(.14+fi*.24+.05*sin(fi*3.),.24+.18*h21(vec2(fi,2.)));
    vec2 sz=vec2(.07+.05*h21(vec2(fi,5.)),.03+.02*h21(vec2(fi,6.)));
    vec2 dd=abs(uv-cen)-sz; float sd=length(max(dd,0.))+min(max(dd.x,dd.y),0.);
    vec3 col=i==0?vec3(1.,.17,.72):(i==1?vec3(.1,.85,1.):(i==2?vec3(1.,.55,.15):vec3(.65,.3,1.)));
    float fl=.72+.28*step(.07,h21(vec2(floor(t*13.),fi)));
    c+=col*(exp(-max(sd,0.)*30.)*.85+exp(-max(sd,0.)*6.)*.22)*fl;
  }
  return c;
}
float rainL(vec2 p,float t,float cw,float per,float spd,float seed){
  vec2 q=vec2(p.x/cw+p.y/cw*.2,p.y/per);
  float col=floor(q.x); float fx=fract(q.x)-.5;
  float r=h21(vec2(col,seed)); float r2=h21(vec2(col,seed+7.));
  float fy=fract(q.y-t*spd*(.75+.5*r)+r2*10.);
  float len=.28;
  float s=step(fy,len)*fy/len;
  return s*s*exp(-sq(fx/.07))*step(.45,r);
}
float ripples(vec2 g,float t){
  vec2 id=floor(g); vec2 f=fract(g);
  float r=h21(id); vec2 o=.25+.5*h22(id+3.);
  float ph=fract(t*.7+r); float d=length(f-o);
  return exp(-sq((d-ph*.42)/.02))*sq(1.-ph);
}
vec3 rain(vec2 p,float t){return vec3(.75,.85,1.)*(rainL(p,t,9.,70.,1.4,1.)*.35+rainL(p,t,14.,110.,1.9,5.)*.55);}
vec4 effect(vec2 p){
  float t=u_time; float m=u_mode;
  if(m>2.5){
    float R=u_a.x; vec2 d=p-u_res*.5; float r=length(d); float an=atan(d.y,d.x);
    vec3 cA=mix(vec3(1.,.15,.7),vec3(.1,.85,1.),.5+.5*sin(an+t*.8));
    vec3 cB=mix(vec3(.1,.85,1.),vec3(.7,.3,1.),.5+.5*sin(an*2.-t*.6));
    float fl=1.-.55*step(.94,h21(vec2(floor(t*9.),1.)));
    float r1=R*1.08, r2=R*1.22;
    float dash=smoothstep(.0,.04,fract(an/TAU*8.+t*.04))*smoothstep(.72,.66,fract(an/TAU*8.+t*.04));
    vec3 c=(cA*exp(-abs(r-r1)/4.)*.55+mix(cA,vec3(1.),.65)*exp(-sq((r-r1)/1.))*.95)*fl;
    c+=(cB*exp(-abs(r-r2)/3.)*.4+mix(cB,vec3(1.),.6)*exp(-sq((r-r2)/.8))*.8)*dash;
    return vec4(c,0.);
  }
  if(m<.5){
    vec2 uv=p/u_res; float hy=.64;
    vec3 c=mix(vec3(.02,.01,.05),vec3(.06,.02,.1),uv.y)+signs(uv,t);
    if(uv.y>hy){
      float dz=(uv.y-hy)/(1.-hy); float depth=1./(dz+.06);
      vec2 g=vec2((uv.x-.5)*depth*1.6,depth*.7)*2.4;
      float rp=ripples(g,t);
      vec2 uvR=vec2(uv.x+rp*.02+.004*sin(p.y*.8+t*3.),2.*hy-uv.y);
      vec3 rf=signs(uvR,t);
      c=vec3(.012,.008,.02)+rf*.5*(.4+.6*dz)+vec3(.6,.8,1.)*rp*.35*(luma(rf)+.25);
    }
    c+=rain(p,t);
    return vec4(c,1.);
  }
  if(m>1.5){
    vec3 c=mix(vec3(.03,.01,.06),vec3(.08,.02,.12),p.x/u_res.x);
    float ty=u_res.y*.8; float xs=smoothstep(u_res.x*.35,u_res.x*.6,p.x);
    float dt=abs(p.y-ty);
    vec3 tc=mix(vec3(1.,.15,.7),vec3(.1,.85,1.),.5+.5*sin(p.x*.02-t*1.5));
    float fl=.8+.2*step(.1,h21(vec2(floor(t*12.),4.)));
    c+=(tc*exp(-dt/5.)*.55+mix(tc,vec3(1.),.6)*exp(-sq(dt/.9)))*xs*fl;
    c+=signs(vec2(p.x/u_res.x*.8+.2,p.y/u_res.y*.3),t)*.55;
    c+=rain(p,t)*.6;
    return vec4(plateGrade(c,p),1.);
  }
  float bm=bannerMask(p); float hole=avatarHole(p);
  vec3 c=signs(vec2(p.x/u_res.x,p.y/u_a.x*.9+.04),t)*bm*.9;
  c+=rain(p,t)*mix(.4,1.,bm);
  float bz=smoothstep(u_res.y-46.,u_res.y,p.y);
  float rp=ripples(vec2(p.x/34.,(p.y-u_res.y+46.)/12.),t)*bz;
  c+=vec3(1.,.25,.75)*bz*.1+vec3(.7,.9,1.)*rp*.4;
  return vec4(c*mix(.3,1.,hole),bm*.35*hole);
}`;
