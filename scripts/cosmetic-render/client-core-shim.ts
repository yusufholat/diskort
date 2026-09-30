// Çizim aracının paketinde '@diskort/client-core' yerine geçer: masaüstünün layers.ts'i client-core'un ana
// girişinden yalnızca kozmetik bilgilerini alır; paketin tamamı (API, depolar, React) araca girmesin. layers.ts
// ileride ana girişten başka bir şey alırsa paketleme "dışa aktarım yok" hatası verir: buraya eklenir.
// ('@diskort/client-core/cosmeticLoops' girişi olduğu gibi kullanılır: render.mjs onu kaynağına yönlendirir.)

export { COSMETIC_SET_INFO } from '../../packages/client-core/src/cosmeticSets';
export * from '../../packages/client-core/src/cosmeticShaders';
