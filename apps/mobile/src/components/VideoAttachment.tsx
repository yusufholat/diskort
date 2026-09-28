import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import Reanimated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { StatusBar } from 'expo-status-bar';
import type { VideoPlayer } from 'expo-video';
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
 * APK'da expo-video varsa mesajın içinde oynar (dokununca tam ekran, sol altta ses); yoksa telefonun
 * video oynatıcısında açılır. Oynatmadan önce sağ üstteki düğme indirip "Birlikte aç" ile açar.
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
          style={styles.corner}
          onPress={() => void openAttachment(attachment)}
          accessibilityLabel="İndir"
        >
          <Ionicons name="download-outline" size={20} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Mesajın içindeki oynatıcı: yalnızca expo-video yüklüyken çizilir (bkz. video.ts). Kutuda düğmesiz oynar;
 * dokununca kutudan büyüyerek tam ekrana geçer (oynatıcının düğmeleriyle). Sol altta ses aç/kapa.
 */
function InlinePlayer({ uri, style }: { uri: string; style: ViewStyle }) {
  const { useVideoPlayer, VideoView } = expoVideo()!;
  const player = useVideoPlayer(uri, (p) => p.play());
  const box = useRef<View>(null);
  const [muted, setMuted] = useState(false);
  // Tam ekran açıkken kutunun ekrandaki yeri (animasyon buradan başlar, kapanırken buraya döner)
  const [full, setFull] = useState<Rect | null>(null);

  const open = (): void => {
    box.current?.measureInWindow((x, y, width, height) => setFull({ x, y, width, height }));
  };
  const toggleMute = (): void => {
    player.muted = !player.muted;
    setMuted(player.muted);
  };

  return (
    <View ref={box} style={style} collapsable={false}>
      {/* Aynı oynatıcı aynı anda tek görünümde gösterilir: tam ekrandayken kutu boş kalır */}
      {!full && (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls={false}
          contentFit="contain"
          surfaceType="textureView"
          allowsPictureInPicture={false}
        />
      )}
      <Pressable style={StyleSheet.absoluteFill} onPress={open} accessibilityRole="button" accessibilityLabel="Tam ekran" />
      <Pressable
        hitSlop={8}
        style={styles.mute}
        onPress={toggleMute}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Sesi aç' : 'Sesi kapat'}
      >
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={18} color="#fff" />
      </Pressable>
      {full && <FullscreenVideo player={player} from={full} onClosed={() => setFull(null)} />}
    </View>
  );
}

const OPEN_MS = 280;
const CLOSE_MS = 220;

/** Tam ekran oynatıcı: mesajdaki kutudan büyüyerek açılır, geri tuşu ya da X ile küçülerek kapanır */
function FullscreenVideo({ player, from, onClosed }: { player: VideoPlayer; from: Rect; onClosed: () => void }) {
  const { VideoView } = expoVideo()!;
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reduce ? 1 : withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
  }, [progress, reduce]);

  const close = (): void => {
    if (reduce) {
      onClosed();
      return;
    }
    progress.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) scheduleOnRN(onClosed);
    });
  };

  const backdrop = useAnimatedStyle(() => ({ opacity: progress.value }));
  const frame = useAnimatedStyle(() => ({
    position: 'absolute',
    left: interpolate(progress.value, [0, 1], [from.x, 0]),
    top: interpolate(progress.value, [0, 1], [from.y, 0]),
    width: interpolate(progress.value, [0, 1], [from.width, width]),
    height: interpolate(progress.value, [0, 1], [from.height, height]),
    borderRadius: interpolate(progress.value, [0, 1], [8, 0]),
    overflow: 'hidden',
  }));
  const chrome = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0.6, 1], [0, 1], 'clamp') }));

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <StatusBar hidden />
      <Reanimated.View style={[StyleSheet.absoluteFill, styles.fullBackdrop, backdrop]} />
      <Reanimated.View style={frame}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls
          contentFit="contain"
          surfaceType="textureView"
          fullscreenOptions={{ enable: false }}
          buttonOptions={{ showSettings: false, showSubtitles: false }}
          allowsPictureInPicture={false}
        />
      </Reanimated.View>
      <Reanimated.View style={[styles.close, { top: insets.top + 8 }, chrome]}>
        <Pressable hitSlop={10} onPress={close} accessibilityRole="button" accessibilityLabel="Kapat">
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </Reanimated.View>
    </Modal>
  );
}

const styles = createStyles(() => ({
  mute: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    borderRadius: 6,
    padding: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  fullBackdrop: { backgroundColor: '#000' },
  close: {
    position: 'absolute',
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
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
  /** Oynatmadan önce sağ üstteki indirme düğmesi */
  corner: {
    position: 'absolute',
    top: 6,
    right: 6,
    borderRadius: 6,
    padding: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
}));
