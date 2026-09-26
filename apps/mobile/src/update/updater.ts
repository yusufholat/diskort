import { compareVersions } from '@diskort/shared';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { create } from 'zustand';
import { APP_VERSION } from '../version';
import { DEFAULT_SERVER_URL } from '../stores/settings';

/**
 * Android'de uygulama içi güncelleme (masaüstündeki açılış güncelleyicisinin karşılığı):
 * yeni sürüm varsa telefona uygun APK (arm64 / armv7) indirilir ve Android'in kurulum ekranı açılır.
 * Android, uygulamaların kendilerini sessizce güncellemesine izin vermez; son onay kullanıcıdadır.
 */
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; received: number; total: number }
  | { kind: 'ready'; version: string; uri: string }
  | { kind: 'error'; version: string; message: string };

interface UpdateStore {
  status: UpdateStatus;
}

export const useAppUpdate = create<UpdateStore>()(() => ({ status: { kind: 'idle' } }));

const CHECK_THROTTLE_MS = 10 * 60_000;
let lastCheck = 0;
let checking: Promise<void> | null = null;

/** Telefona uygun APK: günümüz telefonları arm64, eskiler armv7; bilinmiyorsa hepsini içeren APK. */
function apkName(version: string): string {
  const abis = Device.supportedCpuArchitectures ?? [];
  const abi = abis.includes('arm64-v8a') ? 'arm64-v8a' : abis.includes('armeabi-v7a') ? 'armeabi-v7a' : null;
  return abi ? `Diskort-${version}-android-${abi}.apk` : `Diskort-${version}-android.apk`;
}

/** Sunucuya en son Android sürümünü sorar; yeni sürüm varsa durumu "available" yapar. */
export function checkForUpdate(force = false): Promise<void> {
  if (!force && Date.now() - lastCheck < CHECK_THROTTLE_MS) return Promise.resolve();
  const current = useAppUpdate.getState().status;
  if (current.kind === 'downloading' || current.kind === 'ready') return Promise.resolve();
  checking ??= (async () => {
    try {
      const res = await fetch(`${DEFAULT_SERVER_URL}/api/client/version?platform=android`, {
        headers: { 'Cache-Control': 'no-store' },
      });
      if (!res.ok) return;
      const { latest } = (await res.json()) as { latest: string | null };
      lastCheck = Date.now();
      if (latest && compareVersions(latest, APP_VERSION) > 0) {
        useAppUpdate.setState({ status: { kind: 'available', version: latest } });
      }
    } catch {
      // internet yoksa sessizce geç; bir sonraki açılışta tekrar denenir
    } finally {
      checking = null;
    }
  })();
  return checking;
}

let download: FileSystem.DownloadResumable | null = null;

/** Kurulmuş (ya da artık eski) sürümlerin indirilen APK'larını siler. */
export async function cleanupDownloads(): Promise<void> {
  try {
    const dir = FileSystem.cacheDirectory;
    if (!dir) return;
    for (const name of await FileSystem.readDirectoryAsync(dir)) {
      const version = /^Diskort-(\d+\.\d+\.\d+)-android.*\.apk$/.exec(name)?.[1];
      if (version && compareVersions(version, APP_VERSION) <= 0) {
        await FileSystem.deleteAsync(dir + name, { idempotent: true });
      }
    }
  } catch {
    // önemli değil
  }
}

/** APK'yı indirir ve kurulum ekranını açar. */
export async function installUpdate(): Promise<void> {
  const status = useAppUpdate.getState().status;
  if (status.kind === 'idle' || status.kind === 'downloading') return;
  const version = status.version;
  if (status.kind === 'ready') {
    await openInstaller(version, status.uri);
    return;
  }

  const file = `${FileSystem.cacheDirectory}${apkName(version)}`;
  useAppUpdate.setState({ status: { kind: 'downloading', version, received: 0, total: 0 } });
  try {
    // Önceki denemelerden kalan eski APK'ları temizle
    await FileSystem.deleteAsync(file, { idempotent: true });
    download = FileSystem.createDownloadResumable(
      `${DEFAULT_SERVER_URL}/updates/${apkName(version)}`,
      file,
      {},
      ({ totalBytesWritten, totalBytesExpectedToWrite }) =>
        useAppUpdate.setState({
          status: { kind: 'downloading', version, received: totalBytesWritten, total: totalBytesExpectedToWrite },
        }),
    );
    const result = await download.downloadAsync();
    download = null;
    if (!result || result.status !== 200) throw new Error(`İndirme başarısız (${result?.status ?? 'yanıt yok'}).`);
    useAppUpdate.setState({ status: { kind: 'ready', version, uri: result.uri } });
    await openInstaller(version, result.uri);
  } catch (err) {
    download = null;
    const message = err instanceof Error ? err.message : String(err);
    useAppUpdate.setState({
      status: {
        kind: 'error',
        version,
        message: /network|timeout|unable to resolve|failed to connect/i.test(message)
          ? 'İnternet bağlantısı yok ya da sunucuya ulaşılamıyor.'
          : message,
      },
    });
  }
}

async function openInstaller(version: string, uri: string): Promise<void> {
  try {
    const contentUri = await FileSystem.getContentUriAsync(uri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: 'application/vnd.android.package-archive',
      // FLAG_GRANT_READ_URI_PERMISSION: kurulum ekranı dosyayı okuyabilsin
      flags: 1,
    });
  } catch (err) {
    useAppUpdate.setState({
      status: { kind: 'error', version, message: err instanceof Error ? err.message : String(err) },
    });
  }
}
