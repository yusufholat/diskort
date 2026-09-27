import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GifResult } from '@diskort/shared';
import {
  closeGifPicker,
  isGiphyMedia,
  loadMoreGifs,
  openGifPicker,
  retryGifs,
  setGifQuery,
  useGifPicker,
} from '@diskort/client-core';
import { colors, createStyles } from '../theme';
import { BottomSheet } from './BottomSheet';
import { EmojiGrid } from './EmojiGrid';

export type ExpressionTab = 'gif' | 'emoji';

const PADDING = 12;
const GAP = 8;
/** Sona bu kadar kala sonraki sayfa yüklenir */
const LOAD_MORE_MARGIN = 500;

interface Props {
  /** Açık sekme; null: kapalı */
  tab: ExpressionTab | null;
  /** GIF sekmesi gösterilsin mi (sunucuda GIF araması açık ve düzenleme kipinde değil) */
  gifs: boolean;
  onTab: (tab: ExpressionTab) => void;
  onClose: () => void;
  onEmoji: (emoji: string) => void;
  onGif: (gif: GifResult) => void;
}

/**
 * Mesaj kutusundaki GIF/emoji düğmesinin açtığı alt sayfa: GIF'ler (arama kutusu, iki sütunlu
 * ızgara, kaydırdıkça devamı, dokununca hemen gönderir; "Powered by GIPHY") ve emojiler.
 */
