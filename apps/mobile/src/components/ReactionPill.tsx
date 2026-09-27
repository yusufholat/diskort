import { useRef } from 'react';
import { Animated, Pressable, Text } from 'react-native';
import { useAppear, useBump } from '../motion';
import { colors, createStyles } from '../theme';

/**
 * Mesajın altındaki tepki: mesaj ekrandayken eklenince büyüyerek belirir, sayı ya da benim
 * tepkim değişince zıplar; basınca hafifçe içe göçer. Uzun basınca kimlerin tepki verdiği açılır.
 */
export function ReactionPill({
  emoji,
  count,
  me,
  animateIn,
  onPress,
  onLongPress,
}: {
  emoji: string;
  count: number;
  me: boolean;
  animateIn: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  // İlk çizimdeki değer: geçmişle gelen tepkiler animasyonsuz görünür
  const popIn = useRef(animateIn).current;
  const appear = useAppear(popIn, 240);
  const bump = useBump(`${count}:${me}`);
  const press = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View
      style={{
        opacity: appear,
        transform: [
          { scale: Animated.multiply(Animated.multiply(bump, press), appear.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] })) },
        ],
      }}
    >
      <Pressable
        hitSlop={3}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={300}
        onPressIn={() => Animated.spring(press, { toValue: 0.9, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
        onPressOut={() => Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 10 }).start()}
        style={[styles.pill, me && styles.pillMine]}
        accessibilityLabel={`${emoji} ${count}`}
        accessibilityHint="Tepki verenleri görmek için uzun bas"
        accessibilityState={{ selected: me }}
      >
        <Text style={styles.emoji}>{emoji}</Text>
        <Text style={[styles.count, me && styles.countMine]}>{count}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = createStyles(() => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.side,
  },
  pillMine: { borderColor: colors.brand, backgroundColor: 'rgba(88,101,242,0.22)' },
  emoji: { fontSize: 19, lineHeight: 23 },
  count: { color: colors.muted, fontSize: 13.5, fontWeight: '600' },
  countMine: { color: colors.head },
}));
