import { Ionicons } from '@expo/vector-icons';
import { Permission, type VoiceState } from '@diskort/shared';
import { can, useGuild } from '@diskort/client-core';
import { colors } from '../theme';

/**
 * Ses durumu simgesi: kendi ya da sunucu sağırlaştırması, kendi ya da sunucu susturması, kanalda konuşma
 * yetkisinin olmaması.
 */
export function VoiceStateIcon({ state, size = 16 }: { state: VoiceState; size?: number }) {
  const suppressed = useGuild((s) => !can(s, state.userId, Permission.SPEAK, state.channelId));
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
  if (state.selfMute || state.serverMute || suppressed) {
    return (
      <Ionicons
        name="mic-off"
        size={size}
        color={colors.danger}
        accessibilityLabel={
          state.serverMute ? 'Sunucuda susturuldu' : suppressed ? 'Bu kanalda konuşma izni yok' : 'Susturuldu'
        }
      />
    );
  }
  return null;
}
