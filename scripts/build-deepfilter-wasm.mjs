// DeepFilterNet 3 gürültü engelleyicisini (libDF) kaynaktan wasm'a derler ve modelle birlikte
// apps/desktop/src/renderer/src/features/voice/deepfilter/ içine koyar. Çıktılar depoda durur; bu betik
// yalnızca yeniden üretmek/güncellemek içindir.
//
// Gerekenler: rustup (Rust 1.92+) ve `rustup target add wasm32-unknown-unknown`. C derleyicisi gerekmez.
// Kullanım: node scripts/build-deepfilter-wasm.mjs [çalışma-klasörü]
//
// Adımlar: resmi kaynak (Rikorose/DeepFilterNet, sabit commit) indirilir → derlemeyle ilgisiz bağımlılıklar
// çıkarılır (hdf5 git bağımlılığı, python/ladspa üyeleri) → wasm SIMD çekirdekleri olan tract 0.21.18'e uyum
// yamaları → apps/desktop/deepfilter-wasm içindeki C ABI sarmalayıcısı kilitli bağımlılıklarla derlenir.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = 'd375b2d8309e0935d165700c91da9de862a99c31';
const MODEL_SHA256 = 'c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crateDir = path.join(root, 'apps', 'desktop', 'deepfilter-wasm');
const outDir = path.join(root, 'apps', 'desktop', 'src', 'renderer', 'src', 'features', 'voice', 'deepfilter');
const work = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'diskort-deepfilter'));
const src = path.join(work, `DeepFilterNet-${COMMIT}`);

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function patch(file, from, to) {
  const p = path.join(src, file);
  const text = readFileSync(p, 'utf8');
  if (!text.includes(from)) {
    if (text.includes(to)) return; // zaten uygulanmış
    throw new Error(`Yama uygulanamadı: ${file}: ${from}`);
  }
  writeFileSync(p, text.split(from).join(to));
}

mkdirSync(work, { recursive: true });
if (!existsSync(src)) {
  const archive = path.join(work, `${COMMIT}.tar.gz`);
  console.log('DeepFilterNet kaynağı indiriliyor…');
  const res = await fetch(`https://codeload.github.com/Rikorose/DeepFilterNet/tar.gz/${COMMIT}`);
  if (!res.ok) throw new Error(`İndirme başarısız: ${res.status}`);
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  // Yalnızca gereken kısımlar (arşivdeki sembolik bağlantıyı Windows tar'ı açamıyor)
  const top = `DeepFilterNet-${COMMIT}`;
  const members = ['Cargo.toml', 'README.md', 'LICENSE-MIT', 'LICENSE-APACHE', 'libDF', 'models/DeepFilterNet3_onnx.tar.gz'];
  execFileSync('tar', ['-xzf', archive, '-C', work, ...members.map((m) => `${top}/${m}`)], { stdio: 'inherit' });
}

// Derlemeyle ilgisiz, Windows'ta yol uzunluğu sorunu çıkaran hdf5 git bağımlılığı ve diğer üyeler
patch('Cargo.toml', '  "libDF",\n  "pyDF",\n  "pyDF-data",\n  "ladspa",\n  "demo",\n', '  "libDF",\n  "dfwasm",\n');
patch(
  'libDF/Cargo.toml',
  'hdf5 = { optional = true, git = "https://github.com/aldanor/hdf5-rust.git", rev = "26046fb" }\n',
  '',
);
patch('libDF/Cargo.toml', '  "dep:hdf5",\n', '');
patch('libDF/Cargo.toml', 'hdf5-static = ["hdf5?/static"]\n', '');
// tract 0.21.18 (wasm SIMD çekirdekleri): ndarray 0.16 ve Graph::symbol_table → Graph::symbols
patch(
  'libDF/Cargo.toml',
  'ndarray = { version = "^0.15", optional = true, features = ["serde"] }',
  'ndarray = { version = "^0.16", optional = true, features = ["serde"] }',
);
patch('libDF/src/tract.rs', 'm.symbol_table.sym("S")', 'm.symbols.sym("S")');

mkdirSync(path.join(src, 'dfwasm'), { recursive: true });
copyFileSync(path.join(crateDir, 'Cargo.toml'), path.join(src, 'dfwasm', 'Cargo.toml'));
copyFileSync(path.join(crateDir, 'lib.rs'), path.join(src, 'dfwasm', 'lib.rs'));
copyFileSync(path.join(crateDir, 'Cargo.lock'), path.join(src, 'Cargo.lock'));

console.log('Derleniyor (birkaç dakika sürer)…');
execFileSync(
  'cargo',
  ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'diskort-dfwasm'],
  {
    cwd: src,
    stdio: 'inherit',
    env: {
      ...process.env,
      RUSTFLAGS: '-C target-feature=+simd128',
      CARGO_PROFILE_RELEASE_OPT_LEVEL: '3',
      CARGO_PROFILE_RELEASE_LTO: 'fat',
      CARGO_PROFILE_RELEASE_CODEGEN_UNITS: '1',
      CARGO_PROFILE_RELEASE_PANIC: 'abort',
      CARGO_PROFILE_RELEASE_STRIP: 'true',
    },
  },
);

const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(src, 'target');
const wasm = path.join(targetDir, 'wasm32-unknown-unknown', 'release', 'diskort_dfwasm.wasm');
const model = path.join(src, 'models', 'DeepFilterNet3_onnx.tar.gz');
if (sha256(model) !== MODEL_SHA256) throw new Error('Model dosyasının özeti beklenenden farklı');
copyFileSync(wasm, path.join(outDir, 'df.wasm'));
// .bin: geliştirme sunucusu .gz dosyalarını 'Content-Encoding: gzip' ile açıp bozuyor
copyFileSync(model, path.join(outDir, 'DeepFilterNet3_onnx.bin'));
console.log(`df.wasm                     sha256 ${sha256(path.join(outDir, 'df.wasm'))}`);
console.log(`DeepFilterNet3_onnx.bin     sha256 ${MODEL_SHA256}`);
