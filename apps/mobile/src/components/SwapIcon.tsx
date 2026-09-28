import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Simge değişirken oynayan hareket (anlamına göre):
 * - pop: eskisi küçülüp dönerek söner, yenisi büyüyüp biraz taşarak oturur (mikrofon)
 * - tilt: yana yatarak değişir (kulaklık ↔ sağırlaştır)
 * - flip: kart gibi yatayda döner (hoparlör ↔ ahize)
 * - rise: eskisi yukarı kayıp söner, yenisi aşağıdan gelir (ekran paylaşımı)
 * - turn: çeyrek tur döner (yatay ↔ dikey çevir)
 * - blink: göz kırpar gibi dikeyde kapanıp açılır (yayını izle ↔ bırak)
 * - fade: yalnızca yumuşak geçiş (ses seviyesi simgesi)
 */
export type SwapMotion = 'pop' | 'tilt' | 'flip' | 'rise' | 'turn' | 'blink' | 'fade';

const TIMING: Record<SwapMotion, { duration: number; easing: (t: number) => number }> = {
  pop: { duration: 300, easing: Easing.out(Easing.back(1.8)) },
  tilt: { duration: 320, easing: Easing.out(Easing.back(1.5)) },
  flip: { duration: 320, easing: Easing.out(Easing.cubic) },
  rise: { duration: 260, easing: Easing.out(Easing.cubic) },
  turn: { duration: 320, easing: Easing.out(Easing.back(1.3)) },
  blink: { duration: 260, easing: Easing.inOut(Easing.quad) },
  fade: { duration: 160, easing: Easing.out(Easing.quad) },
};

interface Slot {
  name: IconName;
  color: string;
  /** Bu yuvaya simgenin geldiği değişim sırası (-1: hiç kullanılmadı) */
  at: number;
}

interface SwapState {
  /** Kaçıncı değişim (ilk çizimde 0) */
  n: number;
  /** Şu anki simgenin yuvası */
  cur: 0 | 1;
  slots: [Slot, Slot];
}

/**
 * Durum değişince (sustur ↔ aç, sağırlaştır, hoparlör ↔ ahize, ekran paylaşımı) yenisine canlı geçen
 * simge: eski simge kendi rengiyle söner, yenisi `motion`'a göre belirir. Reanimated ile yalnızca
 * transform ve saydamlık (UI iş parçacığında); yeni yerel modül yok, arayüz güncellemesiyle gelir.
 *
 * İki sabit yuva dönüşümlü kullanılır ve ilerleme her değişimde bir artan tek bir paylaşılan
 * değerdir: yeni simge yuvasına girdiği anda görünmez durumdadır (ilk karede titreme olmaz), üst üste
 * hızlı değişimlerde de geçiş kaldığı yerden sürer. İlk çizimde oynamaz; telefonda "animasyonları
 * kaldır" açıksa simge anında değişir.
 */
export function SwapIcon({
  name,
  size,
  color,
  motion = 'pop',
  style,
}: {
  name: IconName;
  size: number;
  color: string;
  motion?: SwapMotion;
  /** Simgenin kendisine (ör. ayrıl düğmesindeki döndürülmüş telefon) */
  style?: StyleProp<TextStyle>;
}) {
  const reduce = useReducedMotion();
  const [saved, setSaved] = useState<SwapState>(() => ({
    n: 0,
    cur: 0,
    slots: [
      { name, color, at: 0 },
      { name, color, at: -1 },
    ],
  }));

  // Simge değişti: öteki yuvaya yerleşir (render sırasında türetilen durum; React'in önerdiği kalıp)
  let state = saved;
  const active = saved.slots[saved.cur];
  if (active.name !== name) {
    const cur = saved.cur === 0 ? 1 : 0;
    const slots: [Slot, Slot] = [saved.slots[0], saved.slots[1]];
    slots[cur] = { name, color, at: saved.n + 1 };
    state = { n: saved.n + 1, cur, slots };
    setSaved(state);
  } else if (active.color !== color) {
    // Yalnızca renk değişti (ör. tema): yerinde güncellenir
    const slots: [Slot, Slot] = [saved.slots[0], saved.slots[1]];
    slots[saved.cur] = { ...active, color };
    state = { ...saved, slots };
    setSaved(state);
  }

  const progress = useSharedValue(0);
  const n = state.n;
  useEffect(() => {
    if (n === 0) return;
    if (reduce) {
      progress.value = n;
      return;
    }
    // Önceki geçiş yarıda kaldıysa önceki simge tam görünür sayılıp oradan sürer
    if (progress.value < n - 1) progress.value = n - 1;
    progress.value = withTiming(n, TIMING[motion]);
  }, [n, reduce, motion, progress]);

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: size, height: size }}
    >
      {state.slots.map((slot, i) =>
        slot.at < 0 ? null : (
          <SwapSlot
            key={i}
            slot={slot}
            current={i === state.cur}
            progress={progress}
            motion={motion}
            size={size}
            style={style}
          />
        ),
      )}
    </View>
  );
}

