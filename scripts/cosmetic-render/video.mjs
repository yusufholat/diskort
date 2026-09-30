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
// AVIF: tam aralık (nedeni aşağıda, ffmpegArgs); alfa akışı zaten tam aralıktı
const AVIF_YUV = 'scale=out_color_matrix=bt709:out_range=full';
const AVIF_TAGS = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=pc';

/**
 * Kodlamanın döngü başındaki sıçramaya karşı yöntemi (bkz. encodeSeamless):
 * - 'inter': olağan (tek anahtar kare, gerisi kareler arası tahmin): en küçük dosya;
 * - 'ramp' (yalnızca H.264): döngünün son %40'ında niceleme adım adım inceltilir, ilk kare de aynı incelikte;
 * - 'intra': her kare anahtar kare.
 */
const x264Ramp = (frames, crf) => {
  // altı basamak: döngünün %40'ı boyunca crf+1'den crf−11'e; ilk kare (anahtar) son basamakla aynı
  const q = [1, -1, -3, -5, -8, -11].map((d) => Math.max(4, crf + d));
  const start = Math.round(frames * 0.6);
  const step = (frames - start) / q.length;
  const zones = [`0,0,q=${q[q.length - 1]}`];
  for (let i = 0; i < q.length; i++) zones.push(`${Math.round(start + i * step)},${Math.round(start + (i + 1) * step) - 1},q=${q[i]}`);
  return `zones=${zones.join('/')}`;
};

