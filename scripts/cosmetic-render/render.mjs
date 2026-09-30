// Hareketli kozmetik setlerini ÖNCEDEN çizer: bir setin üç parçasını (avatar dekorasyonu, isim plakası, profil
// kartı efekti) dikişsiz döngü olarak kare kare çizip alfalı hareketli WebP'ye kodlar. Yalnızca geliştirme
// aracıdır (deney: canlı çizim yerine sunucudan indirilen hazır döngüler); uygulamaya girmez.
//
//   node scripts/cosmetic-render/render.mjs [seçenekler]
//     --set buz                 set (döngü biçimi hazır olmalı: client-core COSMETIC_LOOP_SHADERS)
//     --loop 6                  döngü süresi, saniye (verilmezse COSMETIC_LOOP_SECONDS)
//     --fps 60,30               kare hızları (en yükseği çizilir, diğerleri ondan seçilir)
//     --quality 85,60/75,45/50  WebP kalite ayarları: renk kalitesi, isteğe bağlı "/alfa kalitesi" (verilmezse
//                               100: alfa kayıpsız), ya da "lossless"
//     --pieces deco,plate,card  parçalar
//     --dither static           bantlaşma gürültüsü: static (karelerde aynı), frame (canlıdaki gibi), off
//     --effort 4                WebP kodlama çabası (0-6; 6, kayıpsız alfayla dakikalar sürer, kazancı az)
//     --dpr 2                   css pikseli başına tuval pikseli (uygulamada en fazla 2)
//     --out <klasör>            çıktı klasörü (verilmezse scripts/cosmetic-render/out; git'e girmez)
//     --keep-raw                ham kareleri (.tmp) silme
//
// Nasıl çalışır: page.ts (masaüstünün gerçek layers.ts'i ve client-core'un gerçek gölgelendiricileri) Vite ile
// tek dosyaya paketlenir, GİZLİ bir Electron penceresinde açık zaman değerleriyle çizilir, ham kareler burada
// sharp (libwebp) ile kodlanır. Yeni bağımlılık eklemez: Electron ve Vite masaüstü uygulamasının, sharp
// sunucunun bağımlılığıdır (önce `pnpm install`). ffmpeg ya da derleyici gerekmez.
//
// Çıktı: <out>/index.html (önizleme sayfası, çift tıklayıp aç), <out>/manifest.js, <out>/<set>/*.webp,
// <out>/<set>/stills/*.png (gözle kontrol kareleri).
//
// Notlar (buz setiyle ölçüldü):
// - Gürültü: canlıdaki gibi her karede değişen gürültü dosyayı ~%11-14 büyütür (kareler arası fark yalnızca
//   gürültüden gelir); sabit gürültü, gürültüsüzle aynı boyutu verir ve bantlaşmayı yine kırar. Varsayılan: static.
// - Hareketli WebP kareler arası tahmin yapmaz (video değildir): boyutun çoğu alfa kanalıdır (kayıpsız saklanır).
//   Alfa kalitesi 100'ün altına inince alfa daha az düzeye yuvarlanır (75: 56 düzey, 50: 12 düzey).
// - page.ts'in tip kontrolü: apps/desktop/node_modules/.bin/tsc -p scripts/cosmetic-render/tsconfig.json

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const requireDesktop = createRequire(path.join(root, 'apps/desktop/package.json'));
const requireServer = createRequire(path.join(root, 'apps/server/package.json'));

// ---------- Seçenekler ----------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`bilinmeyen parametre: ${a}`);
    const key = a.slice(2);
    if (key === 'keep-raw') out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
// Standart döngü süresi tek yerde: client-core (düz TypeScript; Node 22.18+ doğrudan okur)
const { COSMETIC_LOOP_SECONDS } = await import(pathToFileURL(path.join(root, 'packages/client-core/src/cosmeticShaders/loop.ts')).href);
const { COSMETIC_SET_INFO } = await import(pathToFileURL(path.join(root, 'packages/client-core/src/cosmeticSets.ts')).href);

