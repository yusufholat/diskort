// Kozmetik oynatıcısının hataları sunucuya bildirilir (cihazda denenemeyen yollar: çözücü, video, gölgelendirici).
// Seyrek tutulur: aynı hata oturumda bir kez, oturumda en çok birkaç farklı hata.

import { reportClientError } from '@diskort/client-core';

const errorOf = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/** Aynı anahtarı bir kez, toplamda en çok `max` anahtarı geçiren süzgeç */
export function createReportLimiter(max: number): (key: string) => boolean {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key) || seen.size >= max) return false;
    seen.add(key);
    return true;
  };
}

const allow = createReportLimiter(6);

/** `what`: hatanın yeri (ör. "video", "resim", "yüzey"). Hiçbir durumda fırlatmaz. */
export function reportCosmeticError(what: string, error: unknown): void {
  try {
    const err = errorOf(error);
    if (!allow(`${what}:${err.message}`)) return;
    console.warn(`[kozmetik] ${what}:`, err.message);
    reportClientError(new Error(`${what}: ${err.message}`), 'kozmetik');
  } catch {
    // bildirim hatası: yapılacak bir şey yok
  }
}
