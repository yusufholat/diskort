import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useGuild } from '@diskort/client-core';
import { animateNextLayout } from '../motion';
import { colors, createStyles, font, radius, space } from '../theme';

/** Kısa kopmalarda (uygulama öne gelince yeniden bağlanma) şerit yanıp sönmesin diye bekleme */
const SHOW_DELAY_MS = 900;

/**
 * Sunucu bağlantısı yoksa ekranın üstünde ince şerit: yumuşakça açılır, bağlanınca kapanır.
 * Bir saniyeden kısa kopmalarda hiç görünmez.
 */
export function ConnectionBanner() {
  const status = useGuild((s) => s.status);
  const down = status !== 'ready';
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!down) return;
    const timer = setTimeout(() => {
      animateNextLayout(220);
      setShown(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [down]);

  useEffect(() => {
    if (down || !shown) return;
    animateNextLayout(220);
    setShown(false);
  }, [down, shown]);

  if (!shown) return null;
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color="#000" />
      <Text style={styles.text}>
        {status === 'reconnecting' ? 'Bağlantı koptu, yeniden bağlanılıyor…' : 'Sunucuya bağlanılıyor…'}
      </Text>
    </View>
  );
}

const styles = createStyles(() => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.warn,
    paddingVertical: 6,
    paddingHorizontal: space.md,
    marginHorizontal: space.sm,
    marginTop: space.xs,
    borderRadius: radius.md,
  },
  text: { color: '#000', fontSize: font.small - 0.5, fontWeight: '700' },
}));
