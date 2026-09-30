// Yayın paketleri: çizilmiş setleri sunucuya yüklenecek tek dosyalık paketlere çevirir.
//
//   node scripts/cosmetic-render/pack.mjs [--set all|buz,neon] [--platforms desktop,android,ios] [--out <klasör>]
//   (ya da çizimle birlikte: node scripts/cosmetic-render/render.mjs --pack)
//
// Girdi: render.mjs'in çıktısı (<out>/<set>/manifest.json ve dosyalar). Çıktı: <out>/packs/<id>.bundle.json
// (set başına bir paket) ve <out>/packs/index.json (paketlerin listesi).
//
// Paket biçimi (format 1; sunucu doğrular, değiştirilmemeli):
//   { format: 1,
//     pack: { id, label, accent, from, to, fallback: [3], description, pieces: [3], loopSeconds, fps, platforms },
//     files: [{ piece: card|deco|plate, kind: avif|webp|stacked-h264|poster, name, width, height,
//               stackedWidth?, alphaX?, data: <base64> }] }
// - width / height: görünen karenin pikseli. Yığılmış videoda stackedWidth videonun tam genişliği, alphaX alfa
//   yarısının başladığı x (renk yarısı 0'dan başlar; bkz. video.mjs stackedLayout).
// - Parça başına dosyalar: kart → avif + stacked-h264 + poster; dekorasyon ve plaka → avif + webp + poster.
//   (Masaüstü AVIF'i <img> ile oynatır; telefonun dekorasyon ve plakada WebP'yi, kartta yığılmış videoyu
//   kullanması bekleniyor.)
// - platforms: verilmezse üçü birden (desktop, android, ios).
// - Sınırlar: dosya başına en çok 8 MB (çözülmüş), paket başına en çok 40 MB. Çizim aracı sınırı aşan dosyanın
//   kalitesini düşürür (render.mjs FILE_CAP); burada yalnızca denetlenir.
//
// Sunucunun yayında uyguladığı kurallar burada da denetlenir (checkPack / checkFile): paket yazılmadan önce
// yakalansın diye. Sunucunun kodu değil, kuralların buradaki ayrı bir uygulamasıdır; asıl söz sunucunundur.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const BUNDLE_FORMAT = 1;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 40 * 1024 * 1024;
const ID = /^[a-z][a-z0-9-]{1,23}$/;
const NAME = /^[a-z0-9][a-z0-9.-]{0,39}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const RGB = /^rgba?\([0-9.,%\s/]+\)$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PLATFORMS = ['desktop', 'android', 'ios'];
/** Eski (paket olmayan) efektlerin kimlikleri: paket kimliği olamaz */
const RESERVED_IDS = ['snow', 'sparkles', 'petals'];
const EXTENSION = { avif: '.avif', webp: '.webp', poster: '.webp', 'stacked-h264': '.mp4' };
const MIN_FRAME = 8;
const MAX_FRAME = 2048;
const MAX_STACKED = 4096;

/** Parça başına dağıtılan türler ve pakette görünen dosya adları */
const SHIPPED = {
  card: [
    ['avif', 'card.avif'],
    ['stacked-h264', 'card.mp4'],
  ],
  deco: [
    ['avif', 'deco.avif'],
    ['webp', 'deco.webp'],
  ],
  plate: [
    ['avif', 'plate.avif'],
    ['webp', 'plate.webp'],
  ],
};

const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

// ---- dosya içeriği denetimleri ----

/** Kutunun içindeki alt kutuların başladığı yer (kutu başlığından sonra atlanacak bayt) */
const CHILD_SKIP = { meta: 4, stsd: 8, avc1: 78 };

/** ISO BMFF kutuları: [start, end) aralığını tam örtmeli (artık bayt, taşan kutu yok) */
function boxes(buf, start, end, what) {
  const out = [];
  let p = start;
  while (p < end) {
    if (p + 8 > end) throw new Error(`${what}: kutu başlığı yarım (artık bayt)`);
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let head = 8;
    if (size === 1) {
      if (p + 16 > end) throw new Error(`${what}: kutu başlığı yarım`);
      size = Number(buf.readBigUInt64BE(p + 8));
      head = 16;
    } else if (size === 0) size = end - p;
    if (size < head || p + size > end) throw new Error(`${what}: "${type}" kutusu dosyayı aşıyor`);
    out.push({ type, body: p + head, end: p + size });
    p += size;
  }
  return out;
}

