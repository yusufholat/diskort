// Hareketli kozmetik setlerini ÖNCEDEN çizer: bir setin üç parçasını (avatar dekorasyonu, isim plakası, profil
// kartı efekti) dikişsiz döngü olarak kare kare çizip alfalı hareketli WebP'ye, AVIF'e ve videoya (ffmpeg ile)
// kodlar. Yalnızca geliştirme aracıdır (canlı çizim yerine sunucudan indirilen hazır döngüler); uygulamaya girmez.
//
//   node scripts/cosmetic-render/render.mjs [seçenekler]
//     --set all                 set(ler): "all" (döngü biçimi olan her set), tek set ya da virgüllü liste.
//                               Döngü biçimi olmayan set atlanır (client-core COSMETIC_LOOP_SHADERS)
//     --check                   yalnızca çiz ve ölç (kesintisizlik, dikiş, döngüsellik); kodlama ve önizleme yok.
//                               Kesme bulunursa çıkış kodu 2. Yeni bir setin döngü biçimi bununla denetlenir
//     --live-only               yalnızca canlı biçimden kareler çizilir ve özetleri (sha256) basılır: bir
//                               değişiklikten önce ve sonra çalıştırılıp uygulamanın çizdiğinin değişmediği görülür
//     --loop 6                  döngü süresi, saniye (verilmezse COSMETIC_LOOP_SECONDS)
//     --fps 30                  kare hızları, ör. 60,30 (en yükseği çizilir, diğerleri ondan seçilir). Standart: 30
//     --quality 60/75           WebP kalite ayarları, ör. 85,60/75,45/50: renk kalitesi, isteğe bağlı "/alfa
//                               kalitesi" (verilmezse 100: alfa kayıpsız), ya da "lossless"
//     --pieces deco,plate,card  parçalar (card: standart kart tuvali; cardfit: masaüstü kartına oturan eski ölçü)
//     --video <biçim:crf,...>   video biçimleri (bkz. video.mjs: vp9a, sh264, svp9, sav1, avif); "none": yalnızca
//                               WebP. Verilmezse parçaya göre: kart → sh264:21,avif:37; dekorasyon, plaka → avif:37
//     --video-pieces card,deco  --video'nun uygulanacağı parçalar (verilmezse hepsi)
//     --ffmpeg <yol>            ffmpeg (verilmezse PATH'te aranır; bağımlılık olarak eklenmez)
//     --dither static           bantlaşma gürültüsü: static (karelerde aynı), frame (canlıdaki gibi), off
//     --effort 4                WebP kodlama çabası (0-6; 6, kayıpsız alfayla dakikalar sürer, kazancı az)
//     --dpr 2                   css pikseli başına tuval pikseli (uygulamada en fazla 2)
//     --jump 4                  kesintisizlik eşiği: bir karenin farkı çevresinin ortancasının kaç katıysa kesme sayılır
//     --out <klasör>            çıktı klasörü (verilmezse scripts/cosmetic-render/out; git'e girmez)
//     --keep-raw                ham kareleri (.tmp) silme
//     --no-verify               oynatma doğrulamasını atla
//
// Nasıl çalışır: page.ts (masaüstünün gerçek layers.ts'i ve client-core'un gerçek gölgelendiricileri) Vite ile
// tek dosyaya paketlenir, GİZLİ bir Electron penceresinde açık zaman değerleriyle çizilir, ham kareler burada
// sharp (libwebp) ve ffmpeg ile kodlanır. Sonra her dosya yine gizli pencerede gerçekten oynatılır
// (verify.html): kareler geri okunup kaynakla karşılaştırılır. Yeni bağımlılık eklemez: Electron ve Vite
// masaüstü uygulamasının, sharp sunucunun bağımlılığıdır (önce `pnpm install`); ffmpeg PATH'ten.
//
// Sete özgü ayarlar tek yerde: sets/<set>.mjs (yoksa varsayılanlar). Bkz. sets/buz.mjs.
//
// Çıktı: <out>/index.html (önizleme sayfası, çift tıklayıp aç; klasörde hangi setler varsa onları gösterir),
// <out>/sets.js (set listesi), <out>/<set>/manifest.js, <out>/<set>/media.js (yığılmış alfalı videoların gömülü
// kopyası: dosyadan açılan sayfada WebGL başka dosyanın piksellerini okuyamaz),
// <out>/<set>/*.webp|avif|mp4|webm, <out>/<set>/stills/*.png (gözle kontrol kareleri).
//
// Notlar (buz setiyle ölçüldü):
// - Gürültü: canlıdaki gibi her karede değişen gürültü dosyayı ~%11-14 büyütür (kareler arası fark yalnızca
//   gürültüden gelir); sabit gürültü, gürültüsüzle aynı boyutu verir ve bantlaşmayı yine kırar. Varsayılan: static.
// - Hareketli WebP kareler arası tahmin yapmaz (video değildir): boyutun çoğu alfa kanalıdır (kayıpsız saklanır).
//   Alfa kalitesi 100'ün altına inince alfa daha az düzeye yuvarlanır (75: 56 düzey, 50: 12 düzey).
// - Video (standart kart tuvali 600×900, 30 kare/sn, 6 sn): WebP q60/alfa 75 ile aynı kalitede (PSNR ~47 dB)
//   WebP 6.0 MB; VP9+alfa 1.0 MB; AVIF 0.43 MB; yığılmış alfa H.264 0.46 MB, VP9 0.59 MB, AV1 0.28 MB.
//   Hepsi Electron'da (Chromium) çözülüp oynadı; yığılmış videonun iki yarısı arasında ölçülebilir sızıntı yok.
// - page.ts'in tip kontrolü: apps/desktop/node_modules/.bin/tsc -p scripts/cosmetic-render/tsconfig.json

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { continuityCheck, continuityFromSeries, continuitySummary } from './continuity.mjs';
import { encodeVideo, findFfmpeg, parseVideoSpec, VIDEO_FORMATS, writeStacked } from './video.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const requireDesktop = createRequire(path.join(root, 'apps/desktop/package.json'));
const requireServer = createRequire(path.join(root, 'apps/server/package.json'));

