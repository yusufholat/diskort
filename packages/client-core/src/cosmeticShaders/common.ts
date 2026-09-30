// Hareketli kozmetik setlerinin gölgelendiricileri: ortak kısım. Masaüstü WebGL 1 (GLSL ES 1.00) ile
// çizer; telefon aynı kaynakları Skia'nın SkSL'ine çevirir (apps/mobile cosmetics/sksl.ts). Bu yüzden: doku, türev
// (dFdx/fwidth), eklenti yok; döngü sınırları sabit. Her setin gölgelendiricisi `vec4 effect(vec2 p)`
// tanımlar (p: görünümün sol üstünden css pikseli; dönen renk önceden alfayla çarpılmış sayılır).

/** Görünümün türü (u_mode): küçük resim, profil kartı, isim plakası, avatar dekorasyonu */
export const SHADER_MODE = { thumb: 0, card: 1, plate: 2, deco: 3 } as const;
export type ShaderViewKind = keyof typeof SHADER_MODE;

/** Tek üçgenle tüm görünümü kaplayan köşe gölgelendiricisi */
export const COSMETIC_VERTEX_SHADER = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

/**
 * Ortak tekdüze değişkenler ve yardımcılar. u_a: kartta (afiş yüksekliği, avatar merkezi x, y, avatarın
 * dış yarıçapı); dekorasyonda (avatar yarıçapı, 0, 0, 0).
 */
export const COSMETIC_SHADER_COMMON = `
uniform vec2 u_off;   // görünümün çizim yüzeyindeki yeri (GL pikseli, sol alt; birden çok görünüm tek yüzeye çizilirken)
uniform vec2 u_res;   // görünüm boyutu (css px)
uniform float u_k;    // css px başına GL pikseli
uniform float u_time;
uniform float u_mode; // 0 küçük resim, 1 kart, 2 plaka, 3 dekorasyon
uniform vec4 u_a;     // kart: (afiş yüksekliği, avatar x, avatar y, avatar dış yarıçapı); dekor: (avatar yarıçapı)
#define PI 3.14159265
#define TAU 6.2831853
float sq(float x){return x*x;}
float h21(vec2 p){p=fract(p*vec2(233.34,851.73));p+=dot(p,p+23.45);return fract(p.x*p.y);}
vec2 h22(vec2 p){float n=h21(p);return vec2(n,h21(p+n+17.1));}
float vn(vec2 p){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1.,0.)),u.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vn(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=.5;}return s/.97;}
float fbm3(vec2 p){float s=0.,a=.5;for(int i=0;i<3;i++){s+=a*vn(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=.5;}return s/.875;}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}
vec3 starLayer(vec2 p,float cell,float dens,float t,float seed){
  vec2 q=p/cell+seed;vec2 id=floor(q);vec2 f=fract(q);
  float r=h21(id+seed);vec2 o=.2+.6*h22(id+seed*1.3);
  float d=length((f-o)*cell);
  float m=pow(h21(id+seed+4.2),4.);
  float sz=.55+1.3*m;
  float tw=.6+.4*sin(t*(.8+2.6*h21(id+9.1))+r*50.);
  float s=exp(-d*d/(sz*sz))*step(1.-dens,r)*(.35+1.3*m)*tw;
  return mix(vec3(1.,.83,.68),vec3(.72,.84,1.),h21(id+2.7))*s;
}
vec3 stars(vec2 p,float t){return starLayer(p,11.,.3,t,0.)+starLayer(p,23.,.4,t,7.3)*1.25;}
float avatarHole(vec2 p){return smoothstep(u_a.w+1.,u_a.w+7.,length(p-u_a.yz));}
float bannerMask(vec2 p){return smoothstep(u_a.x+1.,u_a.x-26.,p.y);}
// İsim plakası: avatar, ad ve durumun durduğu sol taraf sakin ve koyu, sahne sağda. Solda ~%30'a kadar
// parlaklığın beşte biri kalır, ~%74'te tam olur. Üstüne 2B katmanlardan sonra setin koyu renginde soldan
// sağa açılan bir perde çizilir (masaüstünde layers.ts drawPlateScrim; telefon da aynısını yapmalı)
float plateFade(vec2 p){return mix(.2,1.,smoothstep(u_res.x*.26,u_res.x*.74,p.x));}
// Plakanın ortak renk ayarı: biraz doygunluk düşer, en parlak kanal yumuşakça sınırlanır (sınır sağa doğru
// artar: en parlak noktalar yazıların altında değil en sağda), sonra soldan sağa açılan solma
vec3 plateGrade(vec3 c,vec2 p){
  float x=p.x/u_res.x;
  c=mix(vec3(luma(c)),c,.84);
  float cap=mix(.32,.9,smoothstep(.3,.95,x));
  float m=max(max(c.r,c.g),c.b);
  c*=cap*(1.-exp(-m/cap))/max(m,1e-4);
  return c*plateFade(p);
}
`;

/** Giriş noktası: GL koordinatını css pikseline çevirir, dekorasyonun kare kenarını gizler, bantlaşmayı kırar */
export const COSMETIC_SHADER_MAIN = `
void main(){
  vec2 fc=gl_FragCoord.xy-u_off;
  vec2 p=vec2(fc.x,u_res.y*u_k-fc.y)/u_k;
  vec4 c=effect(p);
  if(u_mode>2.5)c*=smoothstep(u_res.x*.5,u_res.x*.43,length(p-u_res*.5)); // dekorasyon: kare kenarını hiç gösterme
  c.rgb=clamp(c.rgb+(h21(fc+fract(u_time))-.5)/255.,0.,1.);
  c.a=clamp(max(c.a,max(c.r,max(c.g,c.b))),0.,1.);
  gl_FragColor=c;
}`;
