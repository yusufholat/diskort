import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { usePressScale } from '../motion';

/**
 * Basınca hafifçe küçülüp bırakınca yaylanarak geri gelen Pressable. Yerleşim (flex, kenar
 * boşluğu, genişlik) `containerStyle` ile dıştaki canlandırılan kutuya verilir.
 */
export function PressableScale({
  scaleTo = 0.95,
  containerStyle,
  onPressIn,
  onPressOut,
  ...rest
}: PressableProps & { scaleTo?: number; containerStyle?: StyleProp<ViewStyle> }) {
  const press = usePressScale(scaleTo);
  return (
    <Animated.View style={[containerStyle, { transform: [{ scale: press.scale }] }]}>
      <Pressable
        {...rest}
        onPressIn={(e) => {
          press.onPressIn();
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          press.onPressOut();
          onPressOut?.(e);
        }}
      />
    </Animated.View>
  );
}
