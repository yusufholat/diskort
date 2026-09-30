// Uygulamanın yerel (Java/Kotlin/C++) kısmının parmak izi: expo-updates "runtimeVersion".
// Yalnızca yerel bağımlılıklar, yapılandırma eklentileri ve modules/ değişince değişir; sürüm numarası ya da
// JavaScript değişiklikleri değiştirmez. Aynı parmak izli APK'lar kablosuz (OTA) güncelleme alabilir;
// parmak izi değişince yeni APK gerekir (CI bunu kendiliğinden algılar).
//
//   node scripts/runtime-version.mjs [--platform android|ios] [--debug]
// Her platformun parmak izi ayrıdır (iOS: Pod'lar ve iOS yerel modülleri; Android: Gradle tarafı).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFingerprintAsync, SourceSkips } from '@expo/fingerprint';

const platformIndex = process.argv.indexOf('--platform');
const platform = platformIndex >= 0 ? process.argv[platformIndex + 1] : 'android';
if (platform !== 'android' && platform !== 'ios') throw new Error(`Geçersiz --platform: ${platform}`);

/**
 * Yalnızca Android'in derlemesini etkileyen ayarlar iOS parmak izine girmez. @expo/fingerprint uygulama
 * yapılandırmasının tamamını (eklentilerin ayarlarıyla birlikte) iki platformun parmak izine de katar; Android'in
 * en düşük sürümü (expo-build-properties → android.minSdkVersion, yalnızca gradle.properties'e yazılır)
 * değişince iOS'un yerel kısmı değişmediği halde iOS parmak izi de değişir ve bütün iPhone'lara yeni IPA
 * gerekirdi. Buraya yalnızca iOS derlemesine hiçbir etkisi olmayan ayarlar eklenir.
 */
const ANDROID_ONLY_BUILD_PROPERTIES = ['minSdkVersion'];

/** iOS parmak izi için yapılandırmadan Android'e özgü derleme ayarlarını çıkarır (çözülemezse dokunmaz) */
function withoutAndroidOnlySettings(contents) {
  try {
    const config = JSON.parse(String(contents));
    const entry = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-build-properties');
    const android = entry?.[1]?.android;
    if (!android) return contents;
    for (const key of ANDROID_ONLY_BUILD_PROPERTIES) delete android[key];
    return JSON.stringify(config);
  } catch {
    return contents;
  }
}

/**
 * Yalnızca Android dosyalarını değiştiren yamalar (patches/) iOS parmak izine girmez. Paketlerin içeriği parmak
 * izine zaten girmez (pnpm'in node_modules/.pnpm/<ad>/node_modules/ klasörleri @expo/fingerprint'in varsayılan
 * yok sayma kuralına uyar); iOS'a giren tek iz, React Native bağlantı yapılandırmasındaki paket klasörünün adıdır.
 * pnpm yamalı paketin klasör adına yamanın özetini katar; bu yüzden yalnızca Android dosyalarına dokunan bir yama
 * da iOS parmak izini değiştirirdi. iOS parmak izinde o klasörün adı, yamasız halinin adıyla (pnpm'in aynı
 * kuralıyla hesaplanır) değiştirilir. Yama android/ dışında bir dosyaya dokunursa (ya da dosyalar okunamazsa)
 * hiçbir şey değiştirilmez: parmak izi değişir ve yeni IPA gerekir.
 */
const ANDROID_ONLY_PATCHED_PACKAGES = ['@shopify/react-native-skia'];

/** pnpm'in bağımlılık yolundan klasör adı (@pnpm/dependency-path depPathToFilename; uzun adlar özetlenir) */
function pnpmDirName(depPath, maxLength) {
  let name = depPath.replace(/[\\/:*?"<>|#]/g, '+');
  if (name.includes('(')) name = name.replace(/\)$/, '').replace(/\)\(|\(|\)/g, '_');
  if (name.length > maxLength || name !== name.toLowerCase()) {
    return `${name.substring(0, maxLength - 33)}_${createHash('sha256').update(name).digest('hex').substring(0, 32)}`;
  }
  return name;
}

/** Yamalı klasör adı → yamasız klasör adı (yalnızca Android'e dokunan yamalar için); kurulamazsa boş */
function unpatchedDirNames() {
  const renames = new Map();
  try {
    const root = join(process.cwd(), '..', '..');
    const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
    const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
    for (const pkg of ANDROID_ONLY_PATCHED_PACKAGES) {
      const escaped = pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      const patchFile = new RegExp(`'${escaped}@[^']+':\\s*(\\S+\\.patch)`).exec(workspace)?.[1];
      if (!patchFile) continue;
      const touched = [...readFileSync(join(root, patchFile), 'utf8').matchAll(/^diff --git a\/(\S+) b\//gm)].map((m) => m[1]);
      if (touched.length === 0 || touched.some((file) => !file.startsWith('android/'))) continue;
      // Uygulamanın bağımlılık kaydı: '<paket>':\n specifier: …\n version: <sürüm>(patch_hash=…)(eşler…)
      const entry = new RegExp(`'${escaped}':\\r?\\n\\s+specifier: \\S+\\r?\\n\\s+version: (\\S+)`, 'g');
      for (const m of lock.matchAll(entry)) {
        const depPath = `${pkg}@${m[1]}`;
        const unpatched = depPath.replace(/\(patch_hash=[0-9a-f]+\)/, '');
        if (unpatched === depPath) continue;
        // Klasör adının en büyük uzunluğu işletim sistemine göre (Windows 60, diğerleri 120)
        for (const max of [60, 120]) renames.set(pnpmDirName(depPath, max), pnpmDirName(unpatched, max));
      }
    }
  } catch {
    renames.clear();
  }
  return renames;
}

const renames = platform === 'ios' ? unpatchedDirNames() : new Map();

function withUnpatchedDirs(contents) {
  let text = String(contents);
  for (const [patched, unpatched] of renames) text = text.split(patched).join(unpatched);
  return text;
}

function transform(source, chunk) {
  if (platform !== 'ios' || source.type !== 'contents') return chunk;
  if (source.id === 'expoConfig') return withoutAndroidOnlySettings(chunk);
  if (source.id === 'rncoreAutolinkingConfig:ios') return withUnpatchedDirs(chunk);
  return chunk;
}

const fingerprint = await createFingerprintAsync(process.cwd(), {
  platforms: [platform],
  sourceSkips:
    SourceSkips.ExpoConfigVersions |
    SourceSkips.ExpoConfigRuntimeVersionIfString |
    SourceSkips.PackageJsonScriptsAll,
  fileHookTransform: transform,
  silent: true,
});

if (process.argv.includes('--debug')) {
  for (const source of fingerprint.sources) console.error(source.type, 'id' in source ? source.id : '', source.hash);
}
process.stdout.write(`native-${fingerprint.hash.slice(0, 16)}`);
