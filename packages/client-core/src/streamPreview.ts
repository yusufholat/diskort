import { STREAM_SOURCE_NAME_MAX_LENGTH, type StreamSourceKind, type StreamSourceRequest, type VoiceState } from '@diskort/shared';
import { ApiError, normalizeServerUrl, request } from './api';
import { env } from './env';
import { useSession } from './session';

// Yayın önizlemesi ("Şimdi Yayın Yapıyor" kartı): yayıncı birkaç saniyede bir kendi ekranından küçük bir
// kare yükler; kanalı görebilenler onu jetonla indirir. Sunucu yalnızca bellekte, yalnızca yayın sürerken tutar.

type PreviewTarget = Pick<VoiceState, 'channelId' | 'userId' | 'streamPreviewAt'>;

/** Önizlemeyi almak için başlıklar (mobil: <Image source={{ uri, headers }} />) */
export const streamPreviewHeaders = (): Record<string, string> => {
  const token = useSession.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Paylaşılan pencerenin/ekranın adını bildirir (sunucu temizler ve 64 karakterle sınırlar). */
export function reportStreamSource(name: string, kind: StreamSourceKind): Promise<void> {
  const body: StreamSourceRequest = { name: [...name].slice(0, STREAM_SOURCE_NAME_MAX_LENGTH * 2).join(''), kind };
  return request<void>('PUT', '/api/voice/stream-source', body);
}

/** Yayın karesini yükler (JPEG/WebP/PNG, en çok 256 KB). Yayın henüz sunucuya ulaşmadıysa 409 atar. */
export async function uploadStreamPreview(image: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch(normalizeServerUrl(env().serverUrl()) + '/api/voice/stream-preview', {
      method: 'PUT',
      headers: { ...streamPreviewHeaders(), 'Content-Type': image.type || 'image/jpeg' },
      body: image,
    });
  } catch {
    throw new ApiError(0, 'network', 'Yayın önizlemesi yüklenemedi: sunucuya ulaşılamadı.');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Yayın önizlemesi yüklenemedi (${res.status}).`);
  }
}

/** Önizlemenin adresi; `streamPreviewAt` önbelleği tazelemek için eklenir. Jeton gerekir. */
export const streamPreviewUrl = (state: PreviewTarget): string =>
  `${normalizeServerUrl(env().serverUrl())}/api/voice/${state.channelId}/stream-preview/${state.userId}?v=${state.streamPreviewAt ?? 0}`;

/** Önizlemeyi jetonla indirir (masaüstü: URL.createObjectURL); yoksa (yayın bitti, yetki yok) null. */
export async function fetchStreamPreview(state: PreviewTarget, signal?: AbortSignal): Promise<Blob | null> {
  const res = await fetch(streamPreviewUrl(state), { headers: streamPreviewHeaders(), signal });
  if (!res.ok) return null;
  return res.blob();
}

/** Yayın süresi: "04:07" ya da "1:02:09" */
export function formatStreamElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