/** Bir biçimin ffmpeg parametreleri (girdi: ham dosya; rapora da yazılır). `method`: bkz. yukarı */
export function ffmpegArgs(v, { rgba, stacked, width, height, fps, layout, out, frames }, method = 'inter') {
  const F = VIDEO_FORMATS[v.format];
  const input = F.stacked
    ? ['-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${layout.width}x${layout.height}`, '-framerate', String(fps), '-i', stacked]
    : ['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`, '-framerate', String(fps), '-i', rgba];
  const gop = method === 'intra' ? '1' : '600';
  const vp9 = ['-c:v', 'libvpx-vp9', '-crf', String(v.crf), '-b:v', '0', '-deadline', 'good', '-cpu-used', '1', '-row-mt', '1', '-g', gop];
  let codec;
  if (v.format === 'vp9a') codec = ['-vf', `${YUV},format=yuva420p`, ...vp9, ...TAGS];
  else if (v.format === 'svp9') codec = ['-vf', `${YUV},format=yuv420p`, ...vp9, ...TAGS];
  else if (v.format === 'sh264') {
    const extra = method === 'intra' ? ['-g', '1'] : method === 'ramp' ? ['-x264-params', x264Ramp(frames, v.crf)] : [];
    codec = ['-vf', `${YUV},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(v.crf), '-profile:v', 'high', ...extra, ...TAGS, '-movflags', '+faststart'];
  } else if (v.format === 'sav1')
    codec = ['-vf', `${YUV},format=yuv420p`, '-c:v', 'libsvtav1', '-preset', '5', '-crf', String(v.crf), '-g', gop, ...TAGS, '-movflags', '+faststart'];
  else {
    // AVIF: renk ve alfa iki ayrı akış (alfa tek renkli, tam aralık); ffmpeg'in avif yazıcısı ikinciyi alfa sayar.
    // Anahtar karenin zamansal süzgeci kapalı: süzülmüş ilk kare, döngünün son karesinden daha çok ayrışıyordu.
    // Her kare anahtar iken ileriye bakış da kapalı (libaom küçük tek renkli akışta bellek hatası veriyor).
    // Renk akışı TAM aralıkta (pc): Chromium'un resim çözücüsü sınırlı aralıklı AVIF'i yalnızca kareler baştan
    // sırayla çözülürken doğru gösteriyor; bir kare atlanınca, başa dönülünce ya da ortadan başlanınca aralığı
    // tam sanıp rengi soldurdu (uygulamada yaşandı; bkz. verify.html accessItem). Renk etiketleri süzgeçte de
    // konur ki izin örnek kaydında colr (nclx: BT.709, tam aralık) kutusu yazılsın (yalnızca çıkış seçeneğiyle
    // yazılmıyordu).
    codec = [
      '-filter_complex',
      // (alfa akışı RGB'den ayrıldığı için "gbr" etiketiyle gelir; libaom tek renkli akışta bunu kabul etmez)
      `[0:v]split[c][a];[c]${AVIF_YUV},format=yuv420p,${AVIF_TAGS}[cv];[a]alphaextract,format=gray,${AVIF_TAGS}[av]`,
      '-map', '[cv]', '-map', '[av]',
      '-c:v', 'libaom-av1', '-crf', String(v.crf), '-b:v', '0', '-cpu-used', '4', '-row-mt', '1', '-g', gop,
      ...(method === 'intra' ? ['-lag-in-frames', '0'] : ['-aom-params', 'enable-keyframe-filtering=0']),
      '-colorspace:v:0', 'bt709', '-color_primaries:v:0', 'bt709', '-color_trc:v:0', 'bt709', '-color_range:v:0', 'pc',
      '-loop', '0',
    ];
  }
  return ['-hide_banner', '-y', ...input, ...codec, '-an', out];
}

export async function encodeVideo(ffmpeg, v, options, method = 'inter') {
  const started = Date.now();
  const args = ffmpegArgs(v, options, method);
  await run(ffmpeg, args);
  return { bytes: fs.statSync(options.out).size, encodeMs: Date.now() - started, ffmpeg: args.filter((a) => a !== options.rgba && a !== options.stacked && a !== options.out).join(' ') };
}

// ---------- Kodlanmış dosyayı geri çözüp kare dizilerini çıkarma (ffmpeg / sharp ile, Node'da) ----------

/** Bir ham dosyayı kare kare okur (belleğe tümünü almadan) */
function* readFrames(file, frameBytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const total = Math.floor(fs.fstatSync(fd).size / frameBytes);
    for (let i = 0; i < total; i++) {
      const buf = Buffer.allocUnsafe(frameBytes);
      fs.readSync(fd, buf, 0, frameBytes, i * frameBytes);
      yield buf;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Alfayla çarpılmış kare dizisinden ardışık fark ve düzey dizileri (son eleman: son kare → ilk kare) */
function seriesOf(frames) {
  const mean = [];
  const level = [];
  let first = null;
  let firstLevel = null;
  let prev = null;
  let prevLevel = null;
  const diff = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  };
  const levelOf = (d) => {
    let rgb = 0;
    let alpha = 0;
    for (let i = 0; i < d.length; i += 4) {
      rgb += (d[i] + d[i + 1] + d[i + 2]) / 3;
      alpha += d[i + 3];
    }
    return [rgb / (d.length / 4), alpha / (d.length / 4)];
  };
  const step = (x, y) => Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]);
  for (const f of frames) {
    const lv = levelOf(f);
    if (prev) {
      mean.push(diff(prev, f));
      level.push(step(prevLevel, lv));
    } else {
      first = f;
      firstLevel = lv;
    }
    prev = f;
    prevLevel = lv;
  }
  mean.push(diff(prev, first));
  level.push(step(prevLevel, firstLevel));
  return { mean, level };
}

/**
 * AVIF'in ffmpeg ile çözülmüş kareleri (sırasız çözme denetiminin karşılaştırma tabanı, bkz. verify.html
 * accessItem): düz renk (rgb24) ve alfa (gray) iki ham dosyada. ffmpeg hareketli AVIF'i dört akış olarak açar:
 * 0 ve 1 kapak resmi (renk, alfa), 2 ve 3 kare dizisi.
 */
export async function avifReference(ffmpeg, file, tmp) {
  const base = path.join(tmp, `${path.basename(file)}.ref`);
  const color = `${base}-color.raw`;
  const alpha = `${base}-alpha.raw`;
  await run(ffmpeg, ['-hide_banner', '-y', '-i', file, '-map', '0:v:2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', color]);
  await run(ffmpeg, ['-hide_banner', '-y', '-i', file, '-map', '0:v:3', '-f', 'rawvideo', '-pix_fmt', 'gray', alpha]);
  return { color, alpha };
}

/**
 * Kodlanmış dosyanın (avif, sh264, webp) kare dizileri: ardışık karelerin ortalama farkı ve düzey değişimi
 * (alfayla çarpılmış renk + alfa, 0-255). Tarayıcıdaki doğrulamayla (verify.html) aynı ölçü; burada kodlama
 * yöntemini seçmek için hızlıca, Node'da hesaplanır.
 */
export async function decodedSeries(ffmpeg, sharp, kind, file, { width, height, layout, tmp }) {
  const px = width * height;
  const dec = (args) => run(ffmpeg, ['-hide_banner', '-y', '-i', file, ...args]);
  if (kind === 'webp') {
    const buf = await sharp(file, { animated: true, limitInputPixels: false }).ensureAlpha().raw().toBuffer();
    const pages = buf.length / (px * 4);
    const gen = (function* () {
      for (let k = 0; k < pages; k++) {
        const s = buf.subarray(k * px * 4, (k + 1) * px * 4);
        const f = new Float32Array(px * 4);
        for (let i = 0; i < px * 4; i += 4) {
          const a = s[i + 3];
          f[i] = (s[i] * a) / 255;
          f[i + 1] = (s[i + 1] * a) / 255;
          f[i + 2] = (s[i + 2] * a) / 255;
          f[i + 3] = a;
        }
        yield f;
      }
    })();
    return seriesOf(gen);
  }
  if (kind === 'avif') {
    // ffmpeg hareketli AVIF'i dört akış olarak açar: 0 ve 1 kapak resmi (renk, alfa), 2 ve 3 kare dizisi
    const c = path.join(tmp, 'dec-color.raw');
    const a = path.join(tmp, 'dec-alpha.raw');
    await dec(['-map', '0:v:2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', c]);
    await dec(['-map', '0:v:3', '-f', 'rawvideo', '-pix_fmt', 'gray', a]);
    const alpha = readFrames(a, px);
    const gen = (function* () {
      for (const col of readFrames(c, px * 3)) {
        const al = alpha.next().value;
        const f = new Float32Array(px * 4);
        for (let p = 0; p < px; p++) {
          const v = al[p];
          f[p * 4] = (col[p * 3] * v) / 255;
          f[p * 4 + 1] = (col[p * 3 + 1] * v) / 255;
          f[p * 4 + 2] = (col[p * 3 + 2] * v) / 255;
          f[p * 4 + 3] = v;
        }
        yield f;
      }
    })();
    const out = seriesOf(gen);
    fs.rmSync(c, { force: true });
    fs.rmSync(a, { force: true });
    return out;
  }
  // yığılmış video: iki yarı, oynatıcının yaptığı gibi birleştirilir (renk alfanın üstüne çıkamaz)
  const s = path.join(tmp, 'dec-stacked.raw');
  await dec(['-f', 'rawvideo', '-pix_fmt', 'rgb24', s]);
  const gen = (function* () {
    for (const b of readFrames(s, layout.width * layout.height * 3)) {
      const f = new Float32Array(px * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const ci = (y * layout.width + x) * 3;
          const al = b[(y * layout.width + layout.alphaX + x) * 3 + 1];
          const o = (y * width + x) * 4;
          f[o] = Math.min(b[ci], al);
          f[o + 1] = Math.min(b[ci + 1], al);
          f[o + 2] = Math.min(b[ci + 2], al);
          f[o + 3] = al;
        }
      }
      yield f;
    }
  })();
  const out = seriesOf(gen);
  fs.rmSync(s, { force: true });
  return out;
}

// ---------- Hareketli WebP: her kare anahtar kare ----------

/**
 * Tek tek kodlanmış karelerden hareketli WebP kurar (RIFF: VP8X + ANIM + kare başına ANMF). libwebp'in kendi
 * hareket kodlayıcısı kayıplı kipte az değişen pikselleri "değişmedi" sayıp eski değerinde bırakır (eşik
 * kaliteye bağlı: q60'ta ~8 düzey); yavaş değişen sahnede tuval gerçeğin gerisinde kalır ve döngü başındaki tam
 * kare onu bir anda tazeler (ortalama parlaklık tek karede sıçrar). Her kare bağımsız kodlanınca böyle bir
 * birikme olmaz; bu içerikte boyut aynı kalır ya da biraz artar, kalite yükselir.
 * Her kare tuvalin tamamını değiştirir (karıştırma yok). `delays`: kare süreleri (ms).
 */
export async function encodeIntraWebp(sharp, frames, width, height, delays, options, file) {
  const parts = [];
  let alpha = false;
  for (let i = 0; i < frames.length; i++) {
    const still = await sharp(Buffer.from(frames[i]), { raw: { width, height, channels: 4 } }).webp(options).toBuffer();
    // durağan dosyanın veri parçaları: (ALPH) + VP8 / VP8L
    const chunks = [];
    for (let off = 12; off < still.length; ) {
      const id = still.toString('ascii', off, off + 4);
      const padded = still.readUInt32LE(off + 4) + (still.readUInt32LE(off + 4) & 1);
      if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') chunks.push(still.subarray(off, off + 8 + padded));
      if (id === 'ALPH' || id === 'VP8L') alpha = true;
      off += 8 + padded;
    }
    const body = Buffer.concat(chunks);
    const head = Buffer.alloc(24);
    head.write('ANMF', 0, 'ascii');
    head.writeUInt32LE(16 + body.length, 4);
    head.writeUIntLE(0, 8, 3); // x / 2
    head.writeUIntLE(0, 11, 3); // y / 2
    head.writeUIntLE(width - 1, 14, 3);
    head.writeUIntLE(height - 1, 17, 3);
    head.writeUIntLE(delays[i], 20, 3);
    head.writeUInt8(0x02, 23); // karıştırma yok, önceki kare atılmaz: kare tuvalin tamamını değiştirir
    parts.push(head, body);
  }
  const vp8x = Buffer.alloc(18);
  vp8x.write('VP8X', 0, 'ascii');
  vp8x.writeUInt32LE(10, 4);
  vp8x.writeUInt8(0x02 | (alpha ? 0x10 : 0), 8); // hareketli (+ alfa)
  vp8x.writeUIntLE(width - 1, 12, 3);
  vp8x.writeUIntLE(height - 1, 15, 3);
  const anim = Buffer.alloc(14);
  anim.write('ANIM', 0, 'ascii');
  anim.writeUInt32LE(6, 4); // zemin rengi 0, döngü sayısı 0 (sonsuz)
  const payload = Buffer.concat([Buffer.from('WEBP', 'ascii'), vp8x, anim, ...parts]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(payload.length, 4);
  fs.writeFileSync(file, Buffer.concat([riff, payload]));
}