// ---------- Seçenekler ----------

const FLAGS = new Set(['keep-raw', 'no-verify', 'check', 'live-only']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`bilinmeyen parametre: ${a}`);
    const key = a.slice(2);
    if (FLAGS.has(key)) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
// Standart döngü süresi tek yerde: client-core (düz TypeScript; Node 22.18+ doğrudan okur)
const { COSMETIC_LOOP_SECONDS } = await import(pathToFileURL(path.join(root, 'packages/client-core/src/cosmeticShaders/loop.ts')).href);
const { COSMETIC_SET_INFO } = await import(pathToFileURL(path.join(root, 'packages/client-core/src/cosmeticSets.ts')).href);

const ALL_SETS = Object.keys(COSMETIC_SET_INFO);
const SETS = (args.set ?? 'all') === 'all' ? ALL_SETS : args.set.split(',');
const LOOP = Number(args.loop ?? COSMETIC_LOOP_SECONDS);
const FPS = (args.fps ?? '30').split(',').map(Number).sort((a, b) => b - a);
/** Kalite ayarı: renk kalitesi ve alfa kalitesi (100: alfa kayıpsız), ya da tümüyle kayıpsız */
const QUALITIES = (args.quality ?? '60/75').split(',').map((token) => {
  if (token === 'lossless') return { label: 'lossless', lossless: true };
  const [q, a = '100'] = token.split('/');
  const quality = Number(q);
  const alphaQuality = Number(a);
  for (const x of [quality, alphaQuality]) if (!Number.isInteger(x) || x < 0 || x > 100) throw new Error(`kalite 0-100 arası tam sayı olmalı: ${token}`);
  return { label: alphaQuality === 100 ? `q${quality}` : `q${quality}a${alphaQuality}`, quality, alphaQuality };
});
const MODE = args['live-only'] ? 'live' : args.check ? 'check' : 'full';
// Canlı karşılaştırmada masaüstü kartına oturan ölçü de çizilir (avatar deliği ve alt kenar da görülsün)
const PIECES = (args.pieces ?? (MODE === 'live' ? 'deco,plate,card,cardfit' : 'deco,plate,card')).split(',');
/**
 * Video biçimleri ve kalite noktaları: ileride kullanılacak olanlar varsayılan (kart tek seferde bir tane oynar:
 * her platformda çalışabilecek yığılmış alfa H.264 ve AVIF; dekorasyon ve plaka listelerde çok sayıda oynar:
 * AVIF). Kalite noktaları WebP q60/alfa 75 ile aynı ölçülen kalitedir (buz kartında seçildi). Öbür biçimler
 * --video ile: ör. vp9a:30,vp9a:42,sh264:21,sh264:28,svp9:27,svp9:40,sav1:36,sav1:48,avif:37,avif:46
 */