/** Yoldaki bütün kutular, ör. ['moov', 'trak', 'tkhd'] */
function findBoxes(buf, top, pathTypes) {
  let level = top;
  for (let i = 0; i < pathTypes.length; i++) {
    const hit = level.filter((b) => b.type === pathTypes[i]);
    if (i === pathTypes.length - 1) return hit;
    level = hit.flatMap((b) => boxes(buf, b.body + (CHILD_SKIP[b.type] ?? 0), b.end, pathTypes.slice(0, i + 1).join('/')));
  }
  return [];
}

function brands(buf, top) {
  const ftyp = top.find((b) => b.type === 'ftyp');
  if (!ftyp) throw new Error('ftyp kutusu yok');
  const out = [buf.toString('latin1', ftyp.body, ftyp.body + 4)];
  for (let p = ftyp.body + 8; p + 4 <= ftyp.end; p += 4) out.push(buf.toString('latin1', p, p + 4));
  return out;
}

function checkAvif(buf, f) {
  const top = boxes(buf, 0, buf.length, 'avif');
  const b = brands(buf, top);
  if (!b.includes('avif') && !b.includes('avis')) throw new Error(`AVIF değil (markalar: ${b.join(' ')})`);
  if (!top.some((x) => x.type === 'moov')) throw new Error('resim dizisi değil (moov yok): tek kare AVIF');
  const ispe = findBoxes(buf, top, ['meta', 'iprp', 'ipco', 'ispe']);
  if (ispe.length === 0) throw new Error('ispe (boyut) kutusu yok');
  for (const x of ispe) {
    const w = buf.readUInt32BE(x.body + 4);
    const h = buf.readUInt32BE(x.body + 8);
    if (w !== f.width || h !== f.height) throw new Error(`ispe ${w}×${h}, beklenen ${f.width}×${f.height}`);
  }
}

function checkMp4(buf, f) {
  const top = boxes(buf, 0, buf.length, 'mp4');
  brands(buf, top);
  if (findBoxes(buf, top, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'avc1', 'avcC']).length === 0) throw new Error('H.264 değil (avcC yok)');
  const tkhd = findBoxes(buf, top, ['moov', 'trak', 'tkhd']);
  if (tkhd.length !== 1) throw new Error(`tek görüntü izi bekleniyor (${tkhd.length} iz)`);
  // tkhd'nin son sekiz baytı: genişlik ve yükseklik (16.16 sabit noktalı)
  const w = buf.readUInt32BE(tkhd[0].end - 8) / 65536;
  const h = buf.readUInt32BE(tkhd[0].end - 4) / 65536;
  if (w !== f.stackedWidth) throw new Error(`iz genişliği ${w}, stackedWidth ${f.stackedWidth}`);
  if (h < f.height || h > f.height + 15) throw new Error(`iz yüksekliği ${h}, beklenen ${f.height}..${f.height + 15}`);
}

function checkWebp(buf, animated) {
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('WebP değil');
  if (buf.readUInt32LE(4) + 8 !== buf.length) throw new Error(`RIFF uzunluğu (${buf.readUInt32LE(4) + 8}) dosyayı (${buf.length}) tam örtmüyor`);
  const hasAnimation = buf.toString('latin1', 12, 16) === 'VP8X' && (buf[20] & 0x02) !== 0;
  if (animated && !hasAnimation) throw new Error('hareketli WebP değil (animasyon bayrağı yok)');
  if (!animated && hasAnimation) throw new Error('kapak karesi durağan olmalı (animasyon bayrağı var)');
}

/** Bir dosya girdisinin sunucu kurallarına uyduğunu denetler; uymuyorsa hata verir */
export function checkFile(f, data) {
  if (!NAME.test(f.name)) throw new Error('dosya adı geçersiz');
  if (!f.name.endsWith(EXTENSION[f.kind])) throw new Error(`ad "${EXTENSION[f.kind]}" ile bitmeli`);
  if (data.length > MAX_FILE_BYTES) throw new Error(`${fmtBytes(data.length)}: dosya sınırı ${fmtBytes(MAX_FILE_BYTES)} (kalitesi düşürülmeli)`);
  for (const k of ['width', 'height']) if (!Number.isInteger(f[k]) || f[k] < MIN_FRAME || f[k] > MAX_FRAME) throw new Error(`${k} ${f[k]}: ${MIN_FRAME}..${MAX_FRAME} olmalı`);
  if (f.kind === 'stacked-h264') {
    if (!Number.isInteger(f.stackedWidth) || f.stackedWidth > MAX_STACKED || f.stackedWidth < 2 * f.width) throw new Error(`stackedWidth ${f.stackedWidth}: ${2 * f.width}..${MAX_STACKED} olmalı`);
    if (!Number.isInteger(f.alphaX) || f.alphaX < f.width || f.alphaX > f.stackedWidth - f.width) throw new Error(`alphaX ${f.alphaX}: ${f.width}..${f.stackedWidth - f.width} olmalı`);
    checkMp4(data, f);
  } else if (f.kind === 'avif') checkAvif(data, f);
  else checkWebp(data, f.kind === 'webp');
}

