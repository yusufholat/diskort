import { memo, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { discardMessage, isMentioned, retryMessage, toggleReaction, useMemberColor, type LocalMessage } from '@diskort/client-core';
import type { User } from '@diskort/shared';
import { useAppear } from '../motion';
import { colors } from '../theme';
import { Avatar } from './Avatar';
import { AttachmentList, UploadList } from './Attachments';
import { Markdown, type MarkdownContext } from './Markdown';
import { ReactionPill } from './ReactionPill';

const time = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const longDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const sameDay = (a: number, b: number): boolean => startOfDay(a) === startOfDay(b);

function stamp(ts: number): string {
  const diff = startOfDay(Date.now()) - startOfDay(ts);
  if (diff <= 0) return `Bugün ${time.format(ts)}`;
  if (diff <= 86_400_000) return `Dün ${time.format(ts)}`;
  return `${shortDate.format(ts)} ${time.format(ts)}`;
}

interface Props {
  message: LocalMessage;
  author: User | undefined;
  compact: boolean;
  /** Bu mesajın üstünde gün ayracı gösterilsin mi */
  dayBreak: boolean;
  self: User;
  md: MarkdownContext;
  onLongPress: (message: LocalMessage) => void;
  /** Yeni gelen mesaj: hafifçe yükselerek belirir (geçmiş yüklenirken false) */
  animateIn?: boolean;
}

export const MessageRow = memo(function MessageRow({
  message,
  author,
  compact,
  dayBreak,
  self,
  md,
  onLongPress,
  animateIn = false,
}: Props) {
  const mentioned = isMentioned(message, self);
  const authorColor = useMemberColor(message.authorId);
  const appear = useAppear(animateIn, 240);
  // Satır ekrandayken eklenen tepkiler animasyonla belirir
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return (
    <Animated.View
      style={{
        opacity: appear,
        transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      {dayBreak && (
        <View style={styles.dayBreak}>
          <View style={styles.dayLine} />
          <Text style={styles.dayText}>{longDate.format(message.createdAt)}</Text>
          <View style={styles.dayLine} />
        </View>
      )}
      <Pressable
        onLongPress={() => !message.status && onLongPress(message)}
        delayLongPress={300}
        style={({ pressed }) => [
          styles.row,
          compact ? styles.compact : styles.full,
          mentioned && styles.mentioned,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.gutter}>{!compact && <Avatar user={author} size={40} />}</View>
        <View style={styles.body}>
          {!compact && (
            <View style={styles.header}>
              <Text
                style={[styles.author, !author && styles.deleted, author && authorColor ? { color: authorColor } : null]}
                numberOfLines={1}
              >
                {author?.displayName ?? 'Silinmiş Kullanıcı'}
              </Text>
              <Text style={styles.time}>{stamp(message.createdAt)}</Text>
            </View>
          )}
          {message.content ? <Markdown content={message.content} ctx={md} dim={message.status === 'pending'} /> : null}
          {message.editedAt ? <Text style={styles.edited}>(düzenlendi)</Text> : null}
          {message.uploads ? (
            <UploadList message={message} />
          ) : message.attachments.length > 0 ? (
            <AttachmentList attachments={message.attachments} />
          ) : null}
          {message.status === 'failed' && message.nonce && (
            <Text style={styles.failed}>
              Gönderilemedi.{' '}
              <Text style={styles.action} onPress={() => retryMessage(message.channelId, message.nonce!)}>
                Tekrar dene
              </Text>
              {'  ·  '}
              <Text style={styles.action} onPress={() => discardMessage(message.channelId, message.nonce!)}>
                Vazgeç
              </Text>
            </Text>
          )}
          {message.reactions.length > 0 && (
            <View style={styles.reactions}>
              {message.reactions.map((r) => (
                <ReactionPill
                  key={r.emoji}
                  emoji={r.emoji}
                  count={r.count}
                  me={r.me}
                  animateIn={mounted.current}
                  onPress={() => void toggleReaction(message.channelId, message.id, r.emoji)}
                />
              ))}
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingRight: 14 },
  full: { paddingTop: 14, paddingBottom: 2 },
  compact: { paddingVertical: 2 },
  pressed: { backgroundColor: 'rgba(0,0,0,0.12)' },
  mentioned: { backgroundColor: 'rgba(240,178,50,0.09)', borderLeftWidth: 2, borderLeftColor: colors.warn },
  gutter: { width: 64, alignItems: 'center' },
  body: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 2 },
  author: { color: colors.head, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  deleted: { color: colors.muted, fontStyle: 'italic' },
  time: { color: colors.faint, fontSize: 12 },
  edited: { color: colors.faint, fontSize: 11 },
  failed: { color: colors.muted, fontSize: 13, marginTop: 2 },
  action: { color: colors.link },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  dayBreak: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 18, marginBottom: 4 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  dayText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
});
