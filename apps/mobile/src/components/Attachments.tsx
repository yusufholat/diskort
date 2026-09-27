import { useState } from 'react';
import { Image, Linking, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isImageAttachment, isVideoAttachment, type Attachment } from '@diskort/shared';
import { attachmentUrl, discardMessage, formatBytes, type LocalMessage } from '@diskort/client-core';
import { openAttachment } from '../attachments';
import { colors, createStyles } from '../theme';
import { VideoAttachment } from './VideoAttachment';

/** Mesaj satırında avatar sütunu ve sağ boşluk (MessageRow ile aynı) */
const ROW_INSET = 64 + 14;
const IMAGE_MAX_HEIGHT = 320;

type IconName = keyof typeof Ionicons.glyphMap;

export function fileIcon(type: string): IconName {
  if (type.startsWith('image/')) return 'image-outline';
  if (type.startsWith('video/')) return 'videocam-outline';
  if (type.startsWith('audio/')) return 'musical-notes-outline';
  if (/zip|rar|7z|tar|gzip/.test(type)) return 'archive-outline';
  if (type.startsWith('text/') || type === 'application/pdf') return 'document-text-outline';
  return 'document-outline';
}

function fit(a: Attachment, maxWidth: number): { width: number; height: number } {
  if (!a.width || !a.height) return { width: Math.min(maxWidth, 240), height: 240 };
  const scale = Math.min(1, maxWidth / a.width, IMAGE_MAX_HEIGHT / a.height);
  return { width: Math.max(1, Math.round(a.width * scale)), height: Math.max(1, Math.round(a.height * scale)) };
}

/** Onaylanmış mesajın dosyaları: resimler (dokununca tam ekran) ve videolar satır içinde, diğerleri kart. */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  const { width } = useWindowDimensions();
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const maxWidth = Math.min(width - ROW_INSET, 420);
  return (
    <View style={styles.list}>
      {attachments.map((a) =>
        isImageAttachment(a) ? (
          <Pressable key={a.id} onPress={() => setViewing(a)} style={[styles.image, fit(a, maxWidth)]}>
            <Image source={{ uri: attachmentUrl(a) }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          </Pressable>
        ) : isVideoAttachment(a) ? (
          <VideoAttachment key={a.id} attachment={a} maxWidth={maxWidth} />
        ) : (
          <Pressable
            key={a.id}
            onPress={() => void openAttachment(a)}
            style={({ pressed }) => [styles.card, { maxWidth }, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name={fileIcon(a.contentType)} size={30} color={colors.link} />
            <View style={styles.cardBody}>
              <Text style={styles.cardName} numberOfLines={1}>
                {a.name}
              </Text>
              <Text style={styles.cardSize}>{formatBytes(a.size)}</Text>
            </View>
            <Ionicons name="download-outline" size={22} color={colors.muted} />
          </Pressable>
        ),
      )}
      {viewing && <ImageViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </View>
  );
}

/**
 * Tam ekran resim: sığdırılmış, altında ad ve "Aç" (telefonun galeri uygulamasında). Bağlantı
 * önizlemesindeki resimde `source` asıl sayfadır: "Aç" onu açar.
 */
export function ImageViewer({ attachment, onClose, source }: { attachment: Attachment; onClose: () => void; source?: string }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.viewer}>
        <View style={styles.viewerBar}>
          <Text style={styles.viewerName} numberOfLines={1}>
            {attachment.name}
          </Text>
          <Pressable
            hitSlop={10}
            onPress={() => void (source ? Linking.openURL(source) : openAttachment(attachment))}
            accessibilityLabel={source ? 'Sayfayı aç' : 'Başka uygulamada aç'}
          >
            <Ionicons name="open-outline" size={24} color="#fff" />
          </Pressable>
          <Pressable hitSlop={10} onPress={onClose} accessibilityLabel="Kapat">
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
        <Pressable style={styles.viewerImage} onPress={onClose}>
          <Image source={{ uri: attachmentUrl(attachment) }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        </Pressable>
        <Text style={styles.viewerInfo}>
          {attachment.width && attachment.height ? `${attachment.width}×${attachment.height}` : ''}
          {attachment.size > 0 ? `${attachment.width && attachment.height ? ' · ' : ''}${formatBytes(attachment.size)}` : ''}
        </Text>
      </SafeAreaView>
    </Modal>
  );
}

/** Gönderilmekte olan mesajın dosyaları ve yükleme ilerlemesi */
export function UploadList({ message }: { message: LocalMessage }) {
  const failed = message.status === 'failed';
  return (
    <View style={styles.list}>
      {message.uploads?.map((u, i) => {
        const done = u.attachment ? u.file.size : Math.min(u.sent, u.file.size);
        const percent = u.file.size ? Math.round((done / u.file.size) * 100) : 100;
        const broken = failed && !u.attachment;
        return (
          <View key={i} style={styles.card}>
            <Ionicons name={fileIcon(u.file.type)} size={28} color={colors.muted} />
            <View style={styles.cardBody}>
              <Text style={styles.cardName} numberOfLines={1}>
                {u.file.name}
              </Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.bar,
                    { width: `${percent}%`, backgroundColor: broken ? colors.danger : u.attachment ? colors.ok : colors.brand },
                  ]}
                />
              </View>
              <Text style={styles.cardSize}>
                {broken ? 'Yüklenemedi' : `${formatBytes(done)} / ${formatBytes(u.file.size)}`}
              </Text>
            </View>
            {!failed && message.nonce && (
              <Pressable hitSlop={10} onPress={() => discardMessage(message.channelId, message.nonce!)} accessibilityLabel="Yüklemeyi iptal et">
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = createStyles(() => ({
  list: { gap: 6, marginTop: 4, alignItems: 'flex-start' },
  image: { borderRadius: 8, overflow: 'hidden', backgroundColor: colors.side },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'stretch',
    backgroundColor: colors.side,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.edge,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: { color: colors.link, fontSize: 15 },
  cardSize: { color: colors.muted, fontSize: 12, marginTop: 2 },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.active, overflow: 'hidden', marginTop: 6 },
  bar: { height: '100%', borderRadius: 3 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  viewerBar: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 16, paddingVertical: 12 },
  viewerName: { flex: 1, color: '#fff', fontSize: 15 },
  viewerImage: { flex: 1 },
  viewerInfo: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center', paddingVertical: 12 },
}));
