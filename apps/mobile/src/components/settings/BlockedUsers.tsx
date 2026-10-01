import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { UserBlock } from '@diskort/shared';
import { loadBlocks, unblockUser, useBlockedIds } from '@diskort/client-core';
import { animateNextLayout } from '../../motion';
import { toast } from '../../stores/ui';
import { colors, createStyles, font, radius, space } from '../../theme';
import { Avatar } from '../Avatar';
import { Card, SectionTitle } from '../ui';

/**
 * Ayarlar → Hesabım → Engellenenler: engellediğin kişiler (yalnızca sen görürsün) ve "Engeli kaldır".
 * Engel yalnızca direkt mesajları etkiler. Liste, engeller değişince (başka cihazdan da) yeniden yüklenir.
 */
export function BlockedUsers() {
  const ids = useBlockedIds();
  const key = ids.slice().sort().join(',');
  const [blocks, setBlocks] = useState<UserBlock[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadBlocks().then((list) => {
      if (!alive) return;
      animateNextLayout(180);
      setBlocks(list ? list.slice().sort((a, b) => b.createdAt - a.createdAt) : []);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const unblock = async (block: UserBlock): Promise<void> => {
    setBusy(block.userId);
    const ok = await unblockUser(block.userId);
    setBusy(null);
    if (!ok) return;
    animateNextLayout(180);
    setBlocks((list) => list?.filter((b) => b.userId !== block.userId) ?? null);
    toast(`${block.user?.displayName ?? 'Kişinin'} engeli kaldırıldı.`);
  };

  return (
    <View>
      <SectionTitle>Engellenenler</SectionTitle>
      <Card style={styles.card}>
        {blocks === null ? (
          <ActivityIndicator color={colors.muted} style={{ paddingVertical: space.lg }} />
        ) : blocks.length === 0 ? (
          <Text style={styles.empty}>Kimseyi engellemedin.</Text>
        ) : (
          blocks.map((block, i) => (
            <View key={block.userId} style={styles.row}>
              {i > 0 && <View style={styles.divider} />}
              <Avatar user={block.user ?? undefined} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {block.user?.displayName ?? 'Silinmiş Kullanıcı'}
                </Text>
                {block.user ? (
                  <Text style={styles.username} numberOfLines={1}>
                    @{block.user.username}
                  </Text>
                ) : null}
              </View>
              {busy === block.userId ? (
                <ActivityIndicator color={colors.muted} />
              ) : (
                <Pressable
                  onPress={() => void unblock(block)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`${block.user?.displayName ?? 'Kişinin'} engelini kaldır`}
                  style={({ pressed }) => [styles.unblock, pressed && { backgroundColor: colors.controlPressed }]}
                >
                  <Text style={styles.unblockText}>Engeli kaldır</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </Card>
      <Text style={styles.hint}>
        Engellediğin kişiyle bire bir konuşman ikiniz için de salt okunur olur ve sana yeni konuşma açamaz. Sunucu
        kanallarında bir şey değişmez; engellendiği ona söylenmez.
      </Text>
    </View>
  );
}

const styles = createStyles(() => ({
  card: { paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  // Satırlar arasında ince çizgi (kenarlık değil: ayrı görünüm)
  divider: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: colors.line },
  name: { color: colors.head, fontSize: font.body, fontWeight: '600' },
  username: { color: colors.muted, fontSize: font.caption + 0.5, marginTop: 1 },
  unblock: {
    backgroundColor: colors.control,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  unblockText: { color: colors.onControl, fontSize: font.small, fontWeight: '700' },
  empty: { color: colors.muted, fontSize: font.small, paddingVertical: space.lg },
  hint: { color: colors.muted, fontSize: font.caption + 0.5, lineHeight: 18, marginTop: space.sm, marginHorizontal: space.xs },
}));
