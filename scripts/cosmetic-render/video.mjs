// Çizim aracının video tarafı: aynı ham karelerden ffmpeg ile alfalı video / AVIF kodlar.
// ffmpeg bağımlılık olarak eklenmez: PATH'te aranır (bulunamazsa açık bir hata verilir).
//
// Biçimler (--video "biçim:crf,..."):
//   vp9a   WebM, VP9 + alfa (yuva420p). Chromium'da <video> ile oynar.
//   sh264  "Yığılmış alfa", H.264 MP4: tek ve OPAK bir video; sol yarıda renk (alfayla çarpılmış), sağ yarıda
//   svp9   alfa (gri). Oynatıcı iki yarıyı küçük bir gölgelendiriciyle birleştirir: çözücüden alfa desteği
//   sav1   istemez, her platformda çalışabilecek biçim budur. svp9: VP9 WebM, sav1: AV1 MP4.
//   avif   Hareketli AVIF, alfalı (renk ve alfa iki ayrı AV1 akışı). Chromium'da <img> ile oynar.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const VIDEO_FORMATS = {
  vp9a: { label: 'WebM VP9 + alfa', ext: 'webm', mime: 'video/webm', tag: 'video', stacked: false },
  sh264: { label: 'Yığılmış alfa, H.264 MP4', ext: 'mp4', mime: 'video/mp4', tag: 'video', stacked: true },
  svp9: { label: 'Yığılmış alfa, VP9 WebM', ext: 'webm', mime: 'video/webm', tag: 'video', stacked: true },
  sav1: { label: 'Yığılmış alfa, AV1 MP4', ext: 'mp4', mime: 'video/mp4', tag: 'video', stacked: true },
  avif: { label: 'Hareketli AVIF + alfa', ext: 'avif', mime: 'image/avif', tag: 'img', stacked: false },
};

/** "vp9a:30,sh264:24" → [{ format, crf, label }] */
export function parseVideoSpec(text) {
  if (!text || text === 'none') return [];
  return text.split(',').map((token) => {
    const [format, crfText] = token.split(':');
    const crf = Number(crfText);
    if (!VIDEO_FORMATS[format]) throw new Error(`bilinmeyen video biçimi: ${format} (${Object.keys(VIDEO_FORMATS).join(', ')})`);
    if (!Number.isInteger(crf) || crf < 0 || crf > 63) throw new Error(`crf 0-63 arası tam sayı olmalı: ${token}`);
    return { format, crf, label: `${format}-crf${crf}` };
  });
}

