import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Attachment } from '@diskort/shared';
import { attachmentUrl, fitBox, formatBytes } from '@diskort/client-core';
import { openAttachment } from '../attachments';
import { colors, createStyles } from '../theme';
import { expoVideo, openVideoExternally } from '../video';

const MAX_HEIGHT = 320;

/** 75 → "1:15", 3725 → "1:02:05" */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Mesajdaki video: önce yer tutucu (oynat düğmesi, süre, boyut; video indirilmez). Dokununca bu
 * APK'da expo-video varsa mesajın içinde oynar (oynatıcının düğmeleriyle ileri sarma, tam ekran);
 * yoksa telefonun video oynatıcısında açılır. Sağ üstteki düğme indirip "Birlikte aç" ile açar.
 */
export function VideoAttachment({ attachment, maxWidth }: { attachment: Attachment; maxWidth: number }) {
  const [playing, setPlaying] = useState(false);
  const box = fitBox(attachment.width, attachment.height, { width: maxWidth, height: MAX_HEIGHT }) ?? {
    width: Math.min(maxWidth, 320),
    height: Math.round(Math.min(maxWidth, 320) * (9 / 16)),
  };

  const play = (): void => {
    if (expoVideo()) setPlaying(true);
    else void openVideoExternally(attachment);
  };

  return (
    <View style={[styles.box, box]}>
      {playing ? (
        <InlinePlayer uri={attachmentUrl(attachment)} style={StyleSheet.absoluteFill} />
      ) : (
        <Pressable
          style={({ pressed }) => [StyleSheet.absoluteFill, styles.poster, pressed && { opacity: 0.8 }]}
          onPress={play}
          accessibilityRole="button"
          accessibilityLabel={`${attachment.name} videosunu oynat`}
        >
          <View style={styles.playButton}>
            <Ionicons name="play" size={30} color="#fff" style={{ marginLeft: 3 }} />
          </View>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {attachment.name}
            </Text>
            <Text style={styles.meta}>
              {attachment.duration ? `${formatDuration(attachment.duration)} · ` : ''}
              {formatBytes(attachment.size)}
            </Text>
          </View>
        </Pressable>
      )}
      {!playing && (
        <Pressable
          hitSlop={8}
          style={styles.download}
          onPress={() => void openAttachment(attachment)}
          accessibilityLabel="İndir"
        >
          <Ionicons name="download-outline" size={20} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

/** Mesajın içindeki oynatıcı: yalnızca expo-video yüklüyken çizilir (bkz. video.ts) */
function InlinePlayer({ uri, style }: { uri: string; style: ViewStyle }) {
  const { useVideoPlayer, VideoView } = expoVideo()!;
  const player = useVideoPlayer(uri, (p) => p.play());
  return (
    <VideoView
      player={player}
      style={style}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture={false}
    />
  );
}

const styles = createStyles(() => ({
  box: { borderRadius: 8, overflow: 'hidden', backgroundColor: '#000' },
  poster: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.deep },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  name: { flex: 1, color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  meta: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  download: {
    position: 'absolute',
    top: 6,
    right: 6,
    borderRadius: 6,
    padding: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
}));
