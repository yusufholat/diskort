import { Fragment, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useGuild, useMemberColor, useStreamViewers } from '@diskort/client-core';
import { colors, createStyles, font, radius, space } from '../theme';
import { Avatar } from './Avatar';
import { BottomSheet } from './BottomSheet';

/** Yığında gösterilen en fazla avatar; fazlası "+N" */
const STACK_MAX = 3;
const STACK_SIZE = 20;

/**
 * Yayını izleyenler: yan yana üst üste binen küçük yuvarlak avatarlar (fazlası "+N"); dokununca
 * "İZLEYİCİLER — N" listesi alttan açılır.
 * İzleyen yoksa hiçbir şey çizilmez. Yayıncı kendisi sayılmaz.
 */
export function StreamViewers({ userId, style }: { userId: string; style?: StyleProp<ViewStyle> }) {
  const viewers = useStreamViewers(userId);
  const [open, setOpen] = useState(false);
  // İzleyiciler gidince liste kapanır (yeniden gelince kendiliğinden açılmasın)
  const empty = viewers.length === 0;
  useEffect(() => {
    if (empty) setOpen(false);
  }, [empty]);
  if (viewers.length === 0 && !open) return null;
  const shown = viewers.slice(0, STACK_MAX);
  const extra = viewers.length - shown.length;
  return (
    <>
      {viewers.length > 0 && (
        <Pressable
          onPress={() => setOpen(true)}
          hitSlop={8}
          style={[styles.pill, style]}
          accessibilityRole="button"
          accessibilityLabel={`${viewers.length} izleyici`}
          accessibilityHint="İzleyenlerin listesini açar"
        >
          {shown.map((id, i) => (
            <StackAvatar key={id} userId={id} first={i === 0} />
          ))}
          {extra > 0 && (
            <View style={[styles.stackItem, styles.more]}>
              <Text style={styles.moreText}>+{extra}</Text>
            </View>
          )}
        </Pressable>
      )}
      <BottomSheet visible={open && viewers.length > 0} onClose={() => setOpen(false)}>
        <Text style={styles.title}>İZLEYİCİLER — {viewers.length}</Text>
        <ScrollView style={styles.list}>
          {viewers.map((id, i) => (
            <Fragment key={id}>
              {i > 0 && <View style={styles.divider} />}
              <ViewerRow userId={id} />
            </Fragment>
          ))}
        </ScrollView>
      </BottomSheet>
    </>
  );
}

function StackAvatar({ userId, first }: { userId: string; first: boolean }) {
  const user = useGuild((s) => s.users[userId]);
  return (
    <View style={[styles.stackItem, !first && styles.overlap]}>
      <Avatar user={user} size={STACK_SIZE} />
    </View>
  );
}

function ViewerRow({ userId }: { userId: string }) {
  const user = useGuild((s) => s.users[userId]);
  const color = useMemberColor(userId);
  return (
    <View style={styles.row}>
      <Avatar user={user} size={32} />
      <Text style={[styles.name, color ? { color } : null]} numberOfLines={1}>
        {user?.displayName ?? 'Üye'}
      </Text>
    </View>
  );
}

const styles = createStyles(() => ({
  // Yan yana, biri diğerinin arkasına binen yuvarlak avatarlar
  pill: { flexDirection: 'row', alignItems: 'center' },
  stackItem: { borderRadius: STACK_SIZE, borderWidth: 2, borderColor: 'rgba(0,0,0,0.75)' },
  overlap: { marginLeft: -7 },
  more: {
    marginLeft: -7,
    width: STACK_SIZE + 4,
    height: STACK_SIZE + 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.raised,
  },
  moreText: { color: colors.head, fontSize: 10, fontWeight: '800' },
  title: {
    color: colors.muted,
    fontSize: font.small,
    fontWeight: '800',
    letterSpacing: 0.4,
    paddingHorizontal: space.lg + 2,
    paddingBottom: space.sm,
  },
  list: {
    maxHeight: 360,
    backgroundColor: colors.main,
    borderRadius: radius.lg - 4,
    marginHorizontal: space.md,
    marginBottom: space.md,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 60 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  name: { color: colors.text, fontSize: font.row, fontWeight: '600', flexShrink: 1 },
}));
