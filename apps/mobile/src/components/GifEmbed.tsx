import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { GifEmbed as GifEmbedData } from '@diskort/shared';
import { fitBox } from '@diskort/client-core';
import { colors, createStyles } from '../theme';

/** Mesaj satırında avatar sütunu ve sağ boşluk (Attachments ile aynı) */
const ROW_INSET = 64 + 14;
const MAX_HEIGHT = 320;

/**
 * Mesajdaki GIF (GIPHY): kutu boyutu baştan bilinir (liste kaymaz), hareketli GIF olarak çizilir
 * (Android'de GIF desteği açık; hareketli WebP kapalı olduğundan WebP kullanılmaz).
 */
export function GifEmbed({ embed, dim = false }: { embed: GifEmbedData; dim?: boolean }) {
  const { width } = useWindowDimensions();
  const maxWidth = Math.min(width - ROW_INSET, 420);
  const box = fitBox(embed.width, embed.height, { width: maxWidth, height: MAX_HEIGHT }) ?? { width: 240, height: 180 };
  return (
    <View style={[styles.box, box, dim && { opacity: 0.6 }]} accessibilityLabel={embed.title || 'GIF'}>
      <Image source={{ uri: embed.gif }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <Text style={styles.badge}>GIF</Text>
    </View>
  );
}

const styles = createStyles(() => ({
  box: { marginTop: 4, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.side },
  badge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.55)',
    color: 'rgba(255,255,255,0.9)',
    fontSize: 10,
    fontWeight: '700',
  },
}));