const SET = args.set ?? 'buz';
const LOOP = Number(args.loop ?? COSMETIC_LOOP_SECONDS);
const FPS = (args.fps ?? '60,30').split(',').map(Number).sort((a, b) => b - a);
/** Kalite ayarı: renk kalitesi ve alfa kalitesi (100: alfa kayıpsız), ya da tümüyle kayıpsız */
const QUALITIES = (args.quality ?? '85,60/75,45/50').split(',').map((token) => {
  if (token === 'lossless') return { label: 'lossless', lossless: true };
  const [q, a = '100'] = token.split('/');
  const quality = Number(q);
  const alphaQuality = Number(a);
  for (const x of [quality, alphaQuality]) if (!Number.isInteger(x) || x < 0 || x > 100) throw new Error(`kalite 0-100 arası tam sayı olmalı: ${token}`);
  return { label: alphaQuality === 100 ? `q${quality}` : `q${quality}a${alphaQuality}`, quality, alphaQuality };
});
const PIECES = (args.pieces ?? 'deco,plate,card').split(',');
const DITHER = args.dither ?? 'static';
const EFFORT = Number(args.effort ?? 4);
const DPR = Number(args.dpr ?? 2);
const OUT = path.resolve(args.out ?? path.join(here, 'out'));
const TMP = path.join(OUT, '.tmp');

if (!COSMETIC_SET_INFO[SET]) throw new Error(`bilinmeyen set: ${SET}`);
if (!(LOOP > 0)) throw new Error(`döngü süresi pozitif olmalı: ${args.loop}`);
const MASTER_FPS = FPS[0];
for (const fps of FPS) {
  if (!Number.isInteger(fps) || fps <= 0) throw new Error(`kare hızı pozitif tam sayı olmalı: ${fps}`);
  if (MASTER_FPS % fps !== 0) throw new Error(`kare hızları en yükseğinin böleni olmalı (${MASTER_FPS} / ${fps})`);
  if (Math.abs(LOOP * fps - Math.round(LOOP * fps)) > 1e-9) throw new Error(`döngü süresi × kare hızı tam sayı olmalı (${LOOP} × ${fps})`);
}

// ---------- Parçalar: masaüstü uygulamasının gerçek ölçüleri (css px) ----------
// Tuval çözünürlüğü uygulamada en fazla 2× (engine.ts DPR_CAP): her parça kullanılan en büyük css boyunun 2 katı (--dpr).
const PIECE_SPECS = {
  // Cosmetics.tsx AnimatedDecoration: en büyük avatar 80 px (profil kartı, sesli sahne) → dış yarıçap
  // R = 80/2 × 1.15 = 46, tuval = R × 132/46 = 132 px kare
  deco: { label: 'Avatar dekorasyonu', kind: 'deco', w: 132, h: 132, glScale: 1, R: 46 },
  // NameplateCanvas: üye listesi w-60 (240) − kenarlık 1 − px-2 (16) = 223 px; satır 42 px, üstte ve altta 1 px boşluk
  plate: { label: 'İsim plakası', kind: 'plate', w: 223, h: 40, glScale: 1 },
  // CardEffectCanvas: kart w-[300px] − kenarlık 2 = 298 px, gölgelendirici 0.75 çözünürlükte. Afiş h-[106px];
  // avatar kabı px-4 (16), −mt-10, 6 px halka + 80 px avatar → merkez (62, 112), dış yarıçap 46 (engine.ts'teki
  // varsayılanla aynı). Yükseklik içeriğe göre değişir: roller ve "Mesaj gönder" düğmesi olan tipik kart ~340 px.
  card: { label: 'Profil kartı efekti', kind: 'card', w: 298, h: 340, glScale: 0.75, geo: { bh: 106, ax: 62, ay: 112, ar: 46 } },
};
for (const p of PIECES) if (!PIECE_SPECS[p]) throw new Error(`bilinmeyen parça: ${p}`);

/** Gözle kontrol karelerinin anları (döngünün kesri) */
const STILL_AT = [0.1, 0.25, 0.45, 0.62, 0.85, 0.93];
/** Döngüsellik denetimi: bu anlar (döngünün kesri) bir döngü sonra yeniden çizilir, aynı çıkmalıdır */
const PERIOD_AT = [0.2, 0.5, 0.7, 0.88];
/** Canlı biçimden karşılaştırma kareleri (sn; 14 sn'lik canlı döngüde büyüme, bekleme, erime) */
const LIVE_AT = [1.4, 3.5, 6.3, 8.4, 12.3, 13.0];

// ---------- Çizim (gizli Electron penceresi) ----------