/** ffmpeg'i bulur: --ffmpeg, PATH, Windows'ta winget'in kurduğu yerler (kabuğun PATH'i eski kalmış olabilir) */
export function findFfmpeg(explicit) {
  const works = (exe) => {
    const r = spawnSync(exe, ['-hide_banner', '-version'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.split('\n')[0].trim() : null;
  };
  if (explicit) {
    const version = works(explicit);
    if (!version) throw new Error(`--ffmpeg ile verilen dosya çalışmıyor: ${explicit}`);
    return { exe: explicit, version };
  }
  const candidates = ['ffmpeg'];
  const local = process.env.LOCALAPPDATA;
  if (process.platform === 'win32' && local) {
    candidates.push(path.join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
    const packages = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(packages)) {
      for (const pkg of fs.readdirSync(packages).filter((n) => /ffmpeg/i.test(n))) {
        const dir = path.join(packages, pkg);
        for (const sub of fs.readdirSync(dir)) candidates.push(path.join(dir, sub, 'bin', 'ffmpeg.exe'));
      }
    }
  }
  for (const exe of candidates) {
    const version = works(exe);
    if (version) return { exe, version };
  }
  throw new Error(
    'ffmpeg bulunamadı. Video biçimleri için ffmpeg PATH\'te olmalı (ör. `winget install Gyan.FFmpeg`, sonra yeni bir kabuk) ' +
      'ya da --ffmpeg <yol> verilmeli. Yalnızca WebP için: --video none',
  );
}

// Çalışan ffmpeg süreçleri: betik biterken (hata, Ctrl+C) yarım kalan kodlama da durdurulur
const running = new Set();
process.on('exit', () => {
  for (const child of running) {
    try {
      child.kill();
    } catch {
      // zaten kapanmış
    }
  }
});

function run(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    running.add(child);
    let err = '';
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    child.on('error', (e) => {
      running.delete(child);
      reject(e);
    });
    child.on('exit', (code) => {
      running.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg başarısız (çıkış ${code}): ffmpeg ${args.join(' ')}\n${err}`));
    });
  });
}

/**
 * Yığılmış alfa karesinin yerleşimi: [renk | boşluk | alfa], yan yana. Boşluk (16 px: bir makro blok) iki yarının
 * kenar piksellerinin uzatılmasıyla dolar: renk yarısının son sütunu sağa 8 px, alfa yarısının ilk sütunu sola
 * 8 px. Böylece 4:2:0 renk örneklemesi, blok dönüşümü ve halka süzgeci bir yarının kenarını ötekine taşımaz.
 * Yükseklik tek ise son satır yinelenir (4:2:0 çift ölçü ister).
 */
export function stackedLayout(width, height) {
  const gap = 16;
  return { width: width * 2 + gap, height: height + (height % 2), gap, colorX: 0, alphaX: width + gap, tileW: width, tileH: height };
}

/**
 * Düz RGBA kareleri yığılmış RGB karelere çevirir ve tek ham dosyaya yazar. Renk yarısı ALFAYLA ÇARPILMIŞ
 * saklanır: saydam yerler siyah olur (düz renkteki anlamsız değerler kodlanmaz, kenarda koyu/açık saçak olmaz),
 * oynatıcı doğrudan önceden çarpılmış renk olarak kullanır.
 */
export function writeStacked(frames, width, height, file) {
  const L = stackedLayout(width, height);
  const fd = fs.openSync(file, 'w');
  const out = Buffer.alloc(L.width * L.height * 3);
  const half = L.gap / 2;
  try {
    for (const f of frames) {
      for (let y = 0; y < L.height; y++) {
        const sy = Math.min(y, height - 1);
        const row = y * L.width * 3;
        for (let x = 0; x < L.width; x++) {
          const o = row + x * 3;
          if (x < width + half) {
            const i = (sy * width + Math.min(x, width - 1)) * 4;
            const a = f[i + 3];
            out[o] = Math.round((f[i] * a) / 255);
            out[o + 1] = Math.round((f[i + 1] * a) / 255);
            out[o + 2] = Math.round((f[i + 2] * a) / 255);
          } else {
            const a = f[(sy * width + Math.max(0, x - L.alphaX)) * 4 + 3];
            out[o] = out[o + 1] = out[o + 2] = a;
          }
        }
      }
      fs.writeSync(fd, out);
    }
  } finally {
    fs.closeSync(fd);
  }
  return L;
}

// Renk uzayı açıkça BT.709, sınırlı aralık: etiketsiz videoda tarayıcı boyuta göre tahmin yürütür (renk kayar)
const YUV = 'scale=out_color_matrix=bt709:out_range=limited';
const TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** Bir biçimin ffmpeg parametreleri (girdi: `input` ham dosyası; rapora da yazılır) */
export function ffmpegArgs(v, { rgba, stacked, width, height, fps, layout, out }) {
  const F = VIDEO_FORMATS[v.format];
  const input = F.stacked
    ? ['-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${layout.width}x${layout.height}`, '-framerate', String(fps), '-i', stacked]
    : ['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`, '-framerate', String(fps), '-i', rgba];
  const vp9 = ['-c:v', 'libvpx-vp9', '-crf', String(v.crf), '-b:v', '0', '-deadline', 'good', '-cpu-used', '1', '-row-mt', '1', '-g', '600'];
  let codec;
  if (v.format === 'vp9a') codec = ['-vf', `${YUV},format=yuva420p`, ...vp9, ...TAGS];
  else if (v.format === 'svp9') codec = ['-vf', `${YUV},format=yuv420p`, ...vp9, ...TAGS];
  else if (v.format === 'sh264')
    codec = ['-vf', `${YUV},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(v.crf), '-profile:v', 'high', ...TAGS, '-movflags', '+faststart'];
  else if (v.format === 'sav1')
    codec = ['-vf', `${YUV},format=yuv420p`, '-c:v', 'libsvtav1', '-preset', '5', '-crf', String(v.crf), '-g', '600', ...TAGS, '-movflags', '+faststart'];
  else {
    // AVIF: renk ve alfa iki ayrı akış (alfa tek renkli, tam aralık); ffmpeg'in avif yazıcısı ikinciyi alfa sayar
    codec = [
      '-filter_complex',
      // (alfa akışı RGB'den ayrıldığı için "gbr" etiketiyle gelir; libaom tek renkli akışta bunu kabul etmez)
      `[0:v]split[c][a];[c]${YUV},format=yuv420p[cv];[a]alphaextract,format=gray,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=pc[av]`,
      '-map', '[cv]', '-map', '[av]',
      '-c:v', 'libaom-av1', '-crf', String(v.crf), '-b:v', '0', '-cpu-used', '4', '-row-mt', '1', '-g', '600',
      '-colorspace:v:0', 'bt709', '-color_primaries:v:0', 'bt709', '-color_trc:v:0', 'bt709', '-color_range:v:0', 'tv',
      '-loop', '0',
    ];
  }
  return ['-hide_banner', '-y', ...input, ...codec, '-an', out];
}

export async function encodeVideo(ffmpeg, v, options) {
  const started = Date.now();
  const args = ffmpegArgs(v, options);
  await run(ffmpeg, args);
  return { bytes: fs.statSync(options.out).size, encodeMs: Date.now() - started, ffmpeg: args.filter((a) => a !== options.rgba && a !== options.stacked && a !== options.out).join(' ') };
}
