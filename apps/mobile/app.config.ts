import type { ExpoConfig } from 'expo/config';
import { version } from './package.json';

/** Android sürüm kodu her sürümde artmalı: 1.2.3 → 10203 */
function versionCode(v: string): number {
  const [major = 0, minor = 0, patch = 0] = v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  return major * 10000 + minor * 100 + patch;
}

const config: ExpoConfig = {
  name: 'Diskort',
  slug: 'diskort',
  version,
  scheme: 'diskort',
  // Yayın izlerken yatay ekran için döndürmeye izin verilir
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#313338',
  android: {
    package: 'com.diskort.app',
    versionCode: versionCode(version),
    adaptiveIcon: {
      backgroundColor: '#5865f2',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
    ],
    // Kamera henüz kullanılmıyor (WebRTC eklentisi varsayılan olarak ister)
    blockedPermissions: [
      'android.permission.CAMERA',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-build-properties',
      {
        android: {
          // Yalnızca arm64 ve armv7: APK boyutu küçülür (x86 yalnızca emülatörlerde gerekir)
          buildArchs: ['arm64-v8a', 'armeabi-v7a'],
        },
      },
    ],
    ['@livekit/react-native-expo-plugin', { android: { audioType: 'communication' } }],
    '@config-plugins/react-native-webrtc',
    [
      'expo-splash-screen',
      { image: './assets/splash-icon.png', imageWidth: 120, backgroundColor: '#1e1f22', resizeMode: 'contain' },
    ],
    './plugins/withReleaseSigning',
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
