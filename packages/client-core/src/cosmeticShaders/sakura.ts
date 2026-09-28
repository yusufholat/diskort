// Sakura: köşeden süzülen pembe ışık huzmeleri ve pembe bokeh (çiçekler, dal ve yapraklar 2B katmanda).

export const SHADER_SAKURA = `
vec3 bokeh(vec2 p,float t,float cell,float seed,float dens){
  vec2 q=p/cell+vec2(seed,seed*.7)+vec2(t*.03,-t*.05);
  vec2 id=floor(q); vec2 f=fract(q)-.5;
  float r=h21(id+seed);
  vec2 o=(h22(id+seed+1.)-.5)*.45+.06*vec2(sin(t*.5+r*9.),cos(t*.4+r*7.));
  float rad=.14+.16*h21(id+3.3);
  float dd=length(f-o);
  float disc=smoothstep(rad,rad-.035,dd)*(.45+.55*smoothstep(rad*.3,rad,dd));
  float on=step(1.-dens,r)*(.55+.45*sin(t*.6+r*40.));
  // doygun pembe: sönük hâlde de gri disk gibi değil pembe ışık gibi okunsun
  return mix(vec3(1.,.4,.66),vec3(1.,.62,.8),h21(id+5.1))*disc*on;
}
vec4 effect(vec2 p){
  float t=u_time; float m=u_mode;
  if(m>2.5){
    float R=u_a.x; float r=length(p-u_res*.5);
    float halo=exp(-sq((r-R*1.12)/(R*.16)));
    vec3 c=vec3(1.,.62,.78)*halo*(.26+.08*sin(t*1.3))+bokeh(p,t,14.,2.,.35)*.45*smoothstep(R*.95,R*1.1,r);
    return vec4(c,0.);
  }
  vec2 L=vec2(u_res.x*.9,-u_res.y*.12); float sc=max(u_res.x,u_res.y);
  if(m>.5&&m<1.5){L=vec2(u_res.x*.96,-12.);sc=u_a.x*2.6;}
  if(m>1.5){L=vec2(u_res.x*.95,-u_res.y*.6);sc=u_res.x*.6;}
  vec2 dl=p-L; float an=atan(dl.y,dl.x); float dist=length(dl);
  float rays=pow(.5+.5*sin(an*22.+fbm3(vec2(an*5.,t*.12))*7.),3.)*.65+.35*fbm3(vec2(an*11.,t*.09+3.));
  float fall=exp(-dist/(sc*.55));
  vec3 light=vec3(1.,.74,.82)*rays*fall*.5+vec3(1.,.9,.86)*exp(-dist/(sc*.12))*.55;
  vec3 bk=bokeh(p,t,sc*.2,0.,.45)*.35+bokeh(p,t,sc*.11,4.,.4)*.28;
  if(m>.5&&m<1.5){
    float bm=bannerMask(p); float hole=avatarHole(p);
    // bokeh yalnızca afişte; kartın gövdesinde sönük diskler gri görünüyordu
    vec3 c=(light*mix(.3,1.,bm)+bk*bm*1.1)*mix(.3,1.,hole);
    c+=vec3(.9,.42,.6)*.1*smoothstep(u_res.y*.55,u_res.y,p.y);
    // afişe koyu pembe bir tül: afiş hangi renkte olursa olsun ışık ve bokeh pembe okunsun
    return vec4(c+vec3(.2,.03,.1)*bm*hole,bm*.35*hole);
  }
  vec2 uv=p/u_res;
  vec3 bg=mix(vec3(.11,.03,.09),vec3(.55,.2,.34),fall);
  bg=mix(bg,vec3(.95,.66,.72),pow(fall,3.)*.7);
  bg+=vec3(.3,.1,.2)*fbm(p/60.+vec2(t*.05,0.))*.35*(1.-uv.y*.3);
  vec3 c=bg+light*.8+bk;
  if(m>1.5)c=plateGrade(c,p);
  return vec4(c,1.);
}`;
