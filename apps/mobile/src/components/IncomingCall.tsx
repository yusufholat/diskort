import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { DmCall } from '@diskort/shared';
import { declineDmCall, dmTitle, useDmCall, useGuild, useIncomingCalls, useSession } from '@diskort/client-core';
import { callSoundFor } from '../calls';
import { haptic } from '../haptics';
import { EASE_IN, timing } from '../motion';
import { dismissCallNotification } from '../notifications';
import { startCallSound, stopCallSound } from '../sounds';
import { showChat } from '../stores/nav';
import { colors, createStyles, font, radius, space } from '../theme';
import { useUpdateBannerVisible } from '../update/banner';
import { joinVoice } from '../voice/actions';
import { useVoice } from '../voice/voice';
import { Avatar } from './Avatar';
import { DmAvatar } from './DmAvatar';
import { PressableScale } from './PressableScale';

// Gelen DM araması: uygulamanın her ekranının üstünde (kök yerleşimde) beliren kart ve arama sesleri
// (zil: seni biri arıyor; bekleme: sen arıyorsun, karşı taraf henüz açmadı). Uygulama kapalı/kilitliyken
// telefon bildirimi var (sunucu gönderir, bkz. notifications.ts); tam ekran arama penceresi yok.

/** Uygulama önde mi (zil yalnızca açıkken çalar) */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/** Zil ve bekleme sesini duruma göre başlatır/durdurur (çizim yok) */
export function CallSounds() {
  const selfId = useSession((s) => s.user?.id);
  const incoming = useIncomingCalls().length;
  const appActive = useAppActive();
  const voiceChannel = useVoice((s) => (s.status === 'idle' ? null : s.channelId));
  const myCall = useDmCall(voiceChannel);
  const othersInCall = useGuild((s) => {
    if (!voiceChannel) return 0;
    let n = 0;
    for (const id in s.voiceStates) if (id !== selfId && s.voiceStates[id]!.channelId === voiceChannel) n++;
    return n;
  });
  const sound = callSoundFor({ incoming, appActive, myCall, othersInCall, selfId });
  useEffect(() => {
    if (sound) startCallSound(sound);
    else stopCallSound();
  }, [sound]);
  useEffect(() => () => stopCallSound(), []);
  return null;
}

/** Gelen arama kartı: en yeni arama (birden çoksa "+N arama daha") */
export function IncomingCallHost() {
  const calls = useIncomingCalls();
  const insets = useSafeAreaInsets();
  const bannerVisible = useUpdateBannerVisible();
  const call = calls[0];
  // Kapanış animasyonu sürerken son arama görünmeye devam eder
  const [shown, setShown] = useState<DmCall | null>(call ?? null);
  const progress = useRef(new Animated.Value(0)).current;
  const visible = Boolean(call);

  useEffect(() => {
    if (call) setShown(call);
  }, [call]);

  useEffect(() => {
    if (visible) {
      progress.setValue(0);
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
      return;
    }
    const anim = timing(progress, 0, 180, EASE_IN);
    anim.start(({ finished }) => finished && setShown(null));
    return () => anim.stop();
  }, [visible, progress]);

  if (!shown) return null;
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        styles.wrap,
        {
          top: insets.top + 8 + (bannerVisible ? 60 : 0),
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }],
        },
      ]}
    >
      <IncomingCallCard call={shown} more={Math.max(0, calls.length - 1)} />
    </Animated.View>
  );
}

function IncomingCallCard({ call, more }: { call: DmCall; more: number }) {
  const router = useRouter();
  const selfId = useSession((s) => s.user?.id);
  const dm = useGuild((s) => s.dms[call.channelId]);
  const caller = useGuild((s) => s.users[call.startedBy]);
  const title = useGuild((s) => (dm ? dmTitle(dm, s.users, selfId) : (caller?.displayName ?? 'Arama')));
  const group = dm?.group === true;
  const subtitle = group ? `Grup araması · ${caller?.displayName ?? 'biri'} arıyor` : 'Seni arıyor…';

  const accept = (): void => {
    const id = call.channelId;
    // Kart ve zil hemen kalksın (sunucu katılınca zaten çalmayı bitirir)
    if (selfId) useGuild.getState().stopRingingLocally(id, selfId);
    dismissCallNotification(id, call.messageId);
    joinVoice(id);
    showChat(id);
    router.push('/voice');
  };

  const decline = (): void => {
    haptic('leave');
    dismissCallNotification(call.channelId, call.messageId);
    void declineDmCall(call.channelId);
  };

  return (
    <View style={styles.card} accessibilityLiveRegion="assertive" accessibilityLabel={`${title}: ${subtitle}`}>
      <View style={styles.info}>
        {dm ? <DmAvatar dm={dm} size={48} /> : <Avatar user={caller} size={48} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.subRow}>
            <Ionicons name="call" size={13} color={colors.okText} />
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          {more > 0 ? <Text style={styles.more}>+{more} arama daha</Text> : null}
        </View>
      </View>
      <View style={styles.actions}>
        <PressableScale
          scaleTo={0.9}
          containerStyle={styles.buttonBox}
          onPress={decline}
          accessibilityRole="button"
          accessibilityLabel="Reddet"
          style={[styles.button, styles.decline]}
        >
          <Ionicons name="call" size={20} color="#fff" style={styles.hangup} />
          <Text style={styles.buttonText}>Reddet</Text>
        </PressableScale>
        <PressableScale
          scaleTo={0.9}
          containerStyle={styles.buttonBox}
          onPress={accept}
          accessibilityRole="button"
          accessibilityLabel="Kabul et"
          style={[styles.button, styles.accept]}
        >
          <Ionicons name="call" size={20} color="#fff" />
          <Text style={styles.buttonText}>Kabul</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  wrap: { position: 'absolute', left: space.md, right: space.md, zIndex: 1000, elevation: 24 },
  card: {
    backgroundColor: colors.raised,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.md,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  info: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { color: colors.head, fontSize: font.title, fontWeight: '800' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  subtitle: { color: colors.okText, fontSize: font.small, fontWeight: '600', flexShrink: 1 },
  more: { color: colors.muted, fontSize: font.caption, marginTop: 2 },
  actions: { flexDirection: 'row', gap: space.md },
  buttonBox: { flex: 1 },
  button: {
    height: 44,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  decline: { backgroundColor: colors.danger },
  accept: { backgroundColor: colors.ok },
  hangup: { transform: [{ rotate: '135deg' }] },
  buttonText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
}));
