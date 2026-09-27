import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { colors } from '../theme';
import { joinVoice } from '../voice/actions';
import { ChannelList, GuildHeader } from './ChannelList';
import { MemberSheet } from './MemberSheet';

/**
 * Sohbet ekranında soldan kaydırınca açılan kanal çekmecesi (Discord'daki gibi). İçinde ana ekrandaki
 * kanal listesinin aynısı var; kanala dokununca o kanala geçilir. Kenardan sağa kaydırarak açılır;
 * sola kaydırarak, karartılmış alana dokunarak ya da geri tuşuyla kapanır.
 *
 * Yalnızca ekranın sol kenarındaki şeritten başlayan kaydırma çekmeceyi açar; satırın ortasından sağa
 * kaydırmak mesajı yanıtlar (MessageRow). Android'in hareketli gezinmesinde en kenardaki ince şerit
 * sistemin "geri" hareketidir: oradan başlayan kaydırma kanal listesine döner, o da aynı yere varır.
 */

/** Çekmeceyi açan kaydırmanın başlayabileceği sol şerit (dp) */
export const DRAWER_EDGE = 36;

const OPEN_MS = 220;

export function ChannelDrawer({ channelId, children }: { channelId: string; children: ReactNode }) {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(Math.round(screenWidth * 0.86), 380);
  /** 0: kapalı, 1: açık (sürüklerken arada) */
  const progress = useSharedValue(0);
  const [open, setOpen] = useState(false);
  // Liste ilk açılışta çizilir (sohbet ekranı açılırken kanal listesi boşuna kurulmasın)
  const [mounted, setMounted] = useState(false);
  const [member, setMember] = useState<string | null>(null);

  const settle = useCallback(
    (target: 0 | 1) => {
      'worklet';
      progress.value = withTiming(target, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
      scheduleOnRN(setOpen, target === 1);
    },
    [progress],
  );

  const close = useCallback(() => {
    progress.value = withTiming(0, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
    setOpen(false);
  }, [progress]);

  // Açıkken geri tuşu önce çekmeceyi kapatır
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [open, close]);

  const beginOpen = useCallback(() => {
    Keyboard.dismiss();
    setMounted(true);
  }, []);

  // Kenardan sağa kaydırma: çekmece parmağı izler, bırakınca hıza ve konuma göre açılır ya da kapanır
  const openPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!open)
        .hitSlop({ left: 0, width: DRAWER_EDGE })
        .activeOffsetX(12)
        .failOffsetY([-20, 20])
        .onStart(() => {
          scheduleOnRN(beginOpen);
        })
        .onUpdate((e) => {
          progress.value = Math.min(1, Math.max(0, e.translationX / width));
        })
        .onEnd((e) => {
          settle(e.velocityX > 500 || (progress.value > 0.4 && e.velocityX > -300) ? 1 : 0);
        }),
    [open, width, progress, settle, beginOpen],
  );

  // Açıkken sola kaydırma (listenin ya da karartılmış alanın üstünde): kapatır
  const closePan = useCallback(
    () =>
      Gesture.Pan()
        .enabled(open)
        .activeOffsetX(-12)
        .failOffsetY([-20, 20])
        .onUpdate((e) => {
          progress.value = Math.min(1, Math.max(0, 1 + e.translationX / width));
        })
        .onEnd((e) => {
          settle(e.velocityX < -500 || (progress.value < 0.6 && e.velocityX < 300) ? 0 : 1);
        }),
    [open, width, progress, settle],
  );
  const panelPan = useMemo(closePan, [closePan]);
  const backdropPan = useMemo(closePan, [closePan]);

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * (width + 24) }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.6 }));

  const openText = useCallback(
    (id: string) => {
      close();
      if (id !== channelId) router.replace(`/channel/${id}`);
    },
    [close, channelId, router],
  );
  const openVoice = useCallback(
    (id: string) => {
      close();
      joinVoice(id);
      router.push('/voice');
    },
    [close, router],
  );

  return (
    <GestureDetector gesture={openPan}>
      <View style={styles.root}>
        {children}
        {mounted && (
          <>
            <GestureDetector gesture={backdropPan}>
              <Reanimated.View
                style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
                pointerEvents={open ? 'auto' : 'none'}
              >
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={close}
                  accessibilityRole="button"
                  accessibilityLabel="Kanal listesini kapat"
                />
              </Reanimated.View>
            </GestureDetector>
            <GestureDetector gesture={panelPan}>
              <Reanimated.View
                style={[styles.panel, { width }, panelStyle]}
                accessibilityViewIsModal={open}
                importantForAccessibility={open ? 'yes' : 'no-hide-descendants'}
              >
                <GuildHeader
                  onDms={() => {
                    close();
                    router.push('/dms');
                  }}
                  onMembers={() => {
                    close();
                    router.push('/members');
                  }}
                />
                <ChannelList onOpenText={openText} onOpenVoice={openVoice} onMemberPress={setMember} selectedId={channelId} />
              </Reanimated.View>
            </GestureDetector>
          </>
        )}
        <MemberSheet userId={member} onClose={() => setMember(null)} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: '#000' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.side,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    overflow: 'hidden',
    elevation: 16,
  },
});
