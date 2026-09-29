import { memo, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHANNEL_MEDIA_PAGE_SIZE, isImageAttachment, type Attachment, type ChannelMediaItem } from '@diskort/shared';
import { api, attachmentUrl } from '@diskort/client-core';
import { ImageViewer } from '../Attachments';
import { EmptyState, ErrorState } from '../States';
import { VideoAttachment } from '../VideoAttachment';
import { colors, createStyles, font, space } from '../../theme';
import { goToMessage } from './goToMessage';
import { usePaged } from './usePaged';

const COLUMNS = 3;
const GAP = 3;

/** "1:15" biçiminde süre */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Kanalın "Medya" sekmesi: kanalda paylaşılan resim ve videolar, en yeni üstte, sayfa sayfa. Resme dokununca
 * tam ekran görüntüleyici, videoya dokununca oynatıcı; uzun basınca sohbette mesajına gidilir.
 */
export function MediaGrid({ channelId, active }: { channelId: string; active: boolean }) {
  const { width } = useWindowDimensions();
  const size = Math.floor((width - space.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
  const fetchPage = useCallback((before: string | null) => api.channelMedia(channelId, before), [channelId]);
  const page = usePaged(channelId, active, fetchPage, CHANNEL_MEDIA_PAGE_SIZE / 2);
  const [viewing, setViewing] = useState<Attachment | null>(null);

  const renderItem = useCallback(
    ({ item }: { item: ChannelMediaItem }) => (
      <MediaTile item={item} size={size} onOpen={setViewing} onLongPress={() => goToMessage(channelId, item.messageId)} />
    ),
    [size, channelId],
  );

  if (page.error) return <ErrorState text={page.error} onRetry={page.retry} />;
  if (page.loading) return <ActivityIndicator color={colors.muted} style={styles.loading} />;

  return (
    <>
      <FlatList
        data={page.items}
        keyExtractor={(i) => i.attachment.id}
        numColumns={COLUMNS}
        renderItem={renderItem}
        columnWrapperStyle={styles.columns}
        ItemSeparatorComponent={RowGap}
        contentContainerStyle={styles.content}
        onEndReached={page.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl refreshing={page.refreshing} onRefresh={page.refresh} tintColor={colors.muted} colors={[colors.brand]} />
        }
        ListFooterComponent={page.loadingMore ? <ActivityIndicator color={colors.muted} style={styles.more} /> : null}
        ListEmptyComponent={
          <EmptyState
            icon="images-outline"
            tone="muted"
            title="Henüz medya yok"
            text="Bu kanalda paylaşılan resimler ve videolar burada görünür."
          />
        }
      />
      {viewing &&
        (isImageAttachment(viewing) ? (
          <ImageViewer attachment={viewing} onClose={() => setViewing(null)} />
        ) : (
          <VideoViewer attachment={viewing} onClose={() => setViewing(null)} />
        ))}
    </>
  );
}

const MediaTile = memo(function MediaTile({
  item,
  size,
  onOpen,
  onLongPress,
}: {
  item: ChannelMediaItem;
  size: number;
  onOpen: (a: Attachment) => void;
  onLongPress: () => void;
}) {
  const a = item.attachment;
  const image = isImageAttachment(a);
  return (
    <Pressable
      onPress={() => onOpen(a)}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="imagebutton"
      accessibilityLabel={`${image ? 'Resim' : 'Video'}: ${a.name}`}
      accessibilityHint="Uzun basınca sohbette mesajına gider"
      style={({ pressed }) => [styles.tile, { width: size, height: size }, pressed && { opacity: 0.75 }]}
    >
      {image ? (
        // Küçük gösterilir: Android özgün resmi değil, karonun boyutunu çözer
        <Image source={{ uri: attachmentUrl(a) }} style={StyleSheet.absoluteFill} resizeMode="cover" resizeMethod="resize" />
      ) : (
        <View style={styles.video}>
          <View style={styles.play}>
            <Ionicons name="play" size={20} color="#fff" style={{ marginLeft: 2 }} />
          </View>
          {a.duration ? <Text style={styles.duration}>{formatDuration(a.duration)}</Text> : null}
        </View>
      )}
    </Pressable>
  );
});

function RowGap() {
  return <View style={styles.rowGap} />;
}

/** Videoyu tam ekranda (koyu zeminde) oynatır: mesajdaki oynatıcının aynısı */
function VideoViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const { width } = useWindowDimensions();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.viewer}>
        <View style={styles.viewerBar}>
          <Text style={styles.viewerName} numberOfLines={1}>
            {attachment.name}
          </Text>
          <Pressable hitSlop={10} onPress={onClose} accessibilityLabel="Kapat">
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
        <Pressable style={styles.viewerBody} onPress={onClose}>
          <VideoAttachment attachment={attachment} maxWidth={width} />
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = createStyles(() => ({
  loading: { paddingVertical: space.xxl },
  more: { paddingVertical: space.lg },
  content: { padding: space.lg, flexGrow: 1 },
  rowGap: { height: GAP },
  columns: { gap: GAP },
  tile: { backgroundColor: colors.side, borderRadius: 6, overflow: 'hidden' },
  video: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.deep },
  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  duration: {
    position: 'absolute',
    right: 6,
    bottom: 5,
    color: '#fff',
    fontSize: font.caption - 1,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  viewerBar: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  viewerName: { flex: 1, color: '#fff', fontSize: font.body, fontWeight: '600' },
  viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
}));
