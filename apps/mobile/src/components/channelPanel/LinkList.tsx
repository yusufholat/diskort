import { memo, useCallback } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ChannelLinkItem } from '@diskort/shared';
import { api, useGuild } from '@diskort/client-core';
import { EmptyState, ErrorState } from '../States';
import { toast } from '../../stores/ui';
import { messageStamp } from '../MessageRow';
import { colors, createStyles, font, radius, ripple, space } from '../../theme';
import { goToMessage } from './goToMessage';
import { usePaged } from './usePaged';

/** Adresin gösterilen hâli: şemasız, sondaki / olmadan */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return (m?.[1] ?? url).replace(/^www\./i, '');
}

/**
 * Kanalın "Bağlantılar" sekmesi: mesajlarda paylaşılan bağlantılar, en yeni üstte, sayfa sayfa. Başlık
 * bağlantı önizlemesinden (yoksa alan adı). Dokununca bağlantı açılır; uzun basınca sohbette mesajına gidilir.
 */
export function LinkList({ channelId, active }: { channelId: string; active: boolean }) {
  const fetchPage = useCallback((before: string | null) => api.channelLinks(channelId, before), [channelId]);
  const page = usePaged(channelId, active, fetchPage, 12);

  const renderItem = useCallback(
    ({ item, index }: { item: ChannelLinkItem; index: number }) => (
      <LinkRow item={item} first={index === 0} last={index === page.items.length - 1} channelId={channelId} />
    ),
    [channelId, page.items.length],
  );

  if (page.error) return <ErrorState text={page.error} onRetry={page.retry} />;
  if (page.loading) return <ActivityIndicator color={colors.muted} style={styles.loading} />;

  return (
    <FlatList
      data={page.items}
      keyExtractor={(i) => `${i.messageId}:${i.url}`}
      renderItem={renderItem}
      contentContainerStyle={styles.content}
      onEndReached={page.loadMore}
      onEndReachedThreshold={0.6}
      refreshControl={
        <RefreshControl refreshing={page.refreshing} onRefresh={page.refresh} tintColor={colors.muted} colors={[colors.brand]} />
      }
      ListFooterComponent={page.loadingMore ? <ActivityIndicator color={colors.muted} style={styles.more} /> : null}
      ListEmptyComponent={
        <EmptyState icon="link-outline" tone="muted" title="Henüz bağlantı yok" text="Bu kanalda paylaşılan bağlantılar burada görünür." />
      }
    />
  );
}

const LinkRow = memo(function LinkRow({
  item,
  first,
  last,
  channelId,
}: {
  item: ChannelLinkItem;
  first: boolean;
  last: boolean;
  channelId: string;
}) {
  const author = useGuild((s) => (item.authorId ? s.users[item.authorId] : undefined));
  const title = item.title ?? hostOf(item.url);
  const open = (): void => {
    Linking.openURL(item.url).catch(() => toast('Bağlantı açılamadı.', 'error'));
  };
  return (
    <View style={[styles.card, first && styles.cardFirst, last && styles.cardLast]}>
      <Pressable
        onPress={open}
        onLongPress={() => goToMessage(channelId, item.messageId)}
        delayLongPress={350}
        android_ripple={ripple.row}
        accessibilityRole="link"
        accessibilityLabel={`${title}, ${shortUrl(item.url)}`}
        accessibilityHint="Uzun basınca sohbette mesajına gider"
        style={styles.row}
      >
        {!first && <View style={styles.divider} />}
        <View style={styles.icon}>
          <Ionicons name="link" size={20} color={colors.link} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.url} numberOfLines={1}>
            {item.siteName ? `${item.siteName} · ` : ''}
            {shortUrl(item.url)}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {author?.displayName ?? 'Silinmiş Kullanıcı'} · {messageStamp(item.createdAt)}
          </Text>
        </View>
      </Pressable>
    </View>
  );
});

const CARD_RADIUS = radius.lg - 4;
const ICON = 40;

const styles = createStyles(() => ({
  loading: { paddingVertical: space.xxl },
  more: { paddingVertical: space.lg },
  content: { padding: space.lg, flexGrow: 1 },
  card: { backgroundColor: colors.side, overflow: 'hidden' },
  cardFirst: { borderTopLeftRadius: CARD_RADIUS, borderTopRightRadius: CARD_RADIUS },
  cardLast: { borderBottomLeftRadius: CARD_RADIUS, borderBottomRightRadius: CARD_RADIUS },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md + 2, paddingVertical: space.md },
  divider: {
    position: 'absolute',
    top: 0,
    left: space.md + 2 + ICON + space.md,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
  },
  icon: {
    width: ICON,
    height: ICON,
    borderRadius: radius.md,
    backgroundColor: colors.main,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  title: { color: colors.head, fontSize: font.row - 0.5, fontWeight: '600' },
  url: { color: colors.link, fontSize: font.small, marginTop: 1 },
  meta: { color: colors.faint, fontSize: font.caption, marginTop: 2 },
}));
