import type { ReactNode } from 'react';
import { Animated } from 'react-native';
import { useAppear } from '../motion';
import { colors, createStyles, radius, space } from '../theme';

/** Yazma kutusunun üstündeki şerit (düzenleme, yanıt): yukarı kayarak belirir */
export function ContextBar({ children }: { children: ReactNode }) {
  const appear = useAppear(true, 180);
  return (
    <Animated.View
      style={[
        styles.contextBar,
        { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = createStyles(() => ({
  contextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.sm,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: space.sm,
    backgroundColor: colors.side,
    borderRadius: radius.lg - 4,
  },
}));
