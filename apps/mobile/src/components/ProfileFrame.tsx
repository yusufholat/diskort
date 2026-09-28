import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { PROFILE_FRAME_BORDER } from '@diskort/shared';
import { useCosmeticUrl } from '@diskort/client-core';

const CELLS = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ row, col }))).filter((c) => c.row !== 1 || c.col !== 1);

/**
 * Profil çerçevesi: dokuz dilimli resim (masaüstündeki border-image'in karşılığı). Kart ölçülür, her
 * dilim kendi kutusunda resmin ilgili üçte birini gösterir: köşeler olduğu gibi, kenarlar esnetilerek;
 * orta boş. Kartın en üstündedir, dokunmaları engellemez; kart taşanı kırpmalıdır.
 */
export function ProfileFrame({ frame, border = PROFILE_FRAME_BORDER }: { frame: string | null | undefined; border?: number }) {
  const src = useCosmeticUrl('frames', frame);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  if (!src) return null;
  const span = (i: number, total: number): { at: number; length: number } =>
    i === 0 ? { at: 0, length: border } : i === 1 ? { at: border, length: total - 2 * border } : { at: total - border, length: border };
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {size &&
        size.width > 2 * border &&
        size.height > 2 * border &&
        CELLS.map(({ row, col }) => {
          const x = span(col, size.width);
          const y = span(row, size.height);
          // Resim, dilimin üçte biri bu kutuya denk gelecek boyda; kutu dışı kırpılır
          return (
            <View
              key={`${row}${col}`}
              style={{ position: 'absolute', left: x.at, top: y.at, width: x.length, height: y.length, overflow: 'hidden' }}
            >
              <Image
                source={{ uri: src }}
                resizeMode="stretch"
                style={{
                  position: 'absolute',
                  left: -col * x.length,
                  top: -row * y.length,
                  width: 3 * x.length,
                  height: 3 * y.length,
                }}
                accessibilityIgnoresInvertColors
              />
            </View>
          );
        })}
    </View>
  );
}