function SwapSlot({
  slot,
  current,
  progress,
  motion,
  size,
  style,
}: {
  slot: Slot;
  current: boolean;
  progress: SharedValue<number>;
  motion: SwapMotion;
  size: number;
  style?: StyleProp<TextStyle>;
}) {
  const at = slot.at;
  const animated = useAnimatedStyle(() => {
    // Gelen simge için 0 → 1 (yaylı eğrilerde biraz taşar), giden için 0 → 1
    const t = current ? progress.value - (at - 1) : progress.value - at;
    return swapStyle(motion, t, current);
  });
  return (
    <Reanimated.View style={[styles.slot, animated]}>
      <Ionicons name={slot.name} size={size} color={slot.color} style={style} />
    </Reanimated.View>
  );
}

function swapStyle(motion: SwapMotion, t: number, incoming: boolean) {
  'worklet';
  const c = Math.min(Math.max(t, 0), 1);
  if (incoming) {
    // Taşma dahil (büyüyüp biraz geçer, sonra oturur)
    const e = Math.max(t, 0);
    const late = Math.max(0, (e - 0.5) * 2);
    switch (motion) {
      case 'pop':
        return { opacity: Math.min(c * 2.5, 1), transform: [{ scale: 0.4 + 0.6 * e }, { rotate: `${(1 - e) * -30}deg` }] };
      case 'tilt':
        return { opacity: Math.min(c * 2.5, 1), transform: [{ scale: 0.7 + 0.3 * e }, { rotate: `${(1 - e) * -50}deg` }] };
      case 'flip':
        return { opacity: c >= 0.5 ? 1 : 0, transform: [{ perspective: 200 }, { rotateY: `${(1 - late) * -90}deg` }] };
      case 'rise':
        return { opacity: Math.min(c * 2, 1), transform: [{ translateY: (1 - e) * 8 }] };
      case 'turn':
        return { opacity: Math.min(c * 2, 1), transform: [{ rotate: `${(1 - e) * -90}deg` }] };
      case 'blink':
        return { opacity: c >= 0.5 ? 1 : 0, transform: [{ scaleY: Math.max(0.01, late) }] };
      default:
        return { opacity: c, transform: [] };
    }
  }
  const early = Math.min(1, c * 2);
  switch (motion) {
    case 'pop':
      return { opacity: 1 - Math.min(c * 2.5, 1), transform: [{ scale: 1 - 0.6 * c }, { rotate: `${c * 30}deg` }] };
    case 'tilt':
      return { opacity: 1 - Math.min(c * 2.5, 1), transform: [{ scale: 1 - 0.3 * c }, { rotate: `${c * 50}deg` }] };
    case 'flip':
      return { opacity: c < 0.5 ? 1 : 0, transform: [{ perspective: 200 }, { rotateY: `${early * 90}deg` }] };
    case 'rise':
      return { opacity: 1 - early, transform: [{ translateY: -8 * c }] };
    case 'turn':
      return { opacity: 1 - early, transform: [{ rotate: `${c * 90}deg` }] };
    case 'blink':
      return { opacity: c < 0.5 ? 1 : 0, transform: [{ scaleY: Math.max(0.01, 1 - early) }] };
    default:
      return { opacity: 1 - c, transform: [] };
  }
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
