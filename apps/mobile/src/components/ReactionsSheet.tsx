import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { create } from 'zustand';
import type { User } from '@diskort/shared';
import { loadReactionUsers, reactionUsersKey, useMessages, useReactionUsers } from '@diskort/client-core';
import { colors, createStyles, font, radius, space } from '../theme';
import { Avatar } from './Avatar';
import { BottomSheet, SheetHeader } from './BottomSheet';

interface Target {
  channelId: string;
  messageId: string;
  emoji?: string;
}

/** Açık "Tepkiler" sayfası (tepki hapına uzun basınca ya da mesaj menüsünden açılır) */
const useReactionsSheet = create<{ target: Target | null }>()(() => ({ target: null }));

export function openReactionsSheet(target: Target): void {
  useReactionsSheet.setState({ target });
}

const closeSheet = (): void => useReactionsSheet.setState({ target: null });

/**
 * Mesajdaki tepkiler ve kimlerin verdiği: üstte emoji sekmeleri, altta seçili emojiyle tepki
 * verenler (kaydırdıkça sayfa sayfa yüklenir). Sohbet ekranında bir kez bulunur.
 */
export function ReactionsSheet() {
  const open = useReactionsSheet((s) => s.target);
  // Kapanış animasyonu sürerken içerik kaybolmasın: son hedef tutulur
  const [target, setTarget] = useState<Target | null>(open);
  const [selected, setSelected] = useState<string | undefined>(open?.emoji);
  useEffect(() => {
    if (!open) return;
    setTarget(open);
    setSelected(open.emoji);
  }, [open]);

  const reactions = useMessages((s) =>
    target ? s.channels[target.channelId]?.messages.find((m) => m.id === target.messageId)?.reactions : undefined,
  );
  const current = reactions?.find((r) => r.emoji === selected) ?? reactions?.[0];
  const entry = useReactionUsers((s) =>
    target && current ? s.entries[reactionUsersKey(target.messageId, current.emoji)] : undefined,
  );
  const { height } = useWindowDimensions();

  // Tepkilerin hepsi kaldırıldıysa sayfa kapanır
  useEffect(() => {
    if (open && reactions && reactions.length === 0) closeSheet();
  }, [open, reactions]);

  useEffect(() => {
    if (open && target && current && !entry) void loadReactionUsers(target.messageId, current.emoji);
  }, [open, target, current, entry]);

  const loadMore = (): void => {
    if (target && current && entry?.next && !entry.loading) void loadReactionUsers(target.messageId, current.emoji, true);
  };

  return (
    <BottomSheet visible={open !== null} onClose={closeSheet}>
      <SheetHeader title="Tepkiler" />
      {reactions && current ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {reactions.map((r) => {
              const active = r.emoji === current.emoji;
              return (
                <Pressable
                  key={r.emoji}
                  onPress={() => setSelected(r.emoji)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${r.emoji} ${r.count} kişi`}
                  style={[styles.tab, active && styles.tabActive]}
                >
                  <Text style={styles.tabEmoji}>{r.emoji}</Text>
                  <Text style={[styles.tabCount, active && styles.tabCountActive]}>{r.count}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <FlatList
            data={entry?.users ?? []}
            keyExtractor={(u) => u.id}
            renderItem={({ item }) => <UserRow user={item} />}
            style={{ maxHeight: height * 0.5, minHeight: 120 }}
            contentContainerStyle={styles.list}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              entry?.loading ? (
                <ActivityIndicator color={colors.muted} style={styles.footer} />
              ) : entry?.error ? (
                <Text
                  style={styles.error}
                  onPress={() => target && void loadReactionUsers(target.messageId, current.emoji, entry.users.length > 0)}
                >
                  Liste yüklenemedi. <Text style={styles.retry}>Tekrar dene</Text>
                </Text>
              ) : null
            }
          />
        </>
      ) : null}
    </BottomSheet>
  );
}

function UserRow({ user }: { user: User }) {
  return (
    <View style={styles.row}>
      <Avatar user={user} size={36} />
      <View style={styles.names}>
        <Text style={styles.name} numberOfLines={1}>
          {user.displayName}
        </Text>
        <Text style={styles.username} numberOfLines={1}>
          {user.username}
        </Text>
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  tabs: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.main,
  },
  tabActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  tabEmoji: { fontSize: 20, lineHeight: 24 },
  tabCount: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
  tabCountActive: { color: colors.head },
  list: { paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  names: { flex: 1 },
  name: { color: colors.head, fontSize: font.row, fontWeight: '600' },
  username: { color: colors.muted, fontSize: font.small },
  footer: { paddingVertical: space.md },
  error: { color: colors.muted, fontSize: font.small, paddingVertical: space.md },
  retry: { color: colors.link, fontWeight: '600' },
}));