/** Paket bilgisinin sunucu kurallarına uyduğunu denetler */
export function checkPack(info) {
  if (!ID.test(info.id)) throw new Error(`paket kimliği geçersiz: ${info.id}`);
  if (RESERVED_IDS.includes(info.id)) throw new Error(`paket kimliği ayrılmış: ${info.id}`);
  for (const key of ['label', 'accent', 'from', 'to', 'description']) if (typeof info[key] !== 'string' || !info[key]) throw new Error(`paket bilgisi eksik: ${key}`);
  if (info.label.length > 40) throw new Error('label en çok 40 karakter');
  if (info.description.length > 400) throw new Error('description en çok 400 karakter');
  if (!Array.isArray(info.fallback) || info.fallback.length !== 3) throw new Error('fallback üç renk olmalı');
  if (!Array.isArray(info.pieces) || info.pieces.length !== 3) throw new Error('pieces üç açıklama olmalı');
  for (const p of info.pieces) if (typeof p !== 'string' || !p || p.length > 160) throw new Error('pieces açıklamaları 1..160 karakter olmalı');
  for (const [key, v] of [['accent', info.accent], ['from', info.from], ['to', info.to], ['fallback[0]', info.fallback[0]], ['fallback[1]', info.fallback[1]]]) {
    if (!HEX.test(v)) throw new Error(`${key} #rrggbb olmalı: ${v}`);
  }
  if (!HEX.test(info.fallback[2]) && !RGB.test(info.fallback[2])) throw new Error(`fallback[2] #rrggbb ya da rgb()/rgba() olmalı: ${info.fallback[2]}`);
}

/** Bir setin paketini kurar; eksik ya da kurala uymayan bir şey varsa hata verir */
export function buildBundle(out, set, platforms) {
  const manifestFile = path.join(out, set, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`"${set}" çizilmemiş: önce node scripts/cosmetic-render/render.mjs --set ${set}`);
  const M = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const info = M.pack;
  try {
    checkPack(info);
  } catch (e) {
    throw new Error(`${set}: ${e.message}`);
  }
  const fps = Math.min(...M.fps);
  const files = [];
  const add = (entry, file) => {
    if (files.some((f) => f.name === entry.name)) throw new Error(`${set}: dosya adı yineleniyor: ${entry.name}`);
    const data = fs.readFileSync(path.join(out, file));
    try {
      checkFile(entry, data);
    } catch (e) {
      throw new Error(`${set}: ${entry.name} (${file}): ${e.message}`);
    }
    const base64 = data.toString('base64');
    if (!BASE64.test(base64)) throw new Error(`${set}: ${entry.name}: base64 bozuk`);
    files.push({ ...entry, data: base64, bytes: data.length });
  };
  for (const [pieceId, kinds] of Object.entries(SHIPPED)) {
    const piece = M.pieces.find((p) => p.id === pieceId);
    if (!piece) throw new Error(`${set}: "${pieceId}" parçası çizilmemiş (render.mjs varsayılan parçalarla çalıştırılmalı)`);
    const { w: width, h: height } = piece.px;
    for (const [kind, name] of kinds) {
      // standart kare hızındaki dosya; aynı türden birden çok kalite varsa ilki (varsayılan kalite)
      const f = piece.files.find((x) => x.kind === kind && x.fps === fps);
      if (!f) throw new Error(`${set}: ${pieceId} için "${kind}" dosyası yok (render.mjs varsayılan biçimlerle çalıştırılmalı)`);
      const entry = { piece: pieceId, kind, name, width, height };
      if (kind === 'stacked-h264') Object.assign(entry, { stackedWidth: f.stacked.width, alphaX: f.stacked.alphaX });
      add(entry, f.file);
    }
    if (!piece.poster) throw new Error(`${set}: ${pieceId} için kapak karesi yok`);
    add({ piece: pieceId, kind: 'poster', name: `${pieceId}-poster.webp`, width, height }, piece.poster.file);
  }
  // üç parça da olmalı ve her birinde video dışında en az bir dosya (kapak / avif / webp) bulunmalı
  for (const pieceId of Object.keys(SHIPPED)) {
    if (!files.some((f) => f.piece === pieceId && f.kind !== 'stacked-h264')) throw new Error(`${set}: ${pieceId} için kapak, avif ya da webp yok`);
  }
  const total = files.reduce((s, f) => s + f.bytes, 0);
  const bundle = {
    format: BUNDLE_FORMAT,
    pack: {
      id: info.id,
      label: info.label,
      accent: info.accent,
      from: info.from,
      to: info.to,
      fallback: info.fallback,
      description: info.description,
      pieces: info.pieces,
      loopSeconds: M.loopSeconds,
      fps,
      platforms,
    },
    // bytes yalnızca tablo içindir: pakete yazılmaz
    files: files.map(({ bytes: _bytes, ...f }) => f),
  };
  const json = JSON.stringify(bundle);
  const jsonBytes = Buffer.byteLength(json);
  if (total > MAX_BUNDLE_BYTES) throw new Error(`${set}: paket ${fmtBytes(total)} (dosya olarak ${fmtBytes(jsonBytes)}): sınır ${fmtBytes(MAX_BUNDLE_BYTES)}`);
  return { bundle, json, jsonBytes, total, table: files.map((f) => ({ name: f.name, piece: f.piece, kind: f.kind, pixels: f.kind === 'stacked-h264' ? `${f.width}×${f.height} (video ${f.stackedWidth}×${f.height})` : `${f.width}×${f.height}`, bytes: f.bytes })) };
}

