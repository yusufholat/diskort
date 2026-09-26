// APK'yı Diskort'un kalıcı anahtarıyla imzalar. Anahtar depoda değildir: CI'da gizli değişkenlerden
// geçici dosyaya yazılır ve Gradle'a -PDISKORT_UPLOAD_* özellikleriyle verilir. Özellikler yoksa
// (yerel geliştirme derlemesi) Expo'nun varsayılanı olan hata ayıklama anahtarı kullanılır.
//
// DİKKAT: Aynı anahtar kaybedilirse kurulu uygulamalar güncellenemez (kullanıcılar kaldırıp yeniden
// kurmak zorunda kalır). Yedeği: %OneDrive%\Yedekler\Diskort\android-imza
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = 'DISKORT_UPLOAD_STORE_FILE';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    gradle = gradle.replace(
      /signingConfigs \{/,
      `signingConfigs {
        release {
            if (project.hasProperty('${MARKER}')) {
                storeFile file(project.property('${MARKER}'))
                storePassword project.property('DISKORT_UPLOAD_STORE_PASSWORD')
                keyAlias project.property('DISKORT_UPLOAD_KEY_ALIAS')
                keyPassword project.property('DISKORT_UPLOAD_KEY_PASSWORD')
            }
        }`,
    );
    const before = gradle;
    gradle = gradle.replace(
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig project.hasProperty('${MARKER}') ? signingConfigs.release : signingConfigs.debug`,
    );
    if (gradle === before) throw new Error('withReleaseSigning: release signingConfig satırı bulunamadı');

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
