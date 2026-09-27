// Telefondaki arayüz seslerini (assets/sounds/<paket>/*.wav; paketler: soft, classic) üretir. Sesler tek
// yerde tanımlı: packages/client-core/src/sfx.ts. Masaüstü aynı işlevle sesi bellekte üretip çalar; telefon
// bu dosyaları expo-audio ile çalar, böylece iki platformda da birebir aynı sesler duyulur.
// Tanım değişince: node apps/mobile/scripts/generate-sounds.mjs [ek klasör]
// (client-core'daki sfx.test.ts dosyaların güncel olduğunu denetler). Ek klasör verilirse aynı dosyalar
// oraya da yazılır (yayından önce dinlemek için).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Node 22.18+/24 TypeScript dosyasını tür soyarak doğrudan yükler (sfx.ts bilerek bağımsız)
const sfx = await import(pathToFileURL(join(here, '..', '..', '..', 'packages', 'client-core', 'src', 'sfx.ts')).href);

const dirs = [join(here, '..', 'assets', 'sounds'), ...process.argv.slice(2)];
for (const root of dirs) {
  mkdirSync(root, { recursive: true });
  // Paket klasörlerinden önceki düzende kök klasöre yazılmış sesler silinir
  for (const file of readdirSync(root)) {
    if (file.endsWith('.wav')) rmSync(join(root, file));
  }
  for (const pack of sfx.SOUND_PACKS) {
    const dir = join(root, pack);
    mkdirSync(dir, { recursive: true });
    // Artık tanımlı olmayan eski sesler silinir
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.wav') && !sfx.SOUND_NAMES.includes(file.slice(0, -4))) rmSync(join(dir, file));
    }
    for (const name of sfx.SOUND_NAMES) {
      writeFileSync(join(dir, `${name}.wav`), sfx.encodeWav(sfx.renderSound(name, sfx.SFX_SAMPLE_RATE, pack), sfx.SFX_SAMPLE_RATE));
    }
    console.log(`${sfx.SOUND_NAMES.length} ses yazıldı: ${dir}`);
  }
}
// Tanımı kalmayan paket klasörleri (ör. bir paket kaldırılınca) silinir
const assets = join(here, '..', 'assets', 'sounds');
for (const entry of readdirSync(assets, { withFileTypes: true })) {
  if (entry.isDirectory() && !sfx.SOUND_PACKS.includes(entry.name)) {
    rmSync(join(assets, entry.name), { recursive: true });
  }
}
