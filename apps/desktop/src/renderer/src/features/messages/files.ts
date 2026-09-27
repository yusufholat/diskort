import type { Attachment } from '@diskort/shared';
import { attachmentUrl, type LocalFile } from '@diskort/client-core';
import { bridge } from '../../lib/bridge';

/** 2026-09-27-14-05-33 (yerel saat) */
function stamp(): string {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
}

/** Seçilen, sürüklenen ya da yapıştırılan dosyaları ortak çekirdeğin biçimine çevirir. */
export function toLocalFiles(files: FileList | File[]): LocalFile[] {
  return Array.from(files, (f) => ({
    // Panodan yapıştırılan resimlerin adı Chromium'da hep "image.png"
    name: f.name === 'image.png' ? `resim-${stamp()}.png` : f.name,
    size: f.size,
    type: f.type,
    blob: f,
  }));
}

/** Dosyayı indirir (masaüstünde "Farklı kaydet" penceresi açılır). */
export function downloadAttachment(attachment: Attachment): void {
  const url = attachmentUrl(attachment);
  if (bridge) void bridge.download(url);
  else window.open(url, '_blank');
}