export function ExpressionSheet({ tab, gifs, onTab, onClose, onEmoji, onGif }: Props) {
  const { height } = useWindowDimensions();
  const current = tab === 'gif' && !gifs ? 'emoji' : tab;
  const gifOpen = current === 'gif';

  useEffect(() => {
    if (!gifOpen) return;
    openGifPicker();
    return closeGifPicker;
  }, [gifOpen]);

  const tabs: { id: ExpressionTab; label: string }[] = [
    ...(gifs ? [{ id: 'gif' as const, label: "GIF'ler" }] : []),
    { id: 'emoji', label: 'Emoji' },
  ];

  return (
    <BottomSheet visible={tab !== null} onClose={onClose} avoidKeyboard>
      <View style={styles.tabs}>
        {tabs.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => onTab(t.id)}
            style={[styles.tab, current === t.id && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: current === t.id }}
          >
            <Text style={[styles.tabText, current === t.id && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {/* Sabit yükseklik: yoksa GIF ızgarası tüm içeriği kadar uzar, sekmeler ve arama kutusu ekranın
          üstünden taşar. Klavye açılınca alan daralır: içerik küçülebilir */}
      <View style={{ height: Math.min(560, Math.round(height * 0.62)), flexShrink: 1, minHeight: 180 }}>
        {current === 'gif' ? <GifGrid onPick={onGif} /> : <EmojiGrid onPick={onEmoji} />}
      </View>
    </BottomSheet>
  );
}

interface Placed {
  gif: GifResult;
  column: number;
  top: number;
  height: number;
}

function layout(results: GifResult[], columnWidth: number): { items: Placed[]; height: number } {
  const heights = [0, 0];
  const items: Placed[] = [];
  for (const gif of results) {
    const column = heights[0]! <= heights[1]! ? 0 : 1;
    const ratio = gif.preview.height / Math.max(1, gif.preview.width);
    const height = Math.max(60, Math.min(320, Math.round(columnWidth * ratio)));
    items.push({ gif, column, top: heights[column]!, height });
    heights[column]! += height + GAP;
  }
  return { items, height: Math.max(...heights) };
}

function GifGrid({ onPick }: { onPick: (gif: GifResult) => void }) {
  const { width } = useWindowDimensions();
  const query = useGifPicker((s) => s.query);
  const results = useGifPicker((s) => s.results);
  const loading = useGifPicker((s) => s.loading);
  const loadingMore = useGifPicker((s) => s.loadingMore);
  const error = useGifPicker((s) => s.error);
  const hasMore = useGifPicker((s) => s.next !== null);
  const [text, setText] = useState(query);
  const columnWidth = Math.floor((width - PADDING * 2 - GAP) / 2);
  const { items, height } = useMemo(() => layout(results, columnWidth), [results, columnWidth]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height > contentSize.height - LOAD_MORE_MARGIN) loadMoreGifs();
  };

  return (
    <View style={styles.gifs}>
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={text}
          onChangeText={(value) => {
            setText(value);
            setGifQuery(value);
          }}
          placeholder="GIPHY'de ara"
          placeholderTextColor={colors.faint}
          maxLength={50}
          returnKeyType="search"
          style={styles.searchInput}
        />
        {text ? (
          <Pressable
            hitSlop={10}
            onPress={() => {
              setText('');
              setGifQuery('');
            }}
            accessibilityLabel="Aramayı temizle"
          >
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingHorizontal: PADDING, paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={onScroll}
        scrollEventThrottle={100}
      >
        {loading ? (
          <ActivityIndicator color={colors.muted} style={{ marginTop: 40 }} />
        ) : error && results.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{error}</Text>
            <Pressable onPress={retryGifs} hitSlop={8}>
              <Text style={styles.link}>Tekrar dene</Text>
            </Pressable>
          </View>
        ) : results.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{query.trim() ? `"${query.trim()}" için GIF bulunamadı.` : 'GIF bulunamadı.'}</Text>
          </View>
        ) : (
          <>
            {!query.trim() && <Text style={styles.heading}>Popüler GIF'ler</Text>}
            <View style={{ height }}>
              {items.map((item) => (
                <Pressable
                  key={item.gif.id}
                  onPress={() => onPick(item.gif)}
                  accessibilityLabel={item.gif.title || 'GIF'}
                  style={({ pressed }) => [
                    styles.cell,
                    {
                      left: item.column * (columnWidth + GAP),
                      top: item.top,
                      width: columnWidth,
                      height: item.height,
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  {isGiphyMedia(item.gif.preview.gif) && (
                    <Image source={{ uri: item.gif.preview.gif }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  )}
                </Pressable>
              ))}
            </View>
            {hasMore && (
              <Pressable onPress={loadMoreGifs} disabled={loadingMore} style={styles.more} hitSlop={6}>
                {loadingMore ? <ActivityIndicator color={colors.muted} /> : <Text style={styles.moreText}>Daha fazla</Text>}
              </Pressable>
            )}
            {error ? <Text style={[styles.emptyText, { textAlign: 'center' }]}>{error}</Text> : null}
          </>
        )}
      </ScrollView>
      {/* GIPHY'nin kullanım şartı: sonuçların yanında kaynak belirtilir */}
      <Text style={styles.attribution}>Powered by GIPHY</Text>
    </View>
  );
}

const styles = createStyles(() => ({
  flex: { flex: 1 },
  // Menülerle aynı dilde bölümlü seçici: seçili sekme yükseltilmiş kutu
  tabs: {
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 4,
    borderRadius: 12,
    backgroundColor: colors.rail,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 9 },
  tabActive: { backgroundColor: colors.active },
  tabText: { color: colors.muted, fontSize: 14.5, fontWeight: '700' },
  tabTextActive: { color: colors.head },
  gifs: { flex: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: PADDING,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.rail,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 9 },
  heading: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
  cell: { position: 'absolute', borderRadius: 8, overflow: 'hidden', backgroundColor: colors.hover },
  empty: { alignItems: 'center', gap: 8, paddingTop: 40, paddingHorizontal: 24 },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  link: { color: colors.link, fontSize: 14 },
  more: { alignItems: 'center', paddingVertical: 12 },
  moreText: { color: colors.muted, fontSize: 14 },
  attribution: {
    alignSelf: 'flex-end',
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: PADDING,
    paddingTop: 6,
  },
}));