const VIDEO_DEFAULTS = { card: 'sh264:21,avif:37', cardfit: 'sh264:21,avif:37', deco: 'avif:37', plate: 'avif:37' };
const VIDEO_PIECES = args['video-pieces'] ? args['video-pieces'].split(',') : null;
function videoFor(piece) {
  if (VIDEO_PIECES && !VIDEO_PIECES.includes(piece)) return [];
  return parseVideoSpec(args.video ?? VIDEO_DEFAULTS[piece] ?? 'none');
}
const DITHER = args.dither ?? 'static';
const EFFORT = Number(args.effort ?? 4);
const DPR = Number(args.dpr ?? 2);
const JUMP = Number(args.jump ?? 4);
const OUT = path.resolve(args.out ?? path.join(here, 'out'));
const TMP = path.join(OUT, '.tmp');

for (const set of SETS) if (!COSMETIC_SET_INFO[set]) throw new Error(`bilinmeyen set: ${set} (${ALL_SETS.join(', ')})`);
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
  // STANDART KART TUVALİ: 300×450 css (2:3), kartın genişliğine ölçeklenir ve ÜSTE yaslanır. Kısa kart alttan
  // kırpar; uzun kartta efekt son %20'de (360→450) yumuşakça saydama iner, kart altında devam eder.
  // - Afiş: genişliğin 6/17'si (masaüstünde 106/298, telefonda afiş resmi 17:6) → 106.
  // - Avatar deliği YOK (yarıçap eksi: avatarHole her yerde 1). Avatarın yeri platforma göre değişir (masaüstü
  //   solda (62,112), telefon solda (56, afiş altı), ayarlarda ortada): efekt avatarın yerini bilmemeli, uygulama
  //   avatarı efektin üstüne çizmeli (ya da kendi avatar yerine maske uygulamalı).
  // - Kartın alt kenarına bağlı hiçbir şey olmamalı. Alt kenara bir şey çizen set, yerleşim yüksekliğini
  //   (layoutH) tuvalden uzun verip onu tuvalin dışında bırakabilir (bkz. sets/buz.mjs).
  card: { label: 'Profil kartı efekti (standart tuval)', kind: 'card', w: 300, h: 450, fade: { from: 360, to: 450 }, glScale: 0.75, geo: { bh: 106, ax: 0, ay: 0, ar: -100 } },
  // Eski ölçü: masaüstü kartına birebir oturan (CardEffectCanvas: kart w-[300px] − kenarlık 2 = 298 px; afiş
  // h-[106px]; avatar merkezi (62, 112), dış yarıçap 46; roller ve düğmesi olan tipik kart ~340 px), avatar delikli
  cardfit: { label: 'Profil kartı efekti (masaüstü kartına oturan)', kind: 'card', w: 298, h: 340, glScale: 0.75, geo: { bh: 106, ax: 62, ay: 112, ar: 46 } },
};
for (const p of PIECES) if (!PIECE_SPECS[p]) throw new Error(`bilinmeyen parça: ${p}`);

/** Gözle kontrol karelerinin anları (döngünün kesri) */
const STILL_AT = [0.1, 0.25, 0.45, 0.62, 0.85, 0.93];
/** Döngüsellik denetimi: bu anlar (döngünün kesri) bir döngü sonra yeniden çizilir, aynı çıkmalıdır */
const PERIOD_AT = [0.2, 0.5, 0.7, 0.88];
/** Canlı biçimden karşılaştırma karelerinin anları (sn); set kendi anlarını verebilir (sets/<set>.mjs liveAt) */
const LIVE_AT = [1, 3, 5, 7, 9, 11];

/**
 * Sete özgü ayarlar: sets/<set>.mjs (varsayılan dışa aktarım). Alanlar (hepsi isteğe bağlı):
 * - liveAt: canlı karşılaştırma karelerinin anları;
 * - pieces: parça ayarlarının üstüne yazılanlar, ör. { card: { layoutH: 540 } };
 * - continuity: { shaderOptions, note }: set BİLEREK ani olaylar içeriyorsa (ör. neon titremesi), kesintisizlik
 *   denetimi bu seçeneklerle (olaylar kapalı) ayrıca çizilen karelerde de yapılır; "kesme yok" kararı ona göre.
 */
async function loadSetConfig(set) {
  const file = path.join(here, 'sets', `${set}.mjs`);
  if (!fs.existsSync(file)) return {};
  return (await import(pathToFileURL(file).href)).default ?? {};
}

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

