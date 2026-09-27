import * as Application from 'expo-application';
import Constants from 'expo-constants';

/** Yüklü APK'nın sürümü (versionName): yalnızca yeni APK kurulunca değişir */
export const NATIVE_VERSION = Application.nativeApplicationVersion ?? '0.0.0';

/**
 * Çalışan arayüzün sürümü: kablosuz (OTA) güncellemeyle APK'dan yeni olabilir. Sunucuya bildirilen
 * ve kullanıcıya gösterilen sürüm budur (OTA ile gelen paketin yapılandırmasından okunur).
 */
export const APP_VERSION = Constants.expoConfig?.version ?? NATIVE_VERSION;
