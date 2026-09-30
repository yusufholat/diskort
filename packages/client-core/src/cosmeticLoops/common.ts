// Ortak kısmın döngü biçimi (bkz. loop.ts). Canlı metin cosmeticShaders/common.ts'te; bu dosyayı uygulama
// paketleri yüklemez.

import { COSMETIC_SHADER_COMMON } from '../cosmeticShaders/common';
import { glslFloat } from './loop';

/** Canlıda yıldız parıltısı: her yıldızın hızı rastgele (saniyede .8–3.4 radyan), döngüye sığmaz */
const STAR_TWINKLE_LIVE = 'sin(t*(.8+2.6*h21(id+9.1))+r*50.)';

/**
 * Ortak kısmın döngü biçimi (bkz. loop.ts; yalnızca dosyaya çizim aracı kullanır): starLayer'daki parıltının
 * hızı, her yıldız için döngüye tam sayıda sığan en yakın hıza yuvarlanır (en az bir tur); yıldızların yeri,
 * parlaklığı ve rengi canlıyla aynıdır. Gerisi COSMETIC_SHADER_COMMON ile harfi harfine aynı: canlı metin
 * değişmez, döngü biçimi ondan türetilir.
 */
export function cosmeticShaderCommon(period: number): string {
  if (!(period > 0)) throw new Error(`döngü süresi pozitif olmalı: ${period}`);
  if (!COSMETIC_SHADER_COMMON.includes(STAR_TWINKLE_LIVE)) throw new Error('starLayer parıltı terimi bulunamadı (common.ts değişmiş)');
  const tau = Math.PI * 2;
  const turns = `max(1.,floor((.8+2.6*h21(id+9.1))*${glslFloat(period / tau)}+.5))`;
  return COSMETIC_SHADER_COMMON.replace(STAR_TWINKLE_LIVE, `sin(t*${turns}*${glslFloat(tau / period)}+r*50.)`);
}
