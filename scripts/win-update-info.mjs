// İmzalanmış Windows kurulum dosyası için güncelleme bilgisini yeniden üretir.
//
// electron-builder latest.yml'e kurulum dosyasının sha512/boyutunu yazar ve .blockmap dosyasını
// (fark güncellemesi) üretir. Kurulum dosyası SONRADAN (SignPath'te) imzalanınca dosyanın baytları
// değişir; eski özet ve blockmap ile güncelleyici indirmeyi "sha512 checksum mismatch" diye reddeder.
// Bu betik imzalı dosyadan blockmap'i electron-builder'ın kendi koduyla yeniden oluşturur ve
// latest.yml'deki sha512/size alanlarını günceller.
//
// Kullanım: node scripts/win-update-info.mjs apps/desktop/release/<sürüm>
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const releaseDir = path.resolve(process.argv[2] ?? '');
const latestPath = path.join(releaseDir, 'latest.yml');
if (!process.argv[2] || !existsSync(latestPath)) {
  console.error(`latest.yml bulunamadı: ${latestPath}`);
  process.exit(1);
}

// app-builder-lib, electron-builder'ın bağımlılığıdır (pnpm'de apps/desktop'tan doğrudan görünmez).
const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop');
const requireFromDesktop = createRequire(path.join(desktopDir, 'package.json'));
const requireFromBuilder = createRequire(requireFromDesktop.resolve('electron-builder/package.json'));
const requireFromLib = createRequire(requireFromBuilder.resolve('app-builder-lib/package.json'));
const { buildBlockMap } = requireFromBuilder('app-builder-lib/out/targets/blockmap/blockmap');
const yaml = requireFromLib('js-yaml');

const sha512 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('base64')))
      .on('error', reject);
  });

const info = yaml.load(readFileSync(latestPath, 'utf8'));
const installerName = info.path;
const installerPath = path.join(releaseDir, installerName);
if (!installerName || !existsSync(installerPath)) {
  console.error(`latest.yml'deki kurulum dosyası bulunamadı: ${installerPath}`);
  process.exit(1);
}

// Blockmap ayrı dosya olarak (gzip) yazılır; kurulum dosyasının kendisine dokunulmaz.
const blockMapPath = `${installerPath}.blockmap`;
const result = await buildBlockMap(installerPath, 'gzip', blockMapPath);
const actual = await sha512(installerPath);
const size = statSync(installerPath).size;
if (result.sha512 !== actual || result.size !== size) {
  console.error('Blockmap sonucu dosyanın kendisiyle uyuşmuyor; kurulum dosyası değişmiş olabilir.');
  process.exit(1);
}

let updated = 0;
for (const file of info.files ?? []) {
  if (file.url === installerName) {
    file.sha512 = actual;
    file.size = size;
    updated++;
  }
}
if (updated === 0) {
  console.error(`latest.yml files listesinde ${installerName} yok`);
  process.exit(1);
}
info.sha512 = actual;

writeFileSync(latestPath, yaml.dump(info, { lineWidth: 8000 }));
console.log(`${installerName}: ${size} bayt, sha512 ${actual}`);
console.log(`Güncellendi: ${path.basename(latestPath)}, ${path.basename(blockMapPath)}`);
