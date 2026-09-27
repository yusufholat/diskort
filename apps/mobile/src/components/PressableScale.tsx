import {
  Animated,
  Pressable,
  type PressableAndroidRippleConfig,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { usePressScale } from '../motion';
import { ripple as ripples } from '../theme';

/**
 * Basınca hafifçe küçülüp bırakınca yaylanarak geri gelen Pressable (ölçek yerel sürücüde oynar).
 * `ripple` verilirse Android'in dokunma dalgası da çizilir. Yerleşim (flex, kenar boşluğu, genişlik)
 * `containerStyle` ile dıştaki canlandırılan kutuya verilir.
 */
export function PressableScale({
  scaleTo = 0.95,
  containerStyle,
  onPressIn,
  onPressOut,
  ripple,
  ...rest
}: PressableProps & {
  scaleTo?: number;
  containerStyle?: StyleProp<ViewStyle>;
  /** true: kutunun içinde dalga; 'icon': yuvarlak (simge düğmesi); ya da özel ayar */
  ripple?: boolean | 'icon' | PressableAndroidRippleConfig;
}) {
  const press = usePressScale(scaleTo);
  const rippleConfig =
    ripple === true ? ripples.row : ripple === 'icon' ? ripples.icon : ripple ? ripple : undefined;
  return (
    <Animated.View style={[containerStyle, { transform: [{ scale: press.scale }] }]}>
      <Pressable
        android_ripple={rippleConfig}
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
