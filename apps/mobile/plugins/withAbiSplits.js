// APK'yı işlemci türüne göre ayrıca böler: arm64-v8a (günümüz telefonları) ve armeabi-v7a (eski 32 bit).
// İndirme sayfası hepsini içeren "universal" APK'yı sunar (ilk kurulum, ~80 MB); uygulama içi
// güncellemeler telefona uygun küçük APK'yı indirir (~yarısı). x86 (emülatör) kütüphaneleri hiç paketlenmez.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// diskort-abi-splits';

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;
    const before = gradle;
    gradle = gradle.replace(
      /(\nandroid \{\n)/,
      `$1    ${MARKER}
    splits {
        abi {
            enable true
            reset()
            include 'arm64-v8a', 'armeabi-v7a'
            universalApk true
        }
    }
    // Emülatör (x86) kütüphaneleri telefonlarda kullanılmaz; bazı bağımlılıklar hazır getiriyor (~55 MB)
    packagingOptions {
        jniLibs {
            excludes += ['lib/x86/**', 'lib/x86_64/**']
        }
    }
`,
    );
    if (gradle === before) throw new Error('withAbiSplits: android { bloğu bulunamadı');
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
