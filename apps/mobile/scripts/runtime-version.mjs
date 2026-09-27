// Uygulamanın yerel (Java/Kotlin/C++) kısmının parmak izi: expo-updates "runtimeVersion".
// Yalnızca yerel bağımlılıklar, yapılandırma eklentileri ve modules/ değişince değişir; sürüm numarası ya da
// JavaScript değişiklikleri değiştirmez. Aynı parmak izli APK'lar kablosuz (OTA) güncelleme alabilir;
// parmak izi değişince yeni APK gerekir (CI bunu kendiliğinden algılar).
import { createFingerprintAsync, SourceSkips } from '@expo/fingerprint';

const fingerprint = await createFingerprintAsync(process.cwd(), {
  platforms: ['android'],
  sourceSkips:
    SourceSkips.ExpoConfigVersions |
    SourceSkips.ExpoConfigRuntimeVersionIfString |
    SourceSkips.PackageJsonScriptsAll,
  silent: true,
});

if (process.argv.includes('--debug')) {
  for (const source of fingerprint.sources) console.error(source.type, 'id' in source ? source.id : '', source.hash);
}
process.stdout.write(`native-${fingerprint.hash.slice(0, 16)}`);
