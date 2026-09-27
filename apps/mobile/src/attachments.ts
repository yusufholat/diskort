// Dosya ekleri (Android ve iOS): dosya/resim seçme, yükleme (yerel dosyayı ham gövde olarak) ve gelen dosyayı
// indirip telefondaki uygun uygulamayla açma.
import type { Attachment } from '@diskort/shared';
import { attachmentUrl, type LocalFile, type UploadRequest, type UploadResponse } from '@diskort/client-core';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform, Share } from 'react-native';
import { toast } from './stores/ui';

/** Dosyayı ilerleme bildirerek gönderir (client-core'un platform yüklemesi). */
export async function uploadFromDevice(request: UploadRequest): Promise<UploadResponse> {
  if (!request.file.uri) return { status: 0, body: '' };
  const task = FileSystem.createUploadTask(
    request.url,
    request.file.uri,
    { httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers: request.headers },
    ({ totalBytesSent }) => request.onProgress(totalBytesSent),
  );
  const cancel = (): void => void task.cancelAsync();
  request.signal.addEventListener('abort', cancel);
  try {
    const res = await task.uploadAsync();
    return res ? { status: res.status, body: res.body } : { status: 0, body: '' };
  } catch {
    return { status: 0, body: '' };
  } finally {
    request.signal.removeEventListener('abort', cancel);
  }
}

const baseName = (uri: string): string => decodeURIComponent(uri.split('/').pop() ?? '') || 'dosya';

/** Seçicinin bildirmediği boyut dosyanın kendisinden okunur. */
async function withSize(file: Omit<LocalFile, 'size'> & { size?: number | null }): Promise<LocalFile> {
  let size = file.size ?? 0;
  if (!size && file.uri) {
    const info = await FileSystem.getInfoAsync(file.uri).catch(() => null);
    if (info?.exists) size = info.size ?? 0;
  }
  return { ...file, size };
}

/** Galeriden fotoğraf/video seçer (Android'in fotoğraf seçicisi; izin gerekmez). */
export async function pickMedia(): Promise<LocalFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: 10,
    // Özgün dosya olduğu gibi (GIF'ler hareketli kalır); konum bilgisini sunucu siler
    quality: 1,
  });
  if (result.canceled) return [];
  return Promise.all(
    result.assets.map((a) =>
      withSize({
        name: a.fileName ?? baseName(a.uri),
        size: a.fileSize,
        type: a.mimeType ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
        uri: a.uri,
      }),
    ),
  );
}

/**
 * Profil fotoğrafı için galeriden tek resim seçtirir ve Android'in kırpma ekranında kare kırptırır.
 * Küçültmeyi sunucu yapar (256×256); yerel resim işleme modülü gerekmez.
 */
export async function pickAvatar(): Promise<LocalFile | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.9,
  });
  if (result.canceled || !result.assets[0]) return null;
  const a = result.assets[0];
  // Boyut kırpılmış dosyanın kendisinden okunur (seçicinin bildirdiği özgün resme ait olabilir)
  return withSize({ name: a.fileName ?? baseName(a.uri), type: a.mimeType ?? 'image/jpeg', uri: a.uri });
}

/** Herhangi bir dosya seçer (sistemin dosya seçicisi). */
export async function pickDocuments(): Promise<LocalFile[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return Promise.all(
    result.assets.map((a) => withSize({ name: a.name, size: a.size, type: a.mimeType ?? '', uri: a.uri })),
  );
}

const opening = new Set<string>();

/**
 * Dosyayı önbelleğe indirir (daha önce indirildiyse tekrar indirmez) ve Android'in "Birlikte aç"
 * seçimiyle uygun uygulamada açar.
 */
export async function openAttachment(attachment: Attachment): Promise<void> {
  if (opening.has(attachment.id)) return;
  opening.add(attachment.id);
  try {
    const dir = `${FileSystem.cacheDirectory}ekler/${attachment.id}/`;
    const target = dir + attachment.name.replace(/[/\\]/g, '_');
    const existing = await FileSystem.getInfoAsync(target);
    if (!existing.exists || existing.size !== attachment.size) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
      if (attachment.size > 1024 * 1024) toast('İndiriliyor…');
      const result = await FileSystem.downloadAsync(attachmentUrl(attachment), target);
      if (result.status !== 200) {
        await FileSystem.deleteAsync(target, { idempotent: true });
        throw new Error(result.status === 404 ? 'Dosya artık yok (mesaj silinmiş olabilir).' : `İndirme başarısız (${result.status}).`);
      }
    }
    if (Platform.OS === 'ios') {
      // iOS'ta "Birlikte aç" yerine paylaşım sayfası: Dosyalar'a kaydet, önizle ya da başka uygulamada aç
      await Share.share({ url: target });
      return;
    }
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: await FileSystem.getContentUriAsync(target),
      type: attachment.contentType || '*/*',
      // FLAG_GRANT_READ_URI_PERMISSION: açan uygulama dosyayı okuyabilsin
      flags: 1,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast(
      /No Activity found|ActivityNotFound/i.test(message)
        ? 'Bu dosyayı açabilecek bir uygulama yok.'
        : /network|timeout|unable to resolve|failed to connect/i.test(message)
          ? 'Dosya indirilemedi: internet bağlantısını kontrol et.'
          : message,
      'error',
    );
  } finally {
    opening.delete(attachment.id);
  }
}
