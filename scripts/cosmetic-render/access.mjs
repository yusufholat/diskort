// AVIF sırasız çözme kararı (verify.html accessItem'ın sonucu; render.mjs kullanır).
//
// Atlayarak, başa dönerek ve ortadan başlayarak çözülen kareler sırayla çözülenlerden belirgin biçimde
// uzaklaşmamalı ve hepsi çözülebilmeli. Taban sıralı çözmenin en kötü karesi (ffmpeg ile Chromium'un çözümü
// arasındaki olağan yuvarlama farkı); renk aralığının karışması 8-14 birim ekliyordu. Sıralı çözmenin kendisi
// de ffmpeg'e mutlak bir sınır içinde yakın olmalı (yoksa taban kendisi bozuk: boş ya da yanlış çözüm).

/** Sıralı çözmeye göre izin verilen ek fark (0-255, renk ve alfa) */
export const ACCESS_TOLERANCE = 2;
/** Sıralı çözmenin ffmpeg'e göre en kötü karesinde izin verilen renk farkı (gözlenen en kötü ~4) */
export const ACCESS_MAX_COLOR = 8;
/** Sıralı çözmenin ffmpeg'e göre en kötü karesinde izin verilen alfa farkı (alfa akışı tam aralık, aynı çözüm) */
export const ACCESS_MAX_ALPHA = 3;
/** Bilgi için ölçülen, dosyayı düşürmeyen çözücü hatası (bkz. verify.html coldNext) */
const INFO_ERRORS = new Set(['coldNext']);

/** @returns {{ ok: boolean, text: string }} */
export function accessVerdict(access) {
  if (!access || access.error) return { ok: false, text: `ÖLÇÜLEMEDİ: ${access?.error ?? 'sonuç yok'}` };
  const S = access.summary ?? {};
  const base = S.inOrder;
  if (!base || base.frames === 0) return { ok: false, text: 'ÖLÇÜLEMEDİ: sıralı çözme sonucu yok' };
  const parts = [];
  const why = [];
  if (base.worstColor > ACCESS_MAX_COLOR) why.push(`sıralı çözmede renk farkı ${base.worstColor} > ${ACCESS_MAX_COLOR}`);
  if (base.worstAlpha > ACCESS_MAX_ALPHA) why.push(`sıralı çözmede alfa farkı ${base.worstAlpha} > ${ACCESS_MAX_ALPHA}`);
  for (const [name, s] of Object.entries(S)) {
    const info = INFO_ERRORS.has(name);
    if (!info && s.errors.length > 0) why.push(`${name}: çözülemedi (${s.errors[0]})`);
    if (name !== 'inOrder' && s.worstColor > base.worstColor + ACCESS_TOLERANCE) why.push(`${name}: renk farkı ${s.worstColor} (sıralı ${base.worstColor})`);
    if (name !== 'inOrder' && s.worstAlpha > base.worstAlpha + ACCESS_TOLERANCE) why.push(`${name}: alfa farkı ${s.worstAlpha} (sıralı ${base.worstAlpha})`);
    if (!info && s.frames === 0) why.push(`${name}: hiç kare çözülmedi`);
    parts.push(`${name} ${s.worstColor}/${s.worstAlpha} (kare ${s.worstAt}${s.errors.length ? `, ${info ? 'çözücü takıldı' : 'ÇÖZÜLEMEDİ'}: ${s.errors[0]}` : ''})`);
  }
  const p = access.points?.afterWrap;
  const dark = p?.dark ? `; en koyu nokta başa dönüşte ${p.dark.decoded.join(',')} / ffmpeg ${p.dark.ffmpeg.join(',')}` : '';
  const ok = why.length === 0;
  return { ok, text: `${ok ? 'doğru' : `RENK KAYIYOR ya da ÇÖZÜLEMİYOR: ${why.join('; ')}`}; fark renk/alfa (en kötü kare): ${parts.join(', ')}${dark}` };
}
