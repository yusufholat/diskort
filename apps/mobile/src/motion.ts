import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, LayoutAnimation } from 'react-native';

/**
 * Hareket yardımcıları: yalnızca React Native'in kendi Animated ve LayoutAnimation API'leri
 * (yerel bağımlılık yok; arayüz güncellemesiyle telefona ulaşır). Telefonda "animasyonları kaldır"
 * açıksa süreler sıfırlanır.
 */

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((value) => {
    reduceMotion = value;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
  reduceMotion = value;
});

export function prefersReducedMotion(): boolean {
  return reduceMotion;
}

/** Animasyonlar kapalıysa 0 */
export const duration = (ms: number): number => (reduceMotion ? 0 : ms);

export const EASE_OUT = Easing.out(Easing.cubic);
export const EASE_IN = Easing.in(Easing.cubic);

/** Yumuşak yay (basma geri bildirimi, açılan sayfa) */
export function spring(value: Animated.Value, toValue: number, bounciness = 6): Animated.CompositeAnimation {
  if (reduceMotion) return Animated.timing(value, { toValue, duration: 0, useNativeDriver: true });
  return Animated.spring(value, { toValue, useNativeDriver: true, speed: 28, bounciness });
}

export function timing(value: Animated.Value, toValue: number, ms: number, easing = EASE_OUT): Animated.CompositeAnimation {
  return Animated.timing(value, { toValue, duration: duration(ms), easing, useNativeDriver: true });
}

/**
 * Bir sonraki yerleşim değişikliğini (liste satırı eklenip çıkınca diğerlerinin kayması,
 * yeni öğenin belirmesi) canlandırır.
 */
export function animateNextLayout(ms = 200, animateCreate = true): void {
  if (reduceMotion) return;
  LayoutAnimation.configureNext({
    duration: ms,
    // Yeni öğeyi kendisi canlandıran bileşenlerde (Animated) çakışmasın diye kapatılabilir
    ...(animateCreate
      ? { create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity } }
      : {}),
    update: { type: LayoutAnimation.Types.easeOut },
    delete: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
  });
}

/**
 * Anahtar (ör. üye listesi) değişince bir sonraki yerleşimi canlandırır. Değişiklik render
 * sırasında fark edilir; LayoutAnimation bu render'ın yerleşimine uygulanır.
 */
export function useLayoutAnimationOn(key: string, ms = 200, animateCreate = true): void {
  const last = useRef(key);
  if (last.current !== key) {
    last.current = key;
    animateNextLayout(ms, animateCreate);
  }
}

/** Basınca hafifçe küçülen öğe için ölçek değeri ve Pressable olayları */
export function usePressScale(pressedScale = 0.95) {
  const scale = useRef(new Animated.Value(1)).current;
  return {
    scale,
    onPressIn: () => spring(scale, pressedScale, 0).start(),
    onPressOut: () => spring(scale, 1, 8).start(),
  };
}

/** Bileşen ilk çizildiğinde 0 → 1 giden değer (belirerek girme) */
export function useAppear(enabled: boolean, ms = 220): Animated.Value {
  const value = useRef(new Animated.Value(enabled ? 0 : 1)).current;
  useEffect(() => {
    if (enabled) timing(value, 1, ms).start();
  }, [enabled, ms, value]);
  return value;
}

/** Değer değişince kısa bir zıplama (tepki sayısı gibi); ilk çizimde oynamaz */
export function useBump(key: unknown): Animated.Value {
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduceMotion) return;
    scale.setValue(0.8);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 14 }).start();
  }, [key, scale]);
  return scale;
}

/** Hatalı gönderimde yatay sallanma */
export function useShake(): [Animated.Value, () => void] {
  const x = useRef(new Animated.Value(0)).current;
  const run = (): void => {
    if (reduceMotion) return;
    x.setValue(0);
    Animated.sequence(
      [-8, 7, -5, 3, 0].map((toValue) => Animated.timing(x, { toValue, duration: 55, useNativeDriver: true })),
    ).start();
  };
  return [x, run];
}

/** Açık/kapalı durumuna göre görünür kalma: kapanış animasyonu bitene kadar true döner */
export function usePresence(open: boolean, exitMs: number): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), duration(exitMs));
    return () => clearTimeout(timer);
  }, [open, exitMs]);
  return open || mounted;
}
