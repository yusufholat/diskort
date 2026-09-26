import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { discardMessage, mentions, retryMessage, type LocalMessage } from '@diskort/client-core';
import type { User } from '@diskort/shared';
import { colors } from '../theme';
import { Avatar } from './Avatar';
import { Markdown, type MarkdownContext } from './Markdown';

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
}

export const MessageRow = memo(function MessageRow({ message, author, compact, dayBreak, self, md, onLongPress }: Props) {
  const mentioned = message.authorId !== self.id && mentions(message.content, self.username);
  return (
    <View>
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
              <Text style={[styles.author, !author && styles.deleted]} numberOfLines={1}>
                {author?.displayName ?? 'Silinmiş Kullanıcı'}
              </Text>
              <Text style={styles.time}>{stamp(message.createdAt)}</Text>
            </View>
          )}
          <Markdown content={message.content} ctx={md} dim={message.status === 'pending'} />
          {message.editedAt ? <Text style={styles.edited}>(düzenlendi)</Text> : null}
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
        </View>
      </Pressable>
    </View>
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
  dayBreak: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 18, marginBottom: 4 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  dayText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
});
