import type { ReactNode } from 'react';
import { Animated, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppear } from '../motion';
import { colors, createStyles, font, radius, space } from '../theme';
import { Button } from './ui';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Boş durum: renkli simge kutusu, başlık, kısa açıklama ve isteğe bağlı eylem. Hafifçe yükselerek
 * belirir. Listelerde `ListEmptyComponent` olarak kullanılır (liste `flexGrow: 1` olmalı).
 */
export function EmptyState({
  icon,
  title,
  text,
  action,
  tone = 'brand',
  style,
}: {
  icon: IconName;
  title: string;
  text?: string;
  action?: { title: string; onPress: () => void };
  tone?: 'brand' | 'muted' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const appear = useAppear(true, 260);
  const bg = tone === 'brand' ? colors.brand : tone === 'danger' ? colors.dangerSoft : colors.active;
  const fg = tone === 'danger' ? colors.danger : '#fff';
  return (
    <Animated.View
      style={[
        styles.wrap,
        style,
        { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={34} color={fg} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {text ? <Text style={styles.text}>{text}</Text> : null}
      {action ? (
        <View style={styles.action}>
          <Button title={action.title} onPress={action.onPress} />
        </View>
      ) : null}
    </Animated.View>
  );
}

/** Yüklenemedi: neden ve "Tekrar dene" */
export function ErrorState({
  title = 'Yüklenemedi',
  text,
  onRetry,
  style,
}: {
  title?: string;
  text: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      tone="danger"
      title={title}
      text={text}
      action={onRetry ? { title: 'Tekrar dene', onPress: onRetry } : undefined}
      style={style}
    />
  );
}

/** Ekranın üstündeki bilgi şeridi (bağlantı, izin gibi); `tone` rengini belirler */
export function Notice({
  icon,
  children,
  tone = 'muted',
}: {
  icon?: IconName;
  children: ReactNode;
  tone?: 'warn' | 'muted' | 'ok' | 'danger';
}) {
  const palette = {
    warn: { bg: colors.warnSoft, fg: colors.warn },
    muted: { bg: colors.side, fg: colors.text },
    ok: { bg: colors.okSoft, fg: '#2dc770' },
    danger: { bg: colors.dangerSoft, fg: colors.dangerText },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg }]}>
      {icon ? <Ionicons name={icon} size={16} color={palette.fg} /> : null}
      <Text style={[styles.noticeText, { color: palette.fg }]}>{children}</Text>
    </View>
  );
}

const styles = createStyles(() => ({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  title: { color: colors.head, fontSize: font.heading - 1, fontWeight: '700', textAlign: 'center' },
  text: { color: colors.muted, fontSize: font.body - 0.5, textAlign: 'center', marginTop: space.sm, lineHeight: 21 },
  action: { alignSelf: 'stretch', marginTop: space.xl },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    marginHorizontal: space.sm,
    marginTop: space.sm,
    borderRadius: radius.md,
  },
  noticeText: { flex: 1, fontSize: font.small, fontWeight: '600', lineHeight: 18 },
}));
