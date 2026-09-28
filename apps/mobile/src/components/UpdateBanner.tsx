import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMessages } from '@diskort/client-core';
import { useDismissedUpdate, useUpdateBannerVisible } from '../update/banner';
import { applyOta, useAppUpdate } from '../update/updater';
import { useVoice } from '../voice/voice';
import { colors, createStyles, tint } from '../theme';
import { hasDraftText, hasOpenEdit } from './Composer';
import { confirmDialog } from './Dialog';

/**
 * Yarım kalan taslak, açık bir düzenleme, gönderilmeyi bekleyen dosya ya da henüz sunucuya ulaşmamış
 * (durumu 'pending') bir mesaj var mı: yeniden başlatma bunları kaybettirir, önce sorulur.
 */
function hasUnsavedWork(): boolean {
  if (hasDraftText() || hasOpenEdit()) return true;
  const { pendingFiles, channels } = useMessages.getState();
  if (Object.values(pendingFiles).some((files) => files.length > 0)) return true;
  return Object.values(channels).some((c) => c.messages.some((m) => m.status === 'pending'));
}

let applying = false;

async function restart(): Promise<void> {
  if (applying) return;
  const inVoice = useVoice.getState().status !== 'idle';
  const unsaved = hasUnsavedWork();
  if (inVoice || unsaved) {
    const lost = [inVoice && 'sesli sohbetten çıkarsın', unsaved && 'yazdığın taslak ya da gönderilmekte olan mesaj kaybolur']
      .filter(Boolean)
      .join(', ');
    const ok = await confirmDialog({
      title: 'Şimdi yeniden başlatılsın mı?',
      message: `Yeniden başlatınca ${lost}. İstersen sonra da yapabilirsin; uygulamayı kapatıp açınca güncelleme kendiliğinden uygulanır.`,
      confirmLabel: 'Yeniden başlat',
    });
    if (!ok) return;
  }
  applying = true;
  try {
    await applyOta();
  } catch {
    applying = false;
  }
}

/**
 * Arka planda inen arayüz güncellemesi hazır olunca üstte beliren şerit (masaüstündeki yeşil güncelleme
 * simgesinin karşılığı). Uygulama kullanılırken kendiliğinden yeniden başlamaz: kullanıcı ne zaman
 * isterse dokunur; kapatırsa güncelleme uygulamanın bir sonraki açılışında uygulanır.
 */
export function UpdateBanner() {
  const visible = useUpdateBannerVisible();
  const version = useAppUpdate((s) => (s.ota.kind === 'downloaded' ? s.ota.version : null));
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
  }, [visible, progress]);

  if (!visible || !version) return null;
  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          top: insets.top + 8,
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
        },
      ]}
    >
      <View style={styles.bar}>
        <Ionicons name="arrow-down-circle" size={20} color={colors.ok} />
        <Text style={styles.text} numberOfLines={1}>
          Diskort {version} hazır
        </Text>
        <Pressable
          onPress={() => void restart()}
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel={`Diskort ${version} için yeniden başlat`}
        >
          <Text style={styles.buttonText}>Yeniden başlat</Text>
        </Pressable>
        <Pressable
          onPress={() => useDismissedUpdate.setState({ version })}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Şimdilik kapat"
        >
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = createStyles(() => ({
  wrap: { position: 'absolute', left: 16, right: 16 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.deep,
    borderRadius: 12,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 10,
    elevation: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tint(0.08),
  },
  text: { flex: 1, color: colors.text, fontSize: 14.5, fontWeight: '600' },
  button: { backgroundColor: colors.ok, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  buttonText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
}));
