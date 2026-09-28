/**
 * Adres parçalarını güvenle çözme. `decodeURIComponent` bozuk bir kaçış dizisinde (ör. `%zz`, yarım
 * UTF-8) URIError fırlatır; sunucu bağlantıları olduğu gibi geçirdiğinden bu, arayüzü çökertmemeli.
 */

/** Kodlanmış metni çözer; çözülemezse metnin kendisini döndürür (hiç fırlatmaz). */
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Adresin/dosya yolunun son parçası çözülmüş olarak (sorgu ve çapa olmadan; yoksa boş metin) */
export function lastPathSegment(url: string): string {
  return safeDecodeURIComponent(url.split(/[?#]/)[0]!.split('/').pop() ?? '');
}