/** Klasörde çizilmiş olan setlerin paketlerini ve listeyi yazar; tabloyu basar */
export function writeBundles({ out, sets, platforms }) {
  const targets = (typeof platforms === 'string' ? platforms.split(',') : (platforms ?? PLATFORMS)).map((p) => p.trim()).filter(Boolean);
  if (targets.length === 0) throw new Error('en az bir platform verilmeli');
  for (const p of targets) if (!PLATFORMS.includes(p)) throw new Error(`bilinmeyen platform: ${p} (${PLATFORMS.join(', ')})`);
  const dir = path.join(out, 'packs');
  fs.mkdirSync(dir, { recursive: true });
  const index = [];
  for (const set of sets) {
    if (!fs.existsSync(path.join(out, set, 'manifest.json'))) continue;
    const b = buildBundle(out, set, targets);
    const file = `${b.bundle.pack.id}.bundle.json`;
    fs.writeFileSync(path.join(dir, file), b.json);
    index.push({ id: b.bundle.pack.id, label: b.bundle.pack.label, file, bytes: b.jsonBytes, fileBytes: b.total, files: b.bundle.files.length, platforms: targets });
    console.log(`\nPaket: ${b.bundle.pack.id} (${b.bundle.pack.label}) → packs/${file}: ${fmtBytes(b.jsonBytes)} (dosyalar ${fmtBytes(b.total)}), hedef: ${targets.join(', ')}`);
    console.log('  dosya               tür            piksel                        boyut');
    for (const r of b.table) console.log(`  ${r.name.padEnd(19)} ${r.kind.padEnd(14)} ${r.pixels.padEnd(29)} ${fmtBytes(r.bytes).padStart(9)} (${r.bytes})`);
  }
  if (index.length === 0) throw new Error('paketlenecek çizilmiş set yok: önce render.mjs çalıştırılmalı');
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ format: BUNDLE_FORMAT, generatedAt: new Date().toISOString(), bundles: index }, null, 2));
  console.log(`\nPaketler: ${dir} (${index.length} set, index.json); içerik denetimleri geçti`);
  return index;
}

// Komut olarak çalıştırıldığında
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`bilinmeyen parametre: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[++i];
  }
  const out = path.resolve(args.out ?? path.join(here, 'out'));
  const present = fs.existsSync(out) ? fs.readdirSync(out).filter((d) => fs.existsSync(path.join(out, d, 'manifest.json'))) : [];
  const sets = (args.set ?? 'all') === 'all' ? present : args.set.split(',');
  for (const s of sets) if (!present.includes(s)) throw new Error(`"${s}" çizilmemiş: önce node scripts/cosmetic-render/render.mjs --set ${s}`);
  writeBundles({ out, sets, platforms: args.platforms });
}
