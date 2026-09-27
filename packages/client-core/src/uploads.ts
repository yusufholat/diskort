import type { ApiErrorBody, Attachment } from '@diskort/shared';
import { ApiError, normalizeServerUrl } from './api';
import { env, type LocalFile, type UploadRequest, type UploadResponse } from './env';
import { useSession } from './session';

/** Sunucudaki dosyanın tam adresi (resim gösterme ve indirme için; jeton gerekmez) */
export const attachmentUrl = (attachment: Pick<Attachment, 'url'>): string =>
  normalizeServerUrl(env().serverUrl()) + attachment.url;

const decimal = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** 834 B, 12,5 KB, 3,2 MB */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${decimal.format(bytes / 1024)} KB`;
  return `${decimal.format(bytes / 1024 / 1024)} MB`;
}

/** Yükleme kullanıcı vazgeçtiği için yarıda kesildi */
export class UploadCancelled extends Error {
  constructor() {
    super('Yükleme iptal edildi.');
  }
}

const MIME = /^[\w.+-]+\/[\w.+-]+$/;

/** Tarayıcıda (masaüstü) dosyayı ilerleme bildirerek gönderir. */
function xhrUpload(request: UploadRequest): Promise<UploadResponse> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', request.url);
    for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => request.onProgress(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => resolve({ status: 0, body: '' });
    xhr.onabort = () => resolve({ status: 0, body: '' });
    request.signal.addEventListener('abort', () => xhr.abort());
    xhr.send(request.file.blob ?? null);
  });
}

/** Dosyayı kanala yükler; dönen ek, mesaj gönderilirken kimliğiyle verilir. */
export async function uploadFile(
  channelId: string,
  file: LocalFile,
  onProgress: (sent: number) => void,
  signal: AbortSignal,
): Promise<Attachment> {
  const token = useSession.getState().token;
  const base = normalizeServerUrl(env().serverUrl());
  const res = await (env().upload ?? xhrUpload)({
    url: `${base}/api/channels/${channelId}/attachments?name=${encodeURIComponent(file.name)}`,
    headers: {
      Authorization: `Bearer ${token ?? ''}`,
      'Content-Type': MIME.test(file.type) ? file.type : 'application/octet-stream',
    },
    file,
    onProgress,
    signal,
  });
  if (signal.aborted) throw new UploadCancelled();

  let data: unknown = null;
  try {
    data = JSON.parse(res.body);
  } catch {
    // gövde JSON değil
  }
  if (res.status === 201 && data) return data as Attachment;
  if (res.status === 0) throw new ApiError(0, 'network', 'Dosya yüklenemedi: sunucuya ulaşılamadı.');
  if (res.status === 401 && token) useSession.getState().logout();
  const err = data as Partial<ApiErrorBody> | null;
  throw new ApiError(res.status, err?.error ?? 'error', err?.message ?? `Dosya yüklenemedi (${res.status}).`);
}
