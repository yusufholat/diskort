import { memo, useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ChannelMediaItem } from '@diskort/shared';
import { api, formatBytes, useGuild } from '@diskort/client-core';
import { openAttachment } from '../../attachments';
import { EmptyState, ErrorState } from '../States';
import { messageStamp } from '../MessageRow';
import { colors, createStyles, font, radius, ripple, space } from '../../theme';
import { goToMessage } from './goToMessage';
import { usePaged } from './usePaged';

type IconName = keyof typeof Ionicons.glyphMap;

/** Dosyanın türüne (MIME, yoksa uzantı) göre simge */
function fileIcon(contentType: string, name: string): IconName {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (contentType.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'].includes(ext)) return 'musical-notes';
  if (contentType === 'application/vnd.android.package-archive' || ext === 'apk') return 'logo-android';
  if (contentType === 'application/pdf' || ext === 'pdf') return 'document-text';
  if (
    /zip|rar|7z|tar|gzip|compressed/i.test(contentType) ||
    ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'].includes(ext)
  )
    return 'archive';
  if (
    contentType.startsWith('text/') ||
    /word|document|sheet|excel|presentation|powerpoint/i.test(contentType) ||
    ['txt', 'md', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'csv'].includes(ext)
  )
    return 'document-text';
  if (['js', 'ts', 'json', 'html', 'css', 'xml', 'py', 'java', 'kt', 'c', 'cpp', 'cs', 'go', 'rs', 'sh'].includes(ext)) return 'code-slash';
  return 'document';
}

/**
 * Kanalın "Dosyalar" sekmesi: kanalda paylaşılan resim/video dışındaki dosyalar (belge, arşiv, ses, APK…), en
 * yeni üstte, sayfa sayfa. Dokununca sohbetteki eklerle aynı biçimde indirilip açılır (APK güvenlik davranışı
 * dâhil); uzun basınca sohbette mesajına gidilir.
 */
export function FileList({ channelId, active }: { channelId: string; active: boolean }) {
  const fetchPage = useCallback((before: string | null) => api.channelFiles(channelId, before), [channelId]);
  const page = usePaged(channelId, active, fetchPage, 12);

  const renderItem = useCallback(
    ({ item, index }: { item: ChannelMediaItem; index: number }) => (
      <FileRow item={item} first={index === 0} last={index === page.items.length - 1} channelId={channelId} />
    ),
    [channelId, page.items.length],
  );

  if (page.error) return <ErrorState text={page.error} onRetry={page.retry} />;
  if (page.loading) return <ActivityIndicator color={colors.muted} style={styles.loading} />;

  return (
    <FlatList
      data={page.items}
      keyExtractor={(i) => i.attachment.id}
      renderItem={renderItem}
      contentContainerStyle={styles.content}
      onEndReached={page.loadMore}
      onEndReachedThreshold={0.6}
      refreshControl={
        <RefreshControl refreshing={page.refreshing} onRefresh={page.refresh} tintColor={colors.muted} colors={[colors.brand]} />
      }
      ListFooterComponent={page.loadingMore ? <ActivityIndicator color={colors.muted} style={styles.more} /> : null}
      ListEmptyComponent={
        <EmptyState icon="document-outline" tone="muted" title="Henüz dosya yok" text="Bu kanalda paylaşılan dosyalar burada görünür." />
      }
    />
  );
}

const FileRow = memo(function FileRow({
  item,
  first,
  last,
  channelId,
}: {
  item: ChannelMediaItem;
  first: boolean;
  last: boolean;
  channelId: string;
}) {
  const author = useGuild((s) => (item.authorId ? s.users[item.authorId] : undefined));
  const a = item.attachment;
  const size = a.size > 0 ? `${formatBytes(a.size)} · ` : '';
  return (
    <View style={[styles.card, first && styles.cardFirst, last && styles.cardLast]}>
      <Pressable
        onPress={() => void openAttachment(a)}
        onLongPress={() => goToMessage(channelId, item.messageId)}
        delayLongPress={350}
        android_ripple={ripple.row}
        accessibilityRole="button"
        accessibilityLabel={a.size > 0 ? `${a.name}, ${formatBytes(a.size)}` : a.name}
        accessibilityHint="Uzun basınca sohbette mesajına gider"
        style={styles.row}
      >
        {!first && <View style={styles.divider} />}
        <View style={styles.icon}>
          <Ionicons name={fileIcon(a.contentType, a.name)} size={20} color={colors.link} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1} ellipsizeMode="middle">
            {a.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {size}
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
  meta: { color: colors.faint, fontSize: font.caption, marginTop: 2 },
}));
