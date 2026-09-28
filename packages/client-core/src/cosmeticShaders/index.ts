// Hareketli kozmetik setlerinin gölgelendiricileri (bkz. common.ts). Bir setin tam parça gölgelendiricisi:
// COSMETIC_SHADER_COMMON + COSMETIC_SHADERS[set] + COSMETIC_SHADER_MAIN (başına hassasiyet satırı).

import type { CosmeticSet } from '@diskort/shared';
import { SHADER_ATESBOCEGI } from './atesbocegi';
import { SHADER_BUZ } from './buz';
import { SHADER_KARADELIK } from './karadelik';
import { SHADER_KUZEY } from './kuzey';
import { SHADER_NEON } from './neon';
import { SHADER_SAKURA } from './sakura';

export {
  COSMETIC_SHADER_COMMON,
  COSMETIC_SHADER_MAIN,
  COSMETIC_VERTEX_SHADER,
  SHADER_MODE,
  type ShaderViewKind,
} from './common';

/** Her setin `effect(p)` gölgelendiricisi */
export const COSMETIC_SHADERS: Record<CosmeticSet, string> = {
  karadelik: SHADER_KARADELIK,
  sakura: SHADER_SAKURA,
  kuzey: SHADER_KUZEY,
  atesbocegi: SHADER_ATESBOCEGI,
  buz: SHADER_BUZ,
  neon: SHADER_NEON,
};
