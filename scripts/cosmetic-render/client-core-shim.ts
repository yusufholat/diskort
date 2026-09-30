// Çizim aracının paketinde '@diskort/client-core' yerine geçer: masaüstünün layers.ts'i client-core'dan
// yalnızca kozmetik bilgilerini alır; paketin tamamı (API, depolar, React) araca girmesin. layers.ts ileride
// client-core'dan başka bir şey alırsa paketleme "dışa aktarım yok" hatası verir: buraya eklenir.

export { COSMETIC_SET_INFO } from '../../packages/client-core/src/cosmeticSets';
export * from '../../packages/client-core/src/cosmeticShaders';