async function bundlePage() {
  const vitePkg = requireDesktop.resolve('vite/package.json');
  const vite = await import(pathToFileURL(path.join(path.dirname(vitePkg), 'dist/node/index.js')).href);
  await vite.build({
    configFile: false,
    root: here,
    logLevel: 'warn',
    resolve: { alias: { '@diskort/client-core': path.join(here, 'client-core-shim.ts') } },
    build: {
      outDir: TMP,
      emptyOutDir: false,
      minify: false,
      lib: { entry: path.join(here, 'page.ts'), formats: ['iife'], name: 'CosmeticRenderPage', fileName: () => 'page.js' },
    },
  });
  const page = path.join(TMP, 'page.html');
  fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>kozmetik çizimi</title><script src="page.js"></script>');
  return page;
}

function runElectron(spec) {
  const jobsFile = path.join(TMP, 'jobs.json');
  const resultFile = path.join(TMP, 'result.json');
  fs.writeFileSync(jobsFile, JSON.stringify(spec));
  fs.rmSync(resultFile, { force: true });
  const electron = requireDesktop('electron');
  const env = { ...process.env };
  // Bu betik başka bir Electron uygulamasının içinden çalıştırılmış olabilir: Electron düğüm gibi davranmasın
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(here, 'electron-main.cjs'), jobsFile, resultFile], { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code) => {
      const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null;
      if (code !== 0 || !result || result.error) reject(new Error(`çizim başarısız (çıkış ${code}): ${result?.error ?? 'sonuç yok'}`));
      else resolve(result.results);
    });
  });
}

// ---------- Kare ölçümleri ----------

/**
 * İki karenin farkı: alfayla çarpılmış renk ve alfa üzerinden (0-255) ortalama mutlak fark ve en büyük fark.
 * (Saydam piksellerin düz rengi anlamsızdır; ekranda görünen, alfayla çarpılmış değerdir.)
 */
function frameDiff(a, b) {
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3];
    const ba = b[i + 3];
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((a[i + c] * aa - b[i + c] * ba) / 255);
      sum += d;
      if (d > max) max = d;
    }
    const d = Math.abs(aa - ba);
    sum += d;
    if (d > max) max = d;
  }
  return { mean: sum / a.length, max };
}

/** Döngünün dikişi: son kare → ilk kare farkı, komşu karelerin farklarıyla birlikte */
function seamStats(frames) {
  const n = frames.length;
  const neighbours = [];
  for (let i = 0; i + 1 < n; i++) neighbours.push(frameDiff(frames[i], frames[i + 1]).mean);
  const sorted = [...neighbours].sort((x, y) => x - y);
  const seam = frameDiff(frames[n - 1], frames[0]);
  const round = (x) => Number(x.toFixed(4));
  return {
    seamMean: round(seam.mean),
    seamMax: round(seam.max),
    neighbourMedian: round(sorted[Math.floor(sorted.length / 2)]),
    neighbourMean: round(neighbours.reduce((s, x) => s + x, 0) / neighbours.length),
    neighbourMax: round(sorted[sorted.length - 1]),
    neighbourMin: round(sorted[0]),
  };
}

/** Karenin kaba özeti (boş ya da tümüyle opak kare yakalansın diye) */
function coverage(frame) {
  let opaque = 0;
  let clear = 0;
  let alpha = 0;
  for (let i = 3; i < frame.length; i += 4) {
    const a = frame[i];
    alpha += a;
    if (a === 255) opaque++;
    else if (a === 0) clear++;
  }
  const px = frame.length / 4;
  return { opaque: Number((opaque / px).toFixed(3)), clear: Number((clear / px).toFixed(3)), meanAlpha: Number((alpha / px / 255).toFixed(3)) };
}

function splitFrames(buf, width, height, count) {
  const size = width * height * 4;
  if (buf.length !== size * count) throw new Error(`ham dosya boyutu uymuyor: ${buf.length} ≠ ${size} × ${count}`);
  return Array.from({ length: count }, (_, i) => buf.subarray(i * size, (i + 1) * size));
}

// ---------- Kodlama ----------

/** Kare süreleri (ms, tam sayı): WebP milisaniye tutar; 60 kare/sn'de 17,17,16 sırasıyla toplam tam döngü süresi */
function delays(count, fps) {
  return Array.from({ length: count }, (_, i) => Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps));
}

