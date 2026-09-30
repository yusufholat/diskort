// Hareketli kozmetik setlerinin DÖNGÜ biçimleri: dosyaya çizilen, `period` saniyede kendini yineleyen dikişsiz
// döngüler (bkz. loop.ts). Ayrı giriş: @diskort/client-core/cosmeticLoops. Yalnızca çizim aracı
// (scripts/cosmetic-render) ve masaüstünün 2B katmanındaki döngü dalları kullanır.
//
// client-core'un ana girişi (src/index.ts) ve cosmeticShaders buraya UZANMAZ: telefonun paketleyicisi
// kullanılmayan kodu ayıklamaz, ana girişten erişilen her şey telefona gider (test: cosmeticLoop.entry.test.ts).
// Uygulamanın çizdiği canlı biçimler cosmeticShaders'ta; buradaki dosyalar onların kalıbını kendi parçalarıyla kurar.

import type { CosmeticSet } from '@diskort/shared';
import { atesbocegiLoopShader } from './atesbocegi';
import { buzLoopShader } from './buz';
import { karadelikLoopShader } from './karadelik';
import { kuzeyLoopShader } from './kuzey';
import { neonLoopShader } from './neon';
import { sakuraLoopShader } from './sakura';

export { COSMETIC_LOOP_SECONDS, glslFloat, loopRate } from './loop';
export { loopDriftGlsl, loopPhase, loopTrackPhase, loopWindow } from './loopMotion';
export { cosmeticShaderCommon } from './common';
// Giriş noktasının gürültü seçenekleri (dosyaya çizimde sabit gürültü); kalıp canlı girişle ortak
export { cosmeticShaderMain, type CosmeticDither } from '../cosmeticShaders/common';
export { BUZ_LOOP, buzLoopG, buzLoopShader } from './buz';
export { KARADELIK_LOOP, karadelikLoopShader } from './karadelik';
export { KUZEY_LOOP, kuzeyLoopShader } from './kuzey';
export { neonLoopShader, type NeonLoopOptions } from './neon';
export { SAKURA_LOOP, sakuraLoopBloom, sakuraLoopShader, sakuraLoopShed } from './sakura';
export { ATESBOCEGI_LOOP, atesbocegiLoopBlink, atesbocegiLoopBlinks, atesbocegiLoopShader } from './atesbocegi';

/**
 * Setlerin döngü biçimleri: `period` saniyede kendini yineleyen `effect(p)`. Döngü biçimi hazırlanmamış set
 * burada yoktur (çizim aracı onu atlar).
 */
export const COSMETIC_LOOP_SHADERS: Partial<Record<CosmeticSet, (period: number) => string>> = {
  buz: buzLoopShader,
  neon: neonLoopShader,
  karadelik: karadelikLoopShader,
  kuzey: kuzeyLoopShader,
  sakura: sakuraLoopShader,
  atesbocegi: atesbocegiLoopShader,
};
