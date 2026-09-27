import { Children, Fragment, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Keyboard, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EASE_IN, prefersReducedMotion, timing, usePresence } from '../motion';
import { colors, font, radius, ripple, space } from '../theme';

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
  avoidKeyboard = false,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Klavye açılınca sayfa klavyenin üstüne çıkar ve sığmazsa içerik daralır (arama kutusu olan sayfalar) */
  avoidKeyboard?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const mounted = usePresence(visible, CLOSE_MS);
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const [height, setHeight] = useState(480);
  const close = useRef(onClose);
  close.current = onClose;
  const keyboard = useKeyboardOverlap(avoidKeyboard && mounted);

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
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}
        onLayout={(e) => keyboard.setWindowHeight(e.nativeEvent.layout.height)}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Kapat" />
      </Animated.View>
      <Animated.View
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + 16, transform: [{ translateY }] },
          keyboard.overlap > 0 && {
            bottom: keyboard.overlap,
            paddingBottom: 8,
            maxHeight: Math.max(200, keyboard.windowHeight - keyboard.overlap - insets.top - 8),
          },
        ]}
        {...pan.panHandlers}
      >
        <View style={styles.handle} />
        {children}
      </Animated.View>
    </Modal>
  );
}

/**
 * Klavyenin sayfayı ne kadar örttüğü. Pencere klavyeyle küçülüyorsa (adjustResize) örtme yoktur;
 * küçülmüyorsa (kenardan kenara görünüm) klavyenin üst kenarı ile pencerenin altı arasındaki fark.
 */
function useKeyboardOverlap(enabled: boolean): {
  overlap: number;
  windowHeight: number;
  setWindowHeight: (height: number) => void;
} {
  const [windowHeight, setWindowHeight] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardTop(e.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));
    return () => {
      show.remove();
      hide.remove();
      setKeyboardTop(null);
    };
  }, [enabled]);
  const overlap = enabled && keyboardTop !== null && windowHeight > 0 ? Math.max(0, windowHeight - keyboardTop) : 0;
  return { overlap, windowHeight, setWindowHeight };
}

// ---------- Sayfanın içindeki ortak parçalar (tüm menüler aynı görünsün) ----------

type IconName = keyof typeof Ionicons.glyphMap;

/** Sayfanın başlığı: isteğe bağlı solda resim (avatar), başlık ve alt satır */
export function SheetHeader({ title, subtitle, leading }: { title: string; subtitle?: string; leading?: ReactNode }) {
  return (
    <View style={styles.header}>
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Yuvarlak köşeli öğe grubu; öğelerin arasına ince çizgi girer (boş öğeler atlanır) */
export function SheetGroup({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter((c) => isValidElement(c));
  if (items.length === 0) return null;
  return (
    <View style={styles.group}>
      {items.map((child, i) => (
        <Fragment key={isValidElement(child) && child.key != null ? child.key : i}>
          {i > 0 && <View style={styles.divider} />}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

/** Menü öğesi: simge, ad, isteğe bağlı açıklama; tehlikeli işlem kırmızı */
export function SheetItem({
  icon,
  label,
  hint,
  onPress,
  danger,
  disabled,
  trailing,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  const color = danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={danger ? { color: 'rgba(242,63,67,0.14)', foreground: true } : ripple.row}
      accessibilityRole="button"
      style={[styles.item, disabled && { opacity: 0.45 }]}
    >
      <Ionicons name={icon} size={21} color={danger ? colors.danger : colors.muted} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemText, { color: danger ? colors.danger : colors.head }]} numberOfLines={2}>
          {label}
        </Text>
        {hint ? <Text style={[styles.itemHint, danger && { color }]}>{hint}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

/** Menüdeki açıklama satırı (yapılacak bir şey yoksa gibi) */
export function SheetNote({ children }: { children: ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: colors.backdrop },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.side,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: space.sm,
    elevation: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.control,
    marginBottom: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg + 2,
    paddingBottom: space.md,
  },
  headerTitle: { color: colors.head, fontSize: font.title + 1, fontWeight: '700' },
  headerSub: { color: colors.muted, fontSize: font.small, marginTop: 2 },
  group: {
    backgroundColor: colors.main,
    borderRadius: radius.lg - 4,
    marginHorizontal: space.md,
    marginBottom: space.md,
    overflow: 'hidden',
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 52 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 15, minHeight: 52, paddingHorizontal: space.lg, paddingVertical: space.md },
  itemText: { fontSize: font.row, fontWeight: '500' },
  itemHint: { color: colors.muted, fontSize: font.caption + 0.5, marginTop: 2 },
  note: { color: colors.muted, fontSize: font.small + 0.5, paddingHorizontal: space.lg + 2, paddingBottom: space.md, lineHeight: 20 },
});