async function encodeWebp(sharp, frames, width, height, fps, quality, file) {
  const started = Date.now();
  const raw = Buffer.concat(frames);
  const options = { effort: EFFORT, loop: 0, delay: delays(frames.length, fps) };
  if (quality.lossless) options.lossless = true;
  else Object.assign(options, { quality: quality.quality, alphaQuality: quality.alphaQuality });
  await sharp(raw, { raw: { width, height: height * frames.length, channels: 4, pageHeight: height }, limitInputPixels: false })
    .webp(options)
    .toFile(file);
  // Kodlanan dosyayı geri oku: kare sayısı, süreler ve dikiş dosyanın kendisinde de doğrulansın
  const meta = await sharp(file, { animated: true, limitInputPixels: false }).metadata();
  const decoded = await sharp(file, { animated: true, limitInputPixels: false }).ensureAlpha().raw().toBuffer();
  const pages = meta.pages ?? 1;
  const total = (meta.delay ?? []).reduce((s, d) => s + d, 0);
  return {
    bytes: fs.statSync(file).size,
    frames: pages,
    durationMs: total,
    loop: meta.loop,
    encodeMs: Date.now() - started,
    // Kodlayıcı art arda aynı kareleri tek karede birleştirir (süresi uzar): kare sayısı kaynaktan az olabilir
    seam: seamStats(splitFrames(decoded, width, height, pages)),
  };
}

/** Kareleri yan yana dizip düz bir zemine basar (gözle kontrol: saçak, kare kenarı, boş kare) */
async function contactSheet(sharp, frames, width, height, background, file) {
  const gap = 8;
  const sheet = sharp({
    create: { width: frames.length * (width + gap) + gap, height: height + gap * 2, channels: 4, background },
  }).composite(frames.map((f, i) => ({ input: Buffer.from(f), raw: { width, height, channels: 4 }, left: gap + i * (width + gap), top: gap })));
  await sheet.png().toFile(file);
}

// ---------- Akış ----------

const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