// Electron süreci bu betikten uzun yaşamamalı (yetim kalıp ekranda bir şey göstermesin): betik nasıl biterse
// bitsin (olağan çıkış, hata, Ctrl+C, çıktı borusunun kapanması) çocuk öldürülür. Betik zorla öldürülürse
// (hiçbir işleyici çalışmaz) çocuk bunu kendisi fark eder: aradaki kanal kapanır, ayrıca başlatanın süreç
// numarasını yoklar (electron-main.cjs).
const children = new Set();
function killChildren() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // zaten kapanmış
    }
  }
}
process.on('exit', killChildren);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    killChildren();
    process.exit(130);
  });
}
// Çıktımızı okuyan gitti (ör. boru kapandı): sessizce devam etmek yerine dur
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => {
    killChildren();
    process.exit(1);
  });
}

function runElectron(spec) {
  const jobsFile = path.join(TMP, 'jobs.json');
  const resultFile = path.join(TMP, 'result.json');
  fs.writeFileSync(jobsFile, JSON.stringify({ ...spec, parentPid: process.pid }));
  fs.rmSync(resultFile, { force: true });
  const electron = requireDesktop('electron');
  const env = { ...process.env };
  // Bu betik başka bir Electron uygulamasının içinden çalıştırılmış olabilir: Electron düğüm gibi davranmasın
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    // Çıktı doğrudan bizim çıktımıza bağlanmaz: borudan okunup aktarılır (bizim çıktımız kapanırsa çocuk değil
    // biz etkileniriz). Dördüncü kanal (ipc) yalnızca "başlatan hâlâ burada" bilgisini taşır.
    const child = spawn(electron, [path.join(here, 'electron-main.cjs'), jobsFile, resultFile], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env, windowsHide: true });
    children.add(child);
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('error', (err) => {
      children.delete(child);
      reject(err);
    });
    child.on('exit', (code) => {
      children.delete(child);
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

/** Bir karenin (düz RGBA) dikdörtgen parçası */
function cropFrame(frame, width, rect) {
  const out = Buffer.alloc(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    const from = ((rect.y + y) * width + rect.x) * 4;
    frame.copy(out, y * rect.w * 4, from, from + rect.w * 4);
  }
  return out;
}

// ---------- Akış ----------

const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);
const rel = (file) => path.relative(OUT, file).replaceAll('\\', '/');
const BACKGROUNDS = [['dark', { r: 11, g: 11, b: 11, alpha: 1 }], ['light', { r: 190, g: 196, b: 204, alpha: 1 }]];

/** Kalite karşılaştırmasında kırpılan bölge (tuval pikseli): kartta sağ üst köşe, öbürlerinde tüm kare */
function qualityCrop(id, width, height) {
  if (!id.startsWith('card')) return { x: 0, y: 0, w: width, h: height };
  const w = Math.min(width, Math.round(width * 0.55));
  const h = Math.min(height, Math.round(width * 0.55));
  return { x: width - w, y: 0, w, h };
}

/** Bir setin parça ayarları: ortak ölçüler + sete özgü olanlar */
function pieceSpec(id, config) {
  return { ...PIECE_SPECS[id], ...(config.pieces?.[id] ?? {}) };
}

/** Bir parçanın çizim işleri. Dönen: işler ve her işin ne olduğu (sonuçlar aynı sırayla gelir) */
function pieceJobs(set, id, config) {
  const spec = pieceSpec(id, config);
  const count = Math.round(LOOP * MASTER_FPS);
  const base = { set, kind: spec.kind, w: spec.w, h: spec.h, layoutH: spec.layoutH, fade: spec.fade, dpr: DPR, glScale: spec.glScale, R: spec.R, geo: spec.geo };
  const times = Array.from({ length: count }, (_, i) => i / MASTER_FPS);
  const file = (tag) => path.join(TMP, `${set}-${id}${tag ? `-${tag}` : ''}.rgba`);
  const jobs = [];
  if (MODE !== 'live') {
    // döngünün kareleri
    jobs.push({ role: 'loop', job: { ...base, loop: LOOP, dither: DITHER, times, out: file('') } });
    // döngüsellik denetimi: aynı anlar, bir döngü sonra
    jobs.push({ role: 'period', job: { ...base, loop: LOOP, dither: DITHER, times: PERIOD_AT.flatMap((s) => [s * LOOP, s * LOOP + LOOP]), out: file('period') } });
    // kesintisizlik denetimi için, bilerek konmuş ani olaylar kapalıyken aynı kareler
    if (config.continuity?.shaderOptions) jobs.push({ role: 'cont', job: { ...base, loop: LOOP, dither: DITHER, times, shaderOptions: config.continuity.shaderOptions, out: file('cont') } });
  }
  // canlı biçimden karşılaştırma kareleri
  if (MODE !== 'check') jobs.push({ role: 'live', job: { ...base, loop: null, dither: 'frame', times: config.liveAt ?? LIVE_AT, out: file('live') } });
  return jobs;
}

/** Kaynak karelerin ölçümleri: dikiş, döngüsellik, kesintisizlik. Çıktıya da yazar. */
function measure(id, spec, frames, width, height, period, contFrames, config) {
  const seam = seamStats(frames);
  const periodCheck = PERIOD_AT.map((s, i) => {
    const d = frameDiff(period[i * 2], period[i * 2 + 1]);
    return { at: s, mean: Number(d.mean.toFixed(4)), max: Number(d.max.toFixed(2)) };
  });
  const continuity = continuityCheck(frames, width, height, MASTER_FPS, { threshold: JUMP });
  const continuityClean = contFrames ? continuityCheck(contFrames, width, height, MASTER_FPS, { threshold: JUMP }) : null;
  console.log(`\n${spec.label} [${id}] (${width}×${height}, ${frames.length} kare @${MASTER_FPS})`);
  console.log(`  dikiş (kaynak kareler): son→ilk ${seam.seamMean} (en büyük ${seam.seamMax}); komşu kareler ortanca ${seam.neighbourMedian}, ortalama ${seam.neighbourMean}, en büyük ${seam.neighbourMax}`);
  console.log(`  döngüsellik (t ile t+${LOOP}): ${periodCheck.map((p) => `${p.at}: ort ${p.mean}, en büyük ${p.max}`).join(' | ')}`);
  console.log(`  kesintisizlik: ${continuitySummary(continuity)}`);
  if (continuityClean) console.log(`  kesintisizlik (${config.continuity.note ?? 'bilerek konmuş ani olaylar kapalı'}): ${continuitySummary(continuityClean)}`);
  return { seam, periodCheck, continuity, continuityClean };
}

/** Bir seti çizer, ölçer, kodlar, doğrular. Dönen: { flagged } (kesintisizlik denetiminde kesme bulundu mu) */
async function renderSet(set, ctx) {
  const { sharp, ffmpeg, page } = ctx;
  const config = await loadSetConfig(set);
  const setDir = path.join(OUT, set);
  const stillDir = path.join(setDir, 'stills');
  if (MODE === 'full') {
    fs.rmSync(setDir, { recursive: true, force: true });
    fs.mkdirSync(stillDir, { recursive: true });
  }
  console.log(`\n======== ${set} ========`);

  const plan = PIECES.map((id) => ({ id, jobs: pieceJobs(set, id, config) }));
  console.log('Çiziliyor (gizli pencere)...');
  const results = await runElectron({ mode: 'render', workDir: TMP, page, jobs: plan.flatMap((p) => p.jobs.map((j) => j.job)) });
  let cursor = 0;
  for (const p of plan) for (const j of p.jobs) j.result = results[cursor++];

  const count = Math.round(LOOP * MASTER_FPS);
  const load = (j) => splitFrames(fs.readFileSync(j.job.out), j.result.width, j.result.height, j.result.frames);

  if (MODE === 'live') {
    // Canlı biçimin kareleri: özetleri basılır (bir değişiklikten önce ve sonra aynı olmalı)
    for (const p of plan) {
      const j = p.jobs.find((x) => x.role === 'live');
      console.log(`  canlı ${set}-${p.id}: ${j.result.width}×${j.result.height} × ${j.result.frames} kare, sha256 ${createHash('sha256').update(fs.readFileSync(j.job.out)).digest('hex')}`);
    }
    return { flagged: false };
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    set,
    setInfo: { accent: COSMETIC_SET_INFO[set].accent, from: COSMETIC_SET_INFO[set].from, to: COSMETIC_SET_INFO[set].to },
    loopSeconds: LOOP,
    fps: FPS,
    dither: DITHER,
    effort: EFFORT,
    dpr: DPR,
    renderer: results[0].renderer,
    ffmpeg: ffmpeg?.version ?? null,
    pieces: [],
  };
  /** Oynatma doğrulamasına girecek dosyalar */
  const verifyItems = [];
  /** Yığılmış alfalı videolar: önizleme sayfasına gömülür */
  const embedded = {};
  let flagged = false;
  /** Sıkıştırmanın kesme eklediği dosyalar */
  const encodedFlags = [];

  for (const p of plan) {
    const id = p.id;
    const spec = pieceSpec(id, config);
    const byRole = Object.fromEntries(p.jobs.map((j) => [j.role, j]));
    const { width, height } = byRole.loop.result;
    const frames = load(byRole.loop);
    const m = measure(id, spec, frames, width, height, load(byRole.period), byRole.cont ? load(byRole.cont) : null, config);
    // "kesme yok" kararı: bilerek konmuş ani olayları olan sette onlar kapalıyken çizilen karelere göre
    if (!(m.continuityClean ?? m.continuity).ok) flagged = true;
    if (MODE === 'check') continue;

    const live = load(byRole.live);
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
      layoutH: spec.layoutH ?? null,
      fade: spec.fade ?? null,
      sourceSeam: m.seam,
      periodCheck: m.periodCheck,
      continuity: m.continuity,
      continuityClean: m.continuityClean,
      continuityNote: config.continuity?.note ?? null,
      coverage: stillIdx.map((i) => ({ t: Number((i / MASTER_FPS).toFixed(3)), ...coverage(frames[i]) })),
      stills: [],
      files: [],
    };

    // Gözle kontrol kareleri: koyu ve açık zeminde yan yana (saçak ve kare kenarı açık zeminde belli olur)
    for (const [name, list] of [['loop', stills], ['live', live]]) {
      for (const [bgName, bg] of BACKGROUNDS) {
        const file = path.join(stillDir, `${set}-${id}-${name}-${bgName}.png`);
        await contactSheet(sharp, list, width, height, bg, file);
        piece.stills.push(rel(file));
      }
    }
    // tek bir kare, olduğu gibi (alfalı PNG)
    await sharp(Buffer.from(stills[3]), { raw: { width, height, channels: 4 } }).png().toFile(path.join(stillDir, `${set}-${id}-frame.png`));

    // Videolar en düşük kare hızında (standart) kodlanır; aynı hızdaki WebP karşılaştırmanın referansıdır
    const videoFps = FPS[FPS.length - 1];
    const videos = ffmpeg ? videoFor(id) : [];
    for (const fps of FPS) {
      const step = MASTER_FPS / fps;
      const sub = frames.filter((_, i) => i % step === 0);
      const source = step === 1 ? byRole.loop.job.out : path.join(TMP, `${set}-${id}-${fps}.rgba`);
      if (step !== 1 && fps === videoFps) fs.writeFileSync(source, Buffer.concat(sub));
      const common = { fps, width, height, sourceFrames: sub.length, source };
      for (const q of QUALITIES) {
        const name = `${set}-${id}-${fps}fps-${q.label}.webp`;
        const r = await encodeWebp(sharp, sub, width, height, fps, q, path.join(setDir, name));
        const entry = { file: `${set}/${name}`, format: 'webp', formatLabel: 'Hareketli WebP', tag: 'img', mime: 'image/webp', stacked: null, fps, quality: q.label, ...r };
        piece.files.push(entry);
        if (fps === videoFps) verifyItems.push({ ...common, piece: id, file: entry.file, path: path.join(setDir, name), mime: entry.mime, tag: 'img', stacked: null, format: 'webp' });
        const s = r.seam;
        console.log(
          `  ${name}: ${fmtBytes(r.bytes)}, ${r.frames} kare, ${r.durationMs} ms, kodlama ${(r.encodeMs / 1000).toFixed(1)} sn` +
            `; dikiş son→ilk ${s.seamMean}, komşu ortanca ${s.neighbourMedian} / en büyük ${s.neighbourMax}`,
        );
      }
      if (fps !== videoFps || videos.length === 0) continue;
      const stackedFile = path.join(TMP, `${set}-${id}-stacked.rgb`);
      const layout = videos.some((v) => VIDEO_FORMATS[v.format].stacked) ? writeStacked(sub, width, height, stackedFile) : null;
      for (const v of videos) {
        const F = VIDEO_FORMATS[v.format];
        const name = `${set}-${id}-${fps}fps-${v.label}.${F.ext}`;
        const out = path.join(setDir, name);
        const r = await encodeVideo(ffmpeg.exe, v, { rgba: source, stacked: stackedFile, width, height, fps, layout, out });
        const entry = {
          file: `${set}/${name}`, format: v.format, formatLabel: F.label, tag: F.tag, mime: F.mime, stacked: F.stacked ? layout : null,
          fps, quality: `crf ${v.crf}`, bytes: r.bytes, frames: sub.length, durationMs: Math.round((sub.length * 1000) / fps), encodeMs: r.encodeMs, ffmpeg: r.ffmpeg,
        };
        piece.files.push(entry);
        verifyItems.push({ ...common, piece: id, file: entry.file, path: out, mime: F.mime, tag: F.tag, stacked: entry.stacked, format: v.format });
        if (F.stacked) embedded[entry.file] = `data:${F.mime};base64,${fs.readFileSync(out).toString('base64')}`;
        console.log(`  ${name}: ${fmtBytes(r.bytes)}, kodlama ${(r.encodeMs / 1000).toFixed(1)} sn`);
      }
    }
    manifest.pieces.push(piece);
  }

  if (MODE === 'check') return { flagged };

  // ---------- Oynatma doğrulaması (gizli pencere): her dosya gerçekten çözülüp oynuyor mu, alfa doğru mu ----------
  if (verifyItems.length > 0 && !args['no-verify']) {
    console.log('\nOynatma doğrulanıyor (gizli pencere)...');
    const dumpDir = path.join(TMP, 'verify');
    fs.mkdirSync(dumpDir, { recursive: true });
    const check = [0.25, 0.45, 0.62, 0.85];
    // döngü zamanlaması: kartın (yoksa ilk video parçasının) her video biçiminin ilk kalite noktası
    const timingPiece = verifyItems.find((i) => i.tag === 'video' && i.piece.startsWith('card'))?.piece ?? verifyItems.find((i) => i.tag === 'video')?.piece;
    const seen = new Set();
    for (const item of verifyItems) {
      item.checkFrames = [0, ...check.map((s) => Math.round(s * item.sourceFrames)), item.sourceFrames - 1];
      item.dumpFrame = Math.round(0.62 * item.sourceFrames);
      item.dump = path.join(dumpDir, `${path.basename(item.path)}.rgba`);
      item.timing = item.tag === 'video' && item.piece === timingPiece && !seen.has(item.format);
      if (item.timing) seen.add(item.format);
    }
    const verified = await runElectron({ mode: 'verify', workDir: TMP, page: path.join(here, 'verify.html'), items: verifyItems, loopSeconds: LOOP });
    const byFile = new Map(verified.map((r) => [r.file, r]));
    for (const piece of manifest.pieces) {
      for (const f of piece.files) {
        const r = byFile.get(f.file);
        if (!r) continue;
        f.verify = r;
        if (r.error) {
          console.log(`  ${f.file}: OYNATILAMADI: ${r.error}`);
          continue;
        }
        // Kodlanmış dosyanın kesintisizliği (tarayıcıda çözülen bütün kareler). Kaynakta zaten işaretli kareler
        // (setin bilerek koyduğu ani olaylar) sayılmaz: geriye kalan, sıkıştırmanın eklediğidir.
        if (r.series && f.fps === MASTER_FPS) {
          const known = [...piece.continuity.level.hot, ...piece.continuity.global.hot];
          r.continuity = continuityFromSeries(r.series.mean, r.series.level, f.fps, { threshold: JUMP }, known);
        }
        delete r.series;
        console.log(
          `  ${f.file.split('/').pop()}: PSNR ${r.psnr} dB, alfa hata ort ${r.alphaMae}; saydam yerde alfa ort ${r.clearAlphaMean} / en büyük ${r.clearAlphaMax}; ` +
            `saçak (düşük alfada parlaklık farkı) ${r.fringe}; dikiş son→ilk ${r.seam}; ekranda oynuyor: ${r.onScreenDiff > 0.05 ? 'evet' : 'HAYIR'} (${r.onScreenDiff})` +
            `; kenar sütunları: renk ${r.edge.color} / alfa ${r.edge.alpha} (tüm kare ${r.edge.allColor} / ${r.edge.allAlpha})` +
            (r.timing
              ? `; döngü başı boşluğu ${r.timing.wrapGapsMs.join(', ')} ms (olağan ${r.timing.typicalMs} ms, en uzun ${r.timing.maxOtherMs} ms, 50 ms üstü ${r.timing.longGaps}), döngü başına kare ${r.timing.framesPerLoop.join(', ')}`
              : ''),
        );
        if (r.continuity) {
          console.log(`    kodlanmış kesintisizlik: ${continuitySummary(r.continuity)}`);
          if (!r.continuity.ok) encodedFlags.push(f.file.split('/').pop());
        }
      }
      // Kalite karşılaştırması: aynı karenin kırpılmış parçası, kaynak ve her dosya yan yana
      const items = verifyItems.filter((i) => i.piece === piece.id && fs.existsSync(i.dump));
      if (items.length === 0) continue;
      const { w: width, h: height } = piece.px;
      const crop = qualityCrop(piece.id, width, height);
      const sourceFrame = splitFrames(fs.readFileSync(items[0].source), width, height, items[0].sourceFrames)[items[0].dumpFrame];
      const tiles = [sourceFrame, ...items.map((i) => fs.readFileSync(i.dump))].map((f) => cropFrame(f, width, crop));
      piece.quality = { order: ['kaynak', ...items.map((i) => path.basename(i.path))], crop, sheets: [] };
      for (const [bgName, bg] of BACKGROUNDS) {
        const file = path.join(stillDir, `${set}-${piece.id}-quality-${bgName}.png`);
        await contactSheet(sharp, tiles, crop.w, crop.h, bg, file);
        piece.quality.sheets.push(rel(file));
      }
    }
  }

  // Her setin kendi dosyaları: önizleme sayfası klasörde hangi setler varsa onları yükler
  fs.writeFileSync(path.join(setDir, 'manifest.js'), `(window.COSMETIC_SETS = window.COSMETIC_SETS || {})[${JSON.stringify(set)}] = ${JSON.stringify(manifest, null, 2)};\n`);
  fs.writeFileSync(path.join(setDir, 'media.js'), `Object.assign((window.COSMETIC_MEDIA = window.COSMETIC_MEDIA || {}), ${JSON.stringify(embedded)});\n`);
  if (encodedFlags.length) console.log(`\n  Sıkıştırmanın kesme eklediği dosyalar: ${encodedFlags.join(', ')}`);
  return { flagged };
}

