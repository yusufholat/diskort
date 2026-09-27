// iOS'a özgü ayarlar (Android projesine dokunmaz). Eklenti listesinde EN BAŞTA durmalı: Expo'da önce
// kaydedilen eklentinin değişikliği en son uygulanır, böylece başka eklentilerin (ör. expo-video'nun
// "audio" arka plan kipini silmesi) üzerine yazılır. CI (ios.yml) prebuild sonrası sonucu denetler.
//
// - OTA adresi: app.config.ts'deki updates.url Android'e göre (.../updates/expo/android); iOS uygulaması
//   kendi platformunun bildirimini .../updates/expo/ios'tan alır (Expo.plist → EXUpdatesURL).
// - Arka plan kipleri: sesli sohbet uygulama arka plandayken ve ekran kilitliyken sürsün ("audio"; VoIP
//   uygulaması olarak işaretlemek için "voip"). expo-video, supportsBackgroundPlayback kapalıyken
//   "audio"yu siliyor; burada geri eklenir.
const { withExpoPlist, withInfoPlist } = require('expo/config-plugins');

const BACKGROUND_MODES = ['audio', 'voip'];

module.exports = function withIos(config) {
  config = withExpoPlist(config, (cfg) => {
    const url = cfg.updates?.url;
    if (typeof url === 'string' && url) {
      cfg.modResults.EXUpdatesURL = url.replace(/\/updates\/expo\/android$/, '/updates/expo/ios');
    }
    return cfg;
  });
  return withInfoPlist(config, (cfg) => {
    const modes = new Set(cfg.modResults.UIBackgroundModes ?? []);
    for (const mode of BACKGROUND_MODES) modes.add(mode);
    cfg.modResults.UIBackgroundModes = [...modes];
    return cfg;
  });
};
