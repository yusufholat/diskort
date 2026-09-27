// Video oynatma (Android). Mesajın içinde oynatmak için expo-video'nun yerel modülü gerekir; bu modül
// 0.4.x APK'larında yok. JavaScript paketi kablosuz (OTA) güncellemeyle eski APK'lara da ulaşabileceği
// için expo-video burada hiçbir zaman doğrudan içe aktarılmaz (aktarılırsa açılışta yerel modülü arar ve
// uygulama çöker): önce modülün varlığı denetlenir, paket yalnızca varsa ve ilk kullanımda yüklenir.
// Yoksa video telefonun oynatıcısında (ya da tarayıcıda) açılır.

import { requireOptionalNativeModule } from 'expo';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking } from 'react-native';
import type * as ExpoVideo from 'expo-video';
import type { Attachment } from '@diskort/shared';
import { attachmentUrl } from '@diskort/client-core';
import { toast } from './stores/ui';

/** Bu APK'da expo-video'nun yerel modülü var mı */
export const hasNativeVideo = requireOptionalNativeModule('ExpoVideo') !== null;

let loaded: typeof ExpoVideo | null | undefined;

/** expo-video paketi (yalnızca yerel modül varsa, ilk çağrıda yüklenir); yoksa null */
export function expoVideo(): typeof ExpoVideo | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  if (!hasNativeVideo) return null;
  try {
    // Koşullu ve geç yükleme: import ile değil require ile (bkz. dosyanın başı)
    loaded = require('expo-video') as typeof ExpoVideo;
  } catch {
    loaded = null;
  }
  return loaded;
}

/**
 * Videoyu telefonun video oynatıcısında açar (adres doğrudan verilir, indirme beklenmez; sunucu
 * parça parça okumayı destekler). Oynatıcı yoksa tarayıcıda açılır.
 */
export async function openVideoExternally(attachment: Attachment): Promise<void> {
  const url = attachmentUrl(attachment);
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: url,
      type: attachment.contentType || 'video/*',
    });
  } catch {
    try {
      await Linking.openURL(url);
    } catch {
      toast('Bu videoyu açabilecek bir uygulama yok.', 'error');
    }
  }
}
