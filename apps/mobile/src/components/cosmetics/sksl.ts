// Hareketli kozmetik gölgelendiricilerini (masaüstünün WebGL 1 / GLSL ES 1.00 kaynakları,
// @diskort/client-core cosmeticShaders) telefonda Skia'nın SkSL'ine çevirir. Kaynaklar olduğu gibi kullanılır:
// masaüstünde bir set ya da isim plakası değişince telefon da kendiliğinden aynı formülü çizer.
// Bu dosya React Native'e bağlı değildir (birim testleri Node'da CanvasKit ile derler).

import type { CosmeticSet } from '@diskort/shared';
import { COSMETIC_SHADER_COMMON, COSMETIC_SHADER_MAIN, COSMETIC_SHADERS } from '@diskort/client-core';

export interface SkslOptions {
  /**
   * fbm() gürültüsünün katman sayısı (kaynakta 5). Telefonda ağır görünümler (Karadelik kartı) için 4:
   * fark gözle seçilmez, piksel başına iş belirgin azalır. Verilmezse kaynaktaki gibi.
   */
  fbmOctaves?: number;
}

/** GLSL tür adlarının SkSL karşılıkları */
const TYPES: [RegExp, string][] = [
  [/\bvec([234])\b/g, 'float$1'],
  [/\bivec([234])\b/g, 'int$1'],
  [/\bbvec([234])\b/g, 'bool$1'],
  [/\bmat([234])\b/g, 'float$1x$1'],
];

/** Yorumları siler (SkSL yorumları bilir ama Türkçe karakterler ve satır sonu yorumları gereksiz yük) */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * `#define AD değer` satırlarını kaldırır, adı kaynağın geri kalanında değerle değiştirir (SkSL'de
 * önişlemci yok). Yalnızca parametresiz tanımlar kullanılıyor.
 */
function expandDefines(src: string): string {
  const defs: [string, string][] = [];
  const body = src.replace(/^[ \t]*#define[ \t]+([A-Za-z_]\w*)[ \t]+([^\n]+)$/gm, (_m, name: string, value: string) => {
    defs.push([name, value.trim()]);
    return '';
  });
  let out = body;
  for (const [name, value] of defs) out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), `(${value})`);
  return out;
}

/**
 * fbm'in katman sayısını değiştirir. Kaynaktaki biçim: `float fbm(vec2 p){...for(int i=0;i<5;i++)...return s/.97;}`
 * (son bölen, katmanların genliklerinin toplamıdır: 0.5+0.25+...). Biçim değişmişse dokunulmaz.
 */
function setFbmOctaves(src: string, octaves: number): string {
  return src.replace(/(float fbm\(vec2 p\)\{[^}]*?for\(int i=0;i<)(\d+)(;i\+\+\)\{[^}]*\}return s\/)([\d.]+)(;\})/, (_m, a: string, _n, b: string, _d, c: string) => {
    const n = Math.max(1, Math.min(8, Math.round(octaves)));
    const norm = 1 - Math.pow(0.5, n);
    return `${a}${n}${b}${String(norm)}${c}`;
  });
}

/**
 * Giriş noktası: GL'in `void main()`'i Skia'nın `half4 main(float2)`'sine çevrilir. Skia'nın verdiği koordinat
 * görünümün sol üstünden (çizim ölçeğinden önce, css pikseli); kaynağın beklediği GL koordinatı
 * (sol alt, u_k ölçekli, u_off kaydırmalı) buradan üretilir, böylece MAIN'in kendi hesabı olduğu gibi kalır.
 */
function translateMain(main: string): string {
  return main
    .replace(/void\s+main\s*\(\s*\)\s*\{/, 'half4 main(float2 sk_xy){\n  vec4 sk_glFragCoord=vec4(sk_xy.x*u_k+u_off.x,(u_res.y-sk_xy.y)*u_k+u_off.y,0.,1.);')
    .replace(/\bgl_FragCoord\b/g, 'sk_glFragCoord')
    .replace(/\bgl_FragColor\s*=\s*([^;]+);/g, 'return half4($1);');
}

/** GLSL ES 1.00 parçasını SkSL'e çevirir (tür adları, önişlemci, hassasiyet satırları) */
export function glslToSksl(src: string): string {
  let out = stripComments(src);
  out = out.replace(/^[ \t]*precision[^;\n]*;[ \t]*$/gm, '');
  out = expandDefines(out);
  for (const [re, to] of TYPES) out = out.replace(re, to);
  return out;
}

/** Bir setin tam SkSL kaynağı (ortak kısım + setin effect()'i + giriş noktası) */
export function cosmeticSksl(set: CosmeticSet, options: SkslOptions = {}): string {
  let common = COSMETIC_SHADER_COMMON;
  if (options.fbmOctaves !== undefined) common = setFbmOctaves(common, options.fbmOctaves);
  return glslToSksl(`${common}\n${COSMETIC_SHADERS[set]}\n${translateMain(COSMETIC_SHADER_MAIN)}`);
}

/** Gölgelendiricinin tekdüze değişkenleri; Skia'ya bildirim sırasıyla (kaynaktaki uniform satırları) verilir */
export interface CosmeticUniforms {
  u_off: readonly [number, number];
  u_res: readonly [number, number];
  u_k: number;
  u_time: number;
  u_mode: number;
  u_a: readonly [number, number, number, number];
}

/**
 * Kaynaktaki uniform bildirimlerinin sırası ve boyutları (ör. [['u_off', 2], ['u_res', 2], ...]).
 * Skia'nın makeShader'ı düz sayı dizisi ister; dizi bu sıraya göre kurulur.
 */
export function uniformLayout(sksl: string): [keyof CosmeticUniforms, number][] {
  const out: [keyof CosmeticUniforms, number][] = [];
  const re = /\buniform\s+(float[234]?)\s+(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sksl))) {
    const size = m[1] === 'float' ? 1 : Number(m[1]!.slice(5));
    out.push([m[2] as keyof CosmeticUniforms, size]);
  }
  return out;
}

/** Tekdüze değerleri düz diziye yazar (dizi yeniden kullanılır: karede bir ayırma yok) */
export function packUniforms(layout: [keyof CosmeticUniforms, number][], u: CosmeticUniforms, into: number[] = []): number[] {
  into.length = 0;
  for (const [name, size] of layout) {
    const v = u[name];
    if (typeof v === 'number') into.push(v);
    else for (let i = 0; i < size; i++) into.push(v[i] ?? 0);
  }
  return into;
}
