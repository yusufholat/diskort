import { Linking, StyleSheet, Text, View } from 'react-native';
import { DEFAULT_SERVER_URL } from '../stores/settings';
import { colors } from '../theme';
import { Button } from './ui';

/** Sunucu bu sürümü artık kabul etmiyor: yeni APK indirilip kurulana kadar uygulama kullanılamaz. */
export function UpdateRequired({ version }: { version: string }) {
  return (
    <View style={styles.page}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>↓</Text>
      </View>
      <Text style={styles.title}>Diskort {version} gerekli</Text>
      <Text style={styles.text}>
        Bu sürüm artık desteklenmiyor. Yeni sürümü indirip kurduktan sonra uygulamayı yeniden aç. Hesabın ve
        ayarların korunur.
      </Text>
      <View style={styles.action}>
        <Button title="Yeni sürümü indir" onPress={() => void Linking.openURL(`${DEFAULT_SERVER_URL}/download/android`)} />
      </View>
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
  action: { marginTop: 24, alignSelf: 'stretch' },
});
