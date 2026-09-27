// Telefondaki arayüz seslerini (assets/sounds/*.wav) üretir. Sesler tek yerde tanımlı:
// packages/client-core/src/sfx.ts. Masaüstü aynı işlevle sesi bellekte üretip çalar; telefon bu
// dosyaları expo-audio ile çalar, böylece iki platformda da birebir aynı sesler duyulur.
// Tanım değişince: node apps/mobile/scripts/generate-sounds.mjs [ek klasör]
// (client-core'daki sfx.test.ts dosyaların güncel olduğunu denetler). Ek klasör verilirse aynı dosyalar
// oraya da yazılır (yayından önce dinlemek için).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Node 22.18+/24 TypeScript dosyasını tür soyarak doğrudan yükler (sfx.ts bilerek bağımsız)
const sfx = await import(pathToFileURL(join(here, '..', '..', '..', 'packages', 'client-core', 'src', 'sfx.ts')).href);

const assets = join(here, '..', 'assets', 'sounds');
const dirs = [assets, ...process.argv.slice(2)];
for (const dir of dirs) {
  mkdirSync(dir, { recursive: true });
  // Artık tanımlı olmayan eski sesler silinir
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.wav') && !sfx.PREVIEW_SOUND_NAMES.includes(file.slice(0, -4))) rmSync(join(dir, file));
  }
  // Başkalarının sesleri kendininkiyle aynı (SOUND_ALIASES): ayrı dosyası yok
  for (const name of sfx.PREVIEW_SOUND_NAMES) {
    writeFileSync(join(dir, `${name}.wav`), sfx.encodeWav(sfx.renderSound(name), sfx.SFX_SAMPLE_RATE));
  }
  console.log(`${sfx.PREVIEW_SOUND_NAMES.length} ses yazıldı: ${dir}`);
}
// Ses paketleri kaldırıldı: eski paket klasörleri (assets/sounds/soft, assets/sounds/classic) silinir
for (const pack of ['soft', 'classic']) rmSync(join(assets, pack), { recursive: true, force: true });
