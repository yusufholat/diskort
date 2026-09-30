// Kristal Buz: döngü biçimi (dosyaya çizilen dikişsiz döngü; bkz. loop.ts). Canlı kalıp ve uygulamanın çizdiği
// gölgelendirici cosmeticShaders/buz.ts'te; bu dosya yalnızca çizim aracı ve masaüstü 2B katmanı içindir:
// client-core'un ana girişi buraya uzanmaz (telefon paketine girmez).

import { glslFloat } from './loop';
import { buzSource as source } from '../cosmeticShaders/buz';

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
