import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { checkForUpdate, installUpdate, useAppUpdate } from '../update/updater';
import { colors } from '../theme';
import { Button } from './ui';

const mb = (bytes: number): string => (bytes / 1048576).toFixed(1).replace('.', ',');

/**
 * Zorunlu güncelleme ekranı: yeni sürüm indirilir ve Android'in kurulum ekranı açılır.
 * `requiredVersion`: sunucu bu sürümü artık kabul etmiyor (güncelleme bilgisi henüz yoksa da gösterilir).
 */
export function UpdateScreen({ requiredVersion }: { requiredVersion?: string | null }) {
  const status = useAppUpdate((s) => s.status);
  const version = status.kind !== 'idle' ? status.version : (requiredVersion ?? '');

  // Ekran açılınca indirmeyi kendiliğinden başlat (masaüstündeki açılış güncelleyicisi gibi);
  // sunucu reddettiyse ama sürüm bilgisi henüz yoksa önce denetle
  useEffect(() => {
    if (status.kind === 'available') void installUpdate();
    else if (status.kind === 'idle') void checkForUpdate(true);
  }, [status.kind]);

  let detail: string;
  let percent = 0;
  switch (status.kind) {
    case 'downloading':
      percent = status.total ? (status.received / status.total) * 100 : 0;
      detail = status.total ? `İndiriliyor… ${mb(status.received)} / ${mb(status.total)} MB` : 'İndiriliyor…';
      break;
    case 'ready':
      percent = 100;
      detail = 'İndirildi. Açılan ekranda "Güncelle"ye bas; kurulumdan sonra Diskort\'u yeniden aç.';
      break;
    case 'error':
      detail = status.message;
      break;
    default:
      detail = 'Güncelleme hazırlanıyor…';
  }

  return (
    <View style={styles.page}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>↓</Text>
      </View>
      <Text style={styles.title}>{version ? `Diskort ${version}` : 'Yeni sürüm'} gerekli</Text>
      <Text style={styles.text}>{detail}</Text>
      {(status.kind === 'downloading' || status.kind === 'ready') && (
        <View style={styles.bar}>
          <View style={[styles.fill, { width: `${Math.max(3, percent)}%` }]} />
        </View>
      )}
      {status.kind === 'ready' && (
        <View style={styles.action}>
          <Button title="Kurulumu aç" onPress={() => void installUpdate()} />
        </View>
      )}
      {status.kind === 'error' && (
        <View style={styles.action}>
          <Button title="Tekrar dene" onPress={() => void installUpdate()} />
        </View>
      )}
      <Text style={styles.note}>
        İlk güncellemede Android, Diskort'un uygulama yüklemesine izin vermeni isteyebilir. Hesabın ve ayarların
        korunur.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