async function main() {
  const sharp = requireServer('sharp');
  fs.mkdirSync(TMP, { recursive: true });
  const setDir = path.join(OUT, SET);
  const stillDir = path.join(setDir, 'stills');
  fs.rmSync(setDir, { recursive: true, force: true });
  fs.mkdirSync(stillDir, { recursive: true });

  console.log(`Set: ${SET}, döngü ${LOOP} sn, ${FPS.join('/')} kare/sn, kalite ${QUALITIES.map((q) => q.label).join(', ')}, gürültü: ${DITHER}`);
  console.log('Sayfa paketleniyor...');
  const page = await bundlePage();

  const count = Math.round(LOOP * MASTER_FPS);
  const jobs = [];
  for (const id of PIECES) {
    const spec = PIECE_SPECS[id];
    const base = { set: SET, kind: spec.kind, w: spec.w, h: spec.h, dpr: DPR, glScale: spec.glScale, R: spec.R, geo: spec.geo };
    // döngünün kareleri
    jobs.push({ ...base, loop: LOOP, dither: DITHER, times: Array.from({ length: count }, (_, i) => i / MASTER_FPS), out: path.join(TMP, `${id}.rgba`) });
    // döngüsellik denetimi: aynı anlar, bir döngü sonra
    jobs.push({ ...base, loop: LOOP, dither: DITHER, times: PERIOD_AT.flatMap((s) => [s * LOOP, s * LOOP + LOOP]), out: path.join(TMP, `${id}-period.rgba`) });
    // canlı biçimden karşılaştırma kareleri
    jobs.push({ ...base, loop: null, dither: 'frame', times: LIVE_AT, out: path.join(TMP, `${id}-live.rgba`) });
  }
  console.log('Çiziliyor (gizli pencere)...');
  const results = await runElectron({ workDir: TMP, page, jobs });

  const manifest = {
    generatedAt: new Date().toISOString(),
    set: SET,
    setInfo: { accent: COSMETIC_SET_INFO[SET].accent, from: COSMETIC_SET_INFO[SET].from, to: COSMETIC_SET_INFO[SET].to },
    loopSeconds: LOOP,
    dither: DITHER,
    effort: EFFORT,
    dpr: DPR,
    renderer: results[0].renderer,
    pieces: [],
  };

  for (let pi = 0; pi < PIECES.length; pi++) {
    const id = PIECES[pi];
    const spec = PIECE_SPECS[id];
    const [loopRes, periodRes, liveRes] = results.slice(pi * 3, pi * 3 + 3);
    const { width, height } = loopRes;
    const frames = splitFrames(fs.readFileSync(path.join(TMP, `${id}.rgba`)), width, height, count);
    const period = splitFrames(fs.readFileSync(path.join(TMP, `${id}-period.rgba`)), width, height, periodRes.frames);
    const live = splitFrames(fs.readFileSync(path.join(TMP, `${id}-live.rgba`)), width, height, liveRes.frames);

    const seam = seamStats(frames);
    const periodCheck = PERIOD_AT.map((s, i) => ({ at: s, ...frameDiff(period[i * 2], period[i * 2 + 1]) }));
    const stillIdx = STILL_AT.map((s) => Math.min(count - 1, Math.round(s * count)));
    const stills = stillIdx.map((i) => frames[i]);
    const piece = {
      id,
      label: spec.label,
      kind: spec.kind,
      css: { w: spec.w, h: spec.h },
      px: { w: width, h: height },
      R: spec.R ?? null,
      geo: spec.geo ?? null,
      sourceSeam: seam,
      periodCheck: periodCheck.map((p) => ({ at: p.at, mean: Number(p.mean.toFixed(4)), max: Number(p.max.toFixed(2)) })),
      coverage: stillIdx.map((i) => ({ t: Number((i / MASTER_FPS).toFixed(3)), ...coverage(frames[i]) })),
      stills: [],
      files: [],
    };
    console.log(`\n${spec.label} (${width}×${height}, ${count} kare @${MASTER_FPS})`);
    console.log(`  dikiş (kaynak kareler): son→ilk ${seam.seamMean} (en büyük ${seam.seamMax}); komşu kareler ortanca ${seam.neighbourMedian}, ortalama ${seam.neighbourMean}, en büyük ${seam.neighbourMax}`);
    console.log(`  döngüsellik (t ile t+${LOOP}): ${piece.periodCheck.map((p) => `${p.at}: ort ${p.mean}, en büyük ${p.max}`).join(' | ')}`);

    // Gözle kontrol kareleri: koyu ve açık zeminde yan yana (saçak ve kare kenarı açık zeminde belli olur)
    for (const [name, list] of [['loop', stills], ['live', live]]) {
      for (const [bgName, bg] of [['dark', { r: 11, g: 11, b: 11, alpha: 1 }], ['light', { r: 190, g: 196, b: 204, alpha: 1 }]]) {
        const file = path.join(stillDir, `${SET}-${id}-${name}-${bgName}.png`);
        await contactSheet(sharp, list, width, height, bg, file);
        piece.stills.push(path.relative(OUT, file).replaceAll('\\', '/'));
      }
    }
    // tek bir kare, olduğu gibi (alfalı PNG)
    await sharp(Buffer.from(stills[3]), { raw: { width, height, channels: 4 } }).png().toFile(path.join(stillDir, `${SET}-${id}-frame.png`));

    for (const fps of FPS) {
      const step = MASTER_FPS / fps;
      const sub = frames.filter((_, i) => i % step === 0);
      for (const q of QUALITIES) {
        const name = `${SET}-${id}-${fps}fps-${q.label}.webp`;
        const r = await encodeWebp(sharp, sub, width, height, fps, q, path.join(setDir, name));
        piece.files.push({ file: `${SET}/${name}`, fps, quality: q.label, ...r });
        const s = r.seam;
        console.log(
          `  ${name}: ${fmtBytes(r.bytes)}, ${r.frames} kare, ${r.durationMs} ms, kodlama ${(r.encodeMs / 1000).toFixed(1)} sn` +
            `; dikiş son→ilk ${s.seamMean}, komşu ortanca ${s.neighbourMedian} / en büyük ${s.neighbourMax}`,
        );
      }
    }
    manifest.pieces.push(piece);
  }

  fs.writeFileSync(path.join(OUT, 'manifest.js'), `window.COSMETIC_RENDER = ${JSON.stringify(manifest, null, 2)};\n`);
  fs.copyFileSync(path.join(here, 'preview.html'), path.join(OUT, 'index.html'));
  if (!args['keep-raw']) fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log(`\nÖnizleme: ${path.join(OUT, 'index.html')}`);
}

await main();
