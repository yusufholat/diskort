// Telefondan ekran paylaşırken Android'in zorunlu tuttuğu bildirim (LiveKit'in WebRTC kütüphanesi gösterir).
// Kütüphane simgeyi uygulamada "ic_notification" adıyla arar; bulamayınca Android bildirimi geçersiz sayıp
// yerine kendi "Diskort çalışıyor — uygulamayı durdurmak için dokunun" bildirimini koyuyordu.
// Burada o adı sesli sohbet bildiriminin simgesine bağlıyoruz ve metinleri Türkçeleştiriyoruz.
const { withDangerousMod, withStringsXml, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const STRINGS = {
  media_projection_notification_title: 'Ekranın paylaşılıyor',
  media_projection_notification_text: 'Diskort şu an ekranını paylaşıyor. Durdurmak için uygulamadaki paylaşım düğmesine bas.',
  ongoing_notification_channel_name: 'Ekran paylaşımı',
};

module.exports = function withScreenShareNotification(config) {
  config = withStringsXml(config, (cfg) => {
    for (const [name, value] of Object.entries(STRINGS)) {
      cfg.modResults = AndroidConfig.Strings.setStringItem(
        [{ $: { name, translatable: 'false' }, _: value }],
        cfg.modResults,
      );
    }
    return cfg;
  });
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/values');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'diskort_screen_share.xml'),
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' +
          '    <item name="ic_notification" type="drawable">@drawable/diskort_voice_notification</item>\n' +
          '</resources>\n',
      );
      return cfg;
    },
  ]);
};
