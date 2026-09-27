import { useEffect, useRef, useState } from 'react';
import type { GifEmbed as GifEmbedData } from '@diskort/shared';
import { fitBox, isGiphyMedia } from '@diskort/client-core';
import { useReducedMotion } from '../../lib/motion';
import { IMAGE_MAX } from './Attachments';

/**
 * Mesajdaki GIF (GIPHY): kutu boyutu baştan bilinir (liste kaymaz). Aynı görüntünün MP4'ü GIF'ten
 * çok daha hafif olduğundan sessiz, döngülü video olarak oynatılır; ekranda değilken durur.
 * "Animasyonları azalt" açıksa yalnızca üstüne gelince oynar. MP4 yoksa ya da açılamazsa GIF/WebP.
 */
export function GifEmbed({ embed }: { embed: GifEmbedData }) {
  const box = fitBox(embed.width, embed.height, IMAGE_MAX) ?? { width: 300, height: 200 };
  const reduced = useReducedMotion();
  const [videoFailed, setVideoFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const mp4 = !videoFailed && isGiphyMedia(embed.mp4) ? embed.mp4 : null;
  const image = isGiphyMedia(embed.webp) ? embed.webp : embed.gif;
  const still = isGiphyMedia(embed.still) ? embed.still : undefined;

  // Yalnızca görünürken oynat (uzun kanallarda onlarca GIF aynı anda çözülmesin)
  useEffect(() => {
    const el = video.current;
    if (!el || reduced) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void el.play().catch(() => undefined);
      else el.pause();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [mp4, reduced]);

  return (
    <div
      className="group/gif relative mt-1 overflow-hidden rounded-lg bg-bg-side"
      style={box}
      data-tooltip={embed.title || undefined}
      onMouseEnter={() => reduced && void video.current?.play().catch(() => undefined)}
      onMouseLeave={() => reduced && video.current?.pause()}
    >
      {mp4 ? (
        <video
          ref={video}
          src={mp4}
          poster={still}
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          aria-label={embed.title || 'GIF'}
          className="block h-full w-full object-cover"
          onError={() => setVideoFailed(true)}
        />
      ) : (
        <img
          src={reduced && still ? still : image}
          alt={embed.title || 'GIF'}
          loading="lazy"
          draggable={false}
          className="block h-full w-full object-cover"
        />
      )}
      <span className="pointer-events-none absolute top-1.5 left-1.5 rounded bg-black/60 px-1 text-[10px] font-bold text-white/90 opacity-0 transition-opacity group-hover/gif:opacity-100">
        GIF
      </span>
    </div>
  );
}