/** Ham kareleri siler (bir sonraki set için yer açılsın) */
function clearRaw(set) {
  for (const f of fs.readdirSync(TMP)) if (f.startsWith(`${set}-`) && (f.endsWith('.rgba') || f.endsWith('.rgb'))) fs.rmSync(path.join(TMP, f), { force: true });
  fs.rmSync(path.join(TMP, 'verify'), { recursive: true, force: true });
}

async function main() {
  const sharp = requireServer('sharp');
  const needsVideo = MODE === 'full' && PIECES.some((p) => videoFor(p).length > 0);
  const ffmpeg = needsVideo ? findFfmpeg(args.ffmpeg) : null;
  fs.mkdirSync(TMP, { recursive: true });

  console.log(
    MODE === 'live'
      ? `Canlı biçim kareleri: ${SETS.join(', ')} (${PIECES.join(', ')})`
      : `Set: ${SETS.join(', ')}; döngü ${LOOP} sn, ${FPS.join('/')} kare/sn, gürültü: ${DITHER}` + (MODE === 'check' ? '; yalnızca denetim' : `, WebP ${QUALITIES.map((q) => q.label).join(', ')}`),
  );
  if (ffmpeg) console.log(`Video: ${PIECES.map((p) => `${p}: ${videoFor(p).map((v) => v.label).join(', ') || 'yok'}`).join('; ')}; ${ffmpeg.version}`);
  console.log('Sayfa paketleniyor...');
  const page = await bundlePage();

  // Döngü biçimi olan setler (client-core COSMETIC_LOOP_SHADERS): sayfanın kendisine sorulur
  const loopSets = await runElectron({ mode: 'info', workDir: TMP, page });
  const flaggedSets = [];
  const done = [];
  for (const set of SETS) {
    if (MODE !== 'live' && !loopSets.includes(set)) {
      console.log(`\n======== ${set} ========\nAtlandı: "${set}" setinin döngü biçimi yok (client-core cosmeticShaders COSMETIC_LOOP_SHADERS).`);
      continue;
    }
    const r = await renderSet(set, { sharp, ffmpeg, page });
    if (r.flagged) flaggedSets.push(set);
    done.push(set);
    if (!args['keep-raw']) clearRaw(set);
  }

  if (MODE === 'full') {
    // Önizleme: klasördeki bütün setler (bu çalıştırmada çizilmeyenler dahil)
    const present = ALL_SETS.filter((s) => fs.existsSync(path.join(OUT, s, 'manifest.js')));
    fs.writeFileSync(path.join(OUT, 'sets.js'), `window.COSMETIC_SET_LIST = ${JSON.stringify(present)};\n`);
    fs.copyFileSync(path.join(here, 'preview.html'), path.join(OUT, 'index.html'));
    fs.copyFileSync(path.join(here, 'stacked.js'), path.join(OUT, 'stacked.js'));
    // eski tek setli düzenin dosyaları
    for (const old of ['manifest.js', 'media.js']) fs.rmSync(path.join(OUT, old), { force: true });
  }
  if (!args['keep-raw']) fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  if (MODE === 'full') console.log(`\nÖnizleme: ${path.join(OUT, 'index.html')} (setler: ${done.join(', ') || 'yok'})`);
  if (MODE !== 'live') {
    console.log(flaggedSets.length ? `\nKESİNTİSİZLİK DENETİMİ: kesme bulundu: ${flaggedSets.join(', ')}` : '\nKesintisizlik denetimi: kesme yok.');
    if (flaggedSets.length && MODE === 'check') process.exitCode = 2;
  }
}

await main();
