import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EASE_IN, timing } from '../motion';
import { useUi } from '../stores/ui';
import { colors, createStyles, tint } from '../theme';

type ToastState = NonNullable<ReturnType<typeof useUi.getState>['toast']>;

/**
 * Kısa bilgi/hata: üstten, durum çubuğunun altından inerek belirir, kaybolurken yukarı kayar.
 * Altta dururken butonların ve klavyenin üstüne biniyordu.
 */
export function Toast() {
  const toast = useUi((s) => s.toast);
  const insets = useSafeAreaInsets();
  // Kapanış animasyonu sürerken son metin görünmeye devam eder
  const [shown, setShown] = useState<ToastState | null>(toast);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (toast) {
      setShown(toast);
      progress.setValue(0);
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
      return;
    }
    const anim = timing(progress, 0, 180, EASE_IN);
    anim.start(({ finished }) => finished && setShown(null));
    return () => anim.stop();
  }, [toast, progress]);

  if (!shown) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        shown.kind === 'error' && styles.error,
        {
          top: insets.top + 8,
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
      ]}
    >
      <Text style={[styles.text, shown.kind === 'error' && { color: colors.dangerText }]}>{shown.text}</Text>
    </Animated.View>
  );
}

const styles = createStyles(() => ({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: colors.deep,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    elevation: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tint(0.08),
  },
  error: { borderColor: 'rgba(242,63,67,0.5)' },
  text: { color: colors.text, fontSize: 14.5 },
}));
