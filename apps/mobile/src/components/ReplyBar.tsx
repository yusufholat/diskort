import { Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  cancelReply,
  isOwnReplyTarget,
  setReplyMention,
  useGuild,
  useChannelMemberColor,
  useMessages,
} from '@diskort/client-core';
import { colors, createStyles } from '../theme';
import { ContextBar } from './ContextBar';

/**
 * Yazma kutusunun üstündeki şerit (Discord'daki gibi): "@Ad kişisine yanıt veriliyor", asıl yazarın
 * bildirilip bildirilmeyeceği (@ AÇIK / KAPALI) ve iptal.
 */
export function ReplyBar({ channelId }: { channelId: string }) {
  const draft = useMessages((s) => s.replies[channelId]);
  const author = useGuild((s) => (draft?.authorId ? s.users[draft.authorId] : undefined));
  const color = useChannelMemberColor(draft?.authorId, channelId);
  if (!draft) return null;
  const own = isOwnReplyTarget(draft);

  return (
    <ContextBar>
      <Ionicons name="arrow-undo" size={15} color={colors.brandText} />
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
          style={({ pressed }) => [styles.toggle, draft.mention && styles.toggleOnBg, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.toggleText, draft.mention && styles.toggleOn]}>@ {draft.mention ? 'AÇIK' : 'KAPALI'}</Text>
        </Pressable>
      )}
      <Pressable hitSlop={10} onPress={() => cancelReply(channelId)} accessibilityLabel="Yanıtı iptal et">
        <Ionicons name="close-circle" size={20} color={colors.muted} />
      </Pressable>
    </ContextBar>
  );
}

const styles = createStyles(() => ({
  text: { flex: 1, color: colors.muted, fontSize: 13.5 },
  name: { color: colors.text, fontWeight: '700' },
  toggle: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  toggleOnBg: { backgroundColor: 'rgba(0,168,252,0.12)' },
  toggleText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  toggleOn: { color: colors.link },
}));
