import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EASE_IN, prefersReducedMotion, timing, usePresence } from '../motion';
import { colors } from '../theme';

const CLOSE_MS = 200;
/** Bu kadar aşağı sürüklenirse (ya da hızla fırlatılırsa) kapanır */
const DISMISS_DISTANCE = 90;

/**
 * Alttan kayarak açılan sayfa: arka plan kararır, sayfa yaylanarak yükselir, tutamaçtan ya da
 * içerikten aşağı sürükleyince kapanır. Modal'ın kendi "slide" animasyonu arka planı da
 * kaydırdığı için kullanılmaz.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const mounted = usePresence(visible, CLOSE_MS);
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const [height, setHeight] = useState(480);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (visible) {
      drag.setValue(0);
      if (prefersReducedMotion()) progress.setValue(1);
      else Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 3 }).start();
    } else {
      timing(progress, 0, CLOSE_MS, EASE_IN).start();
    }
  }, [visible, progress, drag]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Yalnızca belirgin aşağı sürükleme; kaydırılabilir içerik kendi kaydırmasını alır
        onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > DISMISS_DISTANCE || g.vy > 1.2) close.current();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        },
        onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [drag],
  );

  if (!mounted) return null;

  const translateY = Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [height + 40, 0] }), drag);

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Kapat" />
      </Animated.View>
      <Animated.View
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}
        {...pan.panHandlers}
      >
        <View style={styles.handle} />
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.side,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    elevation: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.active,
    marginBottom: 8,
  },
});
