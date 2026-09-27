import { Ionicons } from '@expo/vector-icons';
import type { VoiceState } from '@diskort/shared';
import { colors } from '../theme';

/** Ses durumu simgesi: kendi ya da sunucu sağırlaştırması, kendi ya da sunucu susturması */
export function VoiceStateIcon({ state, size = 16 }: { state: VoiceState; size?: number }) {
  if (state.selfDeaf || state.serverDeaf) {
    return (
      <Ionicons
        name="volume-mute"
        size={size}
        color={colors.danger}
        accessibilityLabel={state.serverDeaf ? 'Sunucuda sağırlaştırıldı' : 'Sağırlaştırıldı'}
      />
    );
  }
  if (state.selfMute || state.serverMute) {
    return (
      <Ionicons
        name="mic-off"
        size={size}
        color={colors.danger}
        accessibilityLabel={state.serverMute ? 'Sunucuda susturuldu' : 'Susturuldu'}
      />
    );
  }
  return null;
}
