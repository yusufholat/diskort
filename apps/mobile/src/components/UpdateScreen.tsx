import { useEffect } from 'react';
import { Linking, Text, View } from 'react-native';
import { useUpdates } from 'expo-updates';
import { applyOta, installUpdate, resolveRequiredUpdate, useAppUpdate } from '../update/updater';
import { DEFAULT_SERVER_URL } from '../stores/settings';
import { colors, createStyles } from '../theme';
import { Button } from './ui';

const mb = (bytes: number): string => (bytes / 1048576).toFixed(1).replace('.', ',');

/**
 * Güncelleme ekranı. Önce kablosuz (OTA) güncelleme denenir: arayüz iner, uygulama kendini yeniden
 * başlatır. Yerel kısım değiştiyse yeni APK iner ve Android'in kurulum ekranı açılır.
 * `requiredVersion`: sunucu bu sürümü artık kabul etmiyor (güncelleme bilgisi henüz yoksa da gösterilir).
 */
export function UpdateScreen({ requiredVersion }: { requiredVersion?: string | null }) {
  const { status, ota, notFound } = useAppUpdate();
  const { downloadProgress } = useUpdates();
  const version =
    ota.kind !== 'idle' ? ota.version : status.kind !== 'idle' ? status.version : (requiredVersion ?? '');

  // Ekran açılınca güncellemeyi kendiliğinden başlat (masaüstündeki açılış güncelleyicisi gibi)
  useEffect(() => {
    if (ota.kind === 'downloaded') void applyOta();
    else if (ota.kind === 'downloading') return;
    else if (status.kind === 'available') void installUpdate();
    else if (status.kind === 'idle' && ota.kind === 'idle') void resolveRequiredUpdate();
  }, [ota.kind, status.kind]);

  let detail: string;
  let percent: number | null = null;
  let action: { title: string; run: () => void } | null = null;

  if (ota.kind === 'downloading') {
    percent = (downloadProgress ?? 0) * 100;
    detail = 'Yeni sürüm indiriliyor…';
  } else if (ota.kind === 'downloaded') {
    percent = 100;
    detail = 'Yeniden başlatılıyor…';
  } else if (status.kind === 'downloading') {
    percent = status.total ? (status.received / status.total) * 100 : 0;
    detail = status.total ? `İndiriliyor… ${mb(status.received)} / ${mb(status.total)} MB` : 'İndiriliyor…';
  } else if (status.kind === 'ready') {
    percent = 100;
    detail = 'İndirildi. Açılan ekranda "Güncelle"ye bas; kurulumdan sonra Diskort\'u yeniden aç.';
    action = { title: 'Kurulumu aç', run: () => void installUpdate() };
  } else if (status.kind === 'error') {
    detail = status.message;
    action = { title: 'Tekrar dene', run: () => void installUpdate() };
  } else if (ota.kind === 'error') {
    detail = `Güncelleme indirilemedi: ${ota.message}`;
    action = { title: 'Tekrar dene', run: () => void resolveRequiredUpdate() };
  } else if (notFound) {
    detail = 'Bu telefon için güncelleme bulunamadı. Diskort\'u indirme sayfasından yeniden kurabilirsin; hesabın korunur.';
    action = { title: 'İndirme sayfasını aç', run: () => void Linking.openURL(`${DEFAULT_SERVER_URL}/download`) };
  } else {
    detail = 'Güncelleme denetleniyor…';
  }

  const apk = status.kind !== 'idle' && ota.kind === 'idle';
  return (
    <View style={styles.page}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>↓</Text>
      </View>
      <Text style={styles.title}>{version ? `Diskort ${version}` : 'Yeni sürüm'}</Text>
      <Text style={styles.text}>{detail}</Text>
      {percent !== null && (
        <View style={styles.bar}>
          <View style={[styles.fill, { width: `${Math.max(3, percent)}%` }]} />
        </View>
      )}
      {action && (
        <View style={styles.action}>
          <Button title={action.title} onPress={action.run} />
        </View>
      )}
      {apk && (
        <Text style={styles.note}>
          İlk güncellemede Android, Diskort'un uygulama yüklemesine izin vermeni isteyebilir. Hesabın ve ayarların
          korunur.
        </Text>
      )}
    </View>
  );
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.rail, alignItems: 'center', justifyContent: 'center', padding: 32 },
  badge: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  badgeText: { color: '#fff', fontSize: 40, fontWeight: '700' },
  title: { color: colors.head, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  text: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  bar: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: colors.main, marginTop: 20, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.brand, borderRadius: 3 },
  action: { marginTop: 24, alignSelf: 'stretch' },
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 28, lineHeight: 18 },
}));
