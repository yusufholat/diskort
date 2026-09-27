import { View } from 'react-native';
import { STATUS_COLORS, type DisplayStatus } from '@diskort/client-core';

/**
 * Discord biçimli durum simgesi (SVG'siz, yalnızca View): çevrim içi dolu yeşil daire, boşta sarı ay,
 * rahatsız etmeyin ortası çizgili kırmızı daire, çevrimdışı/görünmez gri halka. Oyuklar `surface`
 * renginde çizilir (simgenin durduğu zemin).
 */
export function StatusDot({ status, size, surface }: { status: DisplayStatus; size: number; surface: string }) {
  const color = STATUS_COLORS[status];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, overflow: 'hidden' }}>
      {status === 'idle' && (
        <View
          style={{
            position: 'absolute',
            left: -size * 0.125,
            top: -size * 0.125,
            width: size * 0.75,
            height: size * 0.75,
            borderRadius: size,
            backgroundColor: surface,
          }}
        />
      )}
      {status === 'dnd' && (
        <View
          style={{
            position: 'absolute',
            left: size * 0.125,
            top: size * 0.375,
            width: size * 0.75,
            height: size * 0.25,
            borderRadius: size,
            backgroundColor: surface,
          }}
        />
      )}
      {(status === 'offline' || status === 'invisible') && (
        <View
          style={{
            position: 'absolute',
            left: size * 0.25,
            top: size * 0.25,
            width: size * 0.5,
            height: size * 0.5,
            borderRadius: size,
            backgroundColor: surface,
          }}
        />
      )}
    </View>
  );
}
