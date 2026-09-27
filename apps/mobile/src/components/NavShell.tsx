import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { BackHandler, Keyboard, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { setPanelOpen, useNav } from '../stores/nav';
import { colors, createStyles } from '../theme';

/**
 * Ana ekranın iskeleti (Discord mobil gibi): üstte sohbet, altında sol panel. Sohbetin herhangi bir
 * yerinden sağa kaydırınca sohbet parmağı izleyerek sağa kayar ve altındaki panel görünür; açıkken
 * sohbetin sağ kenarda kalan kısmına dokununca ya da sola kaydırınca (panelin üstünde de) kapanır.
 *
 * Hareketler çakışmaz: sağa kaydırma paneli açar, mesaj satırını sola kaydırmak yanıtlar (MessageRow),
 * dikey kaydırma listelerindir (hareket dikeye kayınca panel hareketi bırakır). Yazma kutusundaki
 * yatay dosya şeridi kendi kaydırmasını önce alır (gesture-handler ScrollView'i).
 *
 * Geri tuşu: sohbetteyken paneli açar; panel açıkken uygulamadan çıkar (Discord'daki gibi). Android'in
 * kenardan geri hareketi de böylece paneli açar.
 */

/** Panel açıkken sohbetin sağ kenarda görünen kısmı (dp) */
const PEEK = 56;
/** Panel açılırken soldan bu kadar kayarak yerine gelir (sohbetten yavaş: derinlik hissi) */
const PARALLAX = 56;
/** Bu hızdan (dp/sn) hızlı savurunca konumdan bağımsız açılır/kapanır */
const FLING = 500;

const SPRING = { damping: 32, stiffness: 320, mass: 1, overshootClamping: true } as const;

export function NavShell({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  const { width: screenWidth } = useWindowDimensions();
  const offset = Math.min(screenWidth - PEEK, 440);
  const open = useNav((s) => s.panelOpen);
  /** 0: sohbet, 1: panel açık (sürüklerken arada) */
  const progress = useSharedValue(open ? 1 : 0);
  const start = useSharedValue(0);
  /** Kaydırmanın zaten canlandırdığı hedef: durum değişince ikinci kez canlandırılmaz */
  const gestureTarget = useRef<boolean | null>(null);

  // Durum değişince (düğme, geri tuşu, kanal seçildi) panel yumuşakça açılır/kapanır
  useEffect(() => {
    if (open) Keyboard.dismiss();
    if (gestureTarget.current === open) {
      gestureTarget.current = null;
      return;
    }
    gestureTarget.current = null;
    progress.value = withSpring(open ? 1 : 0, SPRING);
  }, [open, progress]);

  // Kaydırma bırakıldı: canlandırma zaten başladı, durum yalnızca değiştiyse güncellenir
  const settled = useCallback((target: boolean) => {
    if (useNav.getState().panelOpen === target) return;
    gestureTarget.current = target;
    setPanelOpen(target);
  }, []);

  const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);

  // Sohbette sağa (açmak), panel açıkken sola (kapatmak) kaydırma. Yalnızca yatay hareket alınır.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(open ? -10 : 10)
        .failOffsetX(open ? 24 : -10)
        .failOffsetY([-14, 14])
        .onStart(() => {
          start.value = progress.value;
          if (!open) scheduleOnRN(dismissKeyboard);
        })
        .onUpdate((e) => {
          progress.value = Math.min(1, Math.max(0, start.value + e.translationX / offset));
        })
        .onEnd((e) => {
          const v = e.velocityX;
          let target: boolean;
          if (Math.abs(v) > FLING) target = v > 0;
          // Açarken üçte birden fazla, kapatırken üçte birden fazla sürüklemek yeter
          else target = start.value < 0.5 ? progress.value > 0.33 : progress.value > 0.67;
          progress.value = withSpring(target ? 1 : 0, { ...SPRING, velocity: v / offset });
          scheduleOnRN(settled, target);
        }),
    [open, offset, progress, start, settled, dismissKeyboard],
  );

  // Sohbetteyken geri tuşu paneli açar; panel açıkken varsayılan davranış (uygulamadan çık)
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (useNav.getState().panelOpen) return false;
        setPanelOpen(true);
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  const chatStyle = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * offset }] }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * PARALLAX }] }));
  const shadeStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.35 }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.root}>
        <Reanimated.View
          style={[styles.panel, { width: offset }, panelStyle]}
          pointerEvents={open ? 'auto' : 'none'}
          importantForAccessibility={open ? 'yes' : 'no-hide-descendants'}
        >
          {panel}
        </Reanimated.View>
        <Reanimated.View style={[styles.chat, chatStyle]}>
          <View style={styles.fill} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}>
            {children}
          </View>
          <Reanimated.View style={[StyleSheet.absoluteFill, styles.shade, shadeStyle]} pointerEvents={open ? 'auto' : 'none'}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setPanelOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Sohbete dön"
            />
          </Reanimated.View>
        </Reanimated.View>
      </View>
    </GestureDetector>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.rail, overflow: 'hidden' },
  fill: { flex: 1 },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  chat: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.main,
    elevation: 12,
    // Siyah temada gölge görünmez: ince kenar sohbeti panelden ayırır
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.edge,
  },
  shade: { backgroundColor: '#000' },
}));
