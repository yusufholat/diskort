/**
 * Bağlantı önizlemelerinin (sunucunun eklediği `type: 'link'` embed'leri) istemcide gösterimi için
 * ortak yardımcılar. Sunucudan gelen veri yine de denetlenir: yalnızca http(s) bağlantılar, sunucumuzdaki
 * resim adresleri ve geçerli YouTube kimlikleri kullanılır.
 */

import { linkEmbedsOf, type LinkEmbed, type Message } from '@diskort/shared';
import { normalizeServerUrl } from './api';
import { env } from './env';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const HTTP_URL = /^https?:\/\//i;
const MEDIA_PATH = /^\/api\/embed-media\/[A-Za-z0-9_-]{32}\/[A-Za-z0-9_-]+$/;

const isHttp = (url: unknown): url is string => typeof url === 'string' && HTTP_URL.test(url);

/** Mesajın gösterilecek bağlantı önizlemeleri (kaldırılmışsa ya da veri bozuksa boş) */
export function visibleLinkEmbeds(message: Pick<Message, 'embeds' | 'suppressEmbeds'>): LinkEmbed[] {
  if (message.suppressEmbeds) return [];
  return linkEmbedsOf(message).filter(
    (e) => isHttp(e.url) && (e.kind !== 'youtube' || (typeof e.youtubeId === 'string' && YOUTUBE_ID.test(e.youtubeId))),
  );
}

/** Önizleme resminin tam adresi (yalnızca sunucumuzdaki imzalı adresler; diğerleri null) */
export function embedMediaUrl(image: LinkEmbed['image'] | null | undefined): string | null {
  return image && MEDIA_PATH.test(image.url) ? normalizeServerUrl(env().serverUrl()) + image.url : null;
}

/** YouTube videosunu satır içinde oynatan çerçeve adresi (çerezsiz alan adı) */
export function youtubePlayerUrl(embed: Pick<LinkEmbed, 'youtubeId' | 'youtubeStart'>): string | null {
  if (!embed.youtubeId || !YOUTUBE_ID.test(embed.youtubeId)) return null;
  const start = embed.youtubeStart && Number.isInteger(embed.youtubeStart) && embed.youtubeStart > 0 ? `&start=${embed.youtubeStart}` : '';
  return `https://www.youtube-nocookie.com/embed/${embed.youtubeId}?autoplay=1&rel=0${start}`;
}

/** Doğrudan video önizlemesinin dosya adresi (yalnızca http(s)) */
export const embedVideoUrl = (embed: LinkEmbed): string | null => (isHttp(embed.video?.url) ? embed.video.url : null);

/** Kartta gösterilen kısa alan adı ("www." olmadan) */
export function embedHost(url: string): string {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return m ? m[1]!.replace(/^www\./i, '').toLowerCase() : url;
}

/** Sol şeridin rengi: yalnızca #rrggbb; yoksa null (çizici tema rengini kullanır) */
export const embedColor = (embed: LinkEmbed): string | null =>
  embed.color && /^#[0-9a-f]{6}$/i.test(embed.color) ? embed.color : null;
