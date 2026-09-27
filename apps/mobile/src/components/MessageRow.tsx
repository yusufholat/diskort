import { memo, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  discardMessage,
  gifOf,
  isMentioned,
  mentionInComposer,
  retryMessage,
  toggleReaction,
  useMemberColor,
  useMessages,
  type LocalMessage,
} from '@diskort/client-core';
import type { User } from '@diskort/shared';
import { duration, useAppear } from '../motion';
import { colors } from '../theme';
import { Avatar } from './Avatar';
import { AttachmentList, UploadList } from './Attachments';
import { GifEmbed } from './GifEmbed';
import { Markdown, type MarkdownContext } from './Markdown';
import { ReactionPill } from './ReactionPill';
import { REPLY_PREVIEW_HEIGHT, ReplyPreview } from './ReplyPreview';

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
  /** Alıntıdan bu mesaja atlandı: değiştikçe (0 değilse) satır kısa süre vurgulanır */
  flash?: number;
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
  flash = 0,
}: Props) {
  const mentioned = isMentioned(message, self);
  // Metni yalnızca GIPHY bağlantısı olan mesaj: bağlantı yerine GIF gösterilir
  const gif = gifOf(message);
  const authorColor = useMemberColor(message.authorId);
  const appear = useAppear(animateIn, 240);
  // Yazma kutusunun üstünde bu mesaja yanıt veriliyor
  const replying = useMessages((s) => s.replies[message.channelId]?.messageId === message.id);
  const isReply = Boolean(message.replyToId) && !compact;
  // Satır ekrandayken eklenen tepkiler animasyonla belirir
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const highlight = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!flash) return;
    highlight.setValue(1);
    Animated.timing(highlight, { toValue: 0, duration: 1400, delay: duration(700), useNativeDriver: true }).start();
  }, [flash, highlight]);
  // Ada dokununca yazma kutusuna bahsetme eklenir
  const mentionAuthor = (): void => {
    if (author && !author.removed) mentionInComposer(message.channelId, author.username);
  };
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
          mentioned && !replying && styles.mentioned,
          replying && styles.replying,
          pressed && styles.pressed,
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.flash, { opacity: highlight }]} />
        <View style={[styles.gutter, isReply && { paddingTop: REPLY_PREVIEW_HEIGHT }]}>
          {!compact && <Avatar user={author} size={40} />}
        </View>
        <View style={styles.body}>
          {isReply && <ReplyPreview message={message} md={md} />}
          {!compact && (
            <View style={styles.header}>
              <Text
                style={[styles.author, !author && styles.deleted, author && authorColor ? { color: authorColor } : null]}
                numberOfLines={1}
                onPress={author ? mentionAuthor : undefined}
                onLongPress={() => !message.status && onLongPress(message)}
                suppressHighlighting
              >
                {author?.displayName ?? 'Silinmiş Kullanıcı'}
              </Text>
              <Text style={styles.time}>{stamp(message.createdAt)}</Text>
            </View>
          )}
          {message.content && !gif ? <Markdown content={message.content} ctx={{ ...md, flags: message }} dim={message.status === 'pending'} /> : null}
          {gif ? <GifEmbed embed={gif} dim={message.status === 'pending'} /> : null}
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
  replying: { backgroundColor: 'rgba(88,101,242,0.1)', borderLeftWidth: 2, borderLeftColor: colors.brand },
  flash: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(88,101,242,0.25)' },
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
