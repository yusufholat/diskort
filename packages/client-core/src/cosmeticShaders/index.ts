// Hareketli kozmetik setlerinin gölgelendiricileri (bkz. common.ts). Bir setin tam parça gölgelendiricisi:
// COSMETIC_SHADER_COMMON + COSMETIC_SHADERS[set] + COSMETIC_SHADER_MAIN (başına hassasiyet satırı).

import type { CosmeticSet } from '@diskort/shared';
import { SHADER_ATESBOCEGI } from './atesbocegi';
import { buzLoopShader, SHADER_BUZ } from './buz';
import { karadelikLoopShader, SHADER_KARADELIK } from './karadelik';
import { kuzeyLoopShader, SHADER_KUZEY } from './kuzey';
import { SHADER_NEON } from './neon';
import { SHADER_SAKURA } from './sakura';

export {
  COSMETIC_SHADER_COMMON,
  COSMETIC_SHADER_MAIN,
  COSMETIC_VERTEX_SHADER,
  cosmeticShaderCommon,
  cosmeticShaderMain,
  SHADER_MODE,
  type CosmeticDither,
  type ShaderViewKind,
} from './common';
export { COSMETIC_LOOP_SECONDS, glslFloat, loopRate } from './loop';
export { BUZ_LOOP, buzLoopG } from './buz';
export { KARADELIK_LOOP } from './karadelik';
export { KUZEY_LOOP } from './kuzey';

/** Her setin `effect(p)` gölgelendiricisi */
export const COSMETIC_SHADERS: Record<CosmeticSet, string> = {
  karadelik: SHADER_KARADELIK,
  sakura: SHADER_SAKURA,
  kuzey: SHADER_KUZEY,
  atesbocegi: SHADER_ATESBOCEGI,
  buz: SHADER_BUZ,
  neon: SHADER_NEON,
};

/**
 * Setlerin döngü biçimleri (bkz. loop.ts): `period` saniyede kendini yineleyen `effect(p)`. Yalnızca dosyaya
 * çizim aracı kullanır; döngü biçimi hazırlanmamış set burada yoktur.
 */
export const COSMETIC_LOOP_SHADERS: Partial<Record<CosmeticSet, (period: number) => string>> = {
  buz: buzLoopShader,
  karadelik: karadelikLoopShader,
  kuzey: kuzeyLoopShader,
};
