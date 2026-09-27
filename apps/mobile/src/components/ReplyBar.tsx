import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  cancelReply,
  isOwnReplyTarget,
  setReplyMention,
  useGuild,
  useMemberColor,
  useMessages,
} from '@diskort/client-core';
import { colors } from '../theme';

/**
 * Yazma kutusunun üstündeki şerit (Discord'daki gibi): "@Ad kişisine yanıt veriliyor", asıl yazarın
 * bildirilip bildirilmeyeceği (@ AÇIK / KAPALI) ve iptal.
 */
export function ReplyBar({ channelId }: { channelId: string }) {
  const draft = useMessages((s) => s.replies[channelId]);
  const author = useGuild((s) => (draft?.authorId ? s.users[draft.authorId] : undefined));
  const color = useMemberColor(draft?.authorId);
  if (!draft) return null;
  const own = isOwnReplyTarget(draft);

  return (
    <View style={styles.bar}>
      <Ionicons name="arrow-undo" size={15} color={colors.muted} />
      <Text style={styles.text} numberOfLines={1}>
        <Text style={[styles.name, color ? { color } : null]}>@{author?.displayName ?? 'Silinmiş Kullanıcı'}</Text>{' '}
        kişisine yanıt veriliyor
      </Text>
      {!own && (
        <Pressable
          hitSlop={8}
          onPress={() => setReplyMention(channelId, !draft.mention)}
          accessibilityRole="switch"
          accessibilityState={{ checked: draft.mention }}
          accessibilityLabel="Asıl yazara bildirim"
          style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.toggleText, draft.mention && styles.toggleOn]}>@ {draft.mention ? 'AÇIK' : 'KAPALI'}</Text>
        </Pressable>
      )}
      <Pressable hitSlop={10} onPress={() => cancelReply(channelId)} accessibilityLabel="Yanıtı iptal et">
        <Ionicons name="close-circle" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.side,
  },
  text: { flex: 1, color: colors.muted, fontSize: 13.5 },
  name: { color: colors.text, fontWeight: '700' },
  toggle: { paddingHorizontal: 6, paddingVertical: 2 },
  toggleText: { color: colors.muted, fontSize: 12.5, fontWeight: '800' },
  toggleOn: { color: colors.link },
});
