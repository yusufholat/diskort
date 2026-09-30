// Ateşböceği Ormanı: döngü biçimi (dosyaya çizilen dikişsiz döngü; bkz. loop.ts). Canlı kalıp ve uygulamanın çizdiği
// gölgelendirici cosmeticShaders/atesbocegi.ts'te; bu dosya yalnızca çizim aracı ve masaüstü 2B katmanı içindir:
// client-core'un ana girişi buraya uzanmaz (telefon paketine girmez).

import { glslFloat, loopRate } from './loop';
import { loopDriftGlsl } from './loopMotion';
import { atesbocegiSource as source } from '../cosmeticShaders/atesbocegi';

/**
 * Döngü biçiminde bakış noktasının salınımı: canlıda ağaç katmanları saniyede .004·(katman+1) birim kayar
 * (hiç yinelenmez). Keskin silüetler çapraz geçirilemez (hayalet ağaçlar çıkar); bunun yerine katmanlar aynı
 * evreyle sağa sola salınır: bakan hafifçe yer değiştiriyormuş gibi derinlik okunur. swaySpeed: salınımın en
 * büyük hızı, canlıdaki kayma hızının katı olarak.
 */
export const ATESBOCEGI_LOOP = { swaySpeed: 1.5 } as const;

/**
 * Döngü biçimi: zamana bağlı her terim `period` saniyede kendini yineler (u_time = 0 ile u_time = period aynı
 * kare). Sisler canlıdaki hızlarıyla süzülür (kaydırmalı kopyalar, bkz. loopMotion.ts); ağaç katmanları
 * kaymak yerine salınır; halkanın nabzı döngüye sığan en yakın hıza yuvarlanır. Kartta sis ormanın dibinde
 * (afişin hemen altında) toplanır ve afiş yüksekliğinin 3.4 katına varmadan dağılır: standart kart tuvalinde efekt
 * üste yaslanır, alt kenara bir şey bağlanmaz.
 */
export function atesbocegiLoopShader(period: number): string {
  const w = (Math.PI * 2) / period;
  const sway = (0.004 * ATESBOCEGI_LOOP.swaySpeed) / w;
  return source({
    pre: loopDriftGlsl('ffDrift', 'fbm3', period, 4),
    parallax: `${glslFloat(sway)}*(fi+1.)*sin(t*${glslFloat(w)})`,
    layerFog: 'ffDrift(vec2(x*2.2,uv.y*4.+fi*3.),vec2(-.03*(fi+1.),0.),t)',
    decoMist: 'ffDrift(dir*2.+h*1.5,vec2(.1,0.),t)',
    decoPulse: `sin(t*${glslFloat(loopRate(1.7, period))})`,
    cardFog: 'ffDrift(vec2(p.x/90.,p.y/40.),vec2(-.05,.02),t)',
    cardFogBand: 'smoothstep(bh*.8,bh*1.4,p.y)*smoothstep(bh*3.4,bh*1.6,p.y)',
  });
}

// ---------- Döngü biçiminin 2B katmanı (masaüstü layers.ts) için eğriler ----------

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Bir raydaki (bkz. loopMotion.ts loopTrackPhase) ateşböceklerinin tur başına yanıp sönme sayısı seçenekleri.
 * Canlıda böcekler 3-9 saniyede bir yanar; ray `span` döngü sürdüğüne göre turda span·period/9 ile
 * span·period/3 arası yanış olmalı. Raydaki `span` böcek aynı anda yanmasın diye sayı `span` ile aralarında
 * asal seçilir (böcekler arasındaki evre farkı tam tur olmaz). Hiç aday yoksa en yakın sayı döner.
 */
export function atesbocegiLoopBlinks(span: number, period: number): number[] {
  const lo = Math.max(1, Math.ceil((span * period) / 9));
  const hi = Math.max(lo, Math.floor((span * period) / 3));
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) if (gcd(n, span) === 1) out.push(n);
  if (out.length === 0) for (let n = lo; out.length === 0; n++) if (gcd(n, span) === 1) out.push(n);
  return out;
}

/** Rayın `u` yerindeki böceğin parlaklığı (canlıdaki eğri: kısa parlama, arada sönük ama görünür) */
export function atesbocegiLoopBlink(u: number, blinks: number, phase: number): number {
  return Math.pow(Math.max(0, Math.sin(Math.PI * 2 * blinks * u + phase)), 4) * 0.85 + 0.15;
}
