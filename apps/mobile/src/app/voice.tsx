import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { membersOf, useCan, useGuild, useMemberColor, useSession } from '@diskort/client-core';
import { Permission, type VoiceState } from '@diskort/shared';
import { Avatar } from '../components/Avatar';
import { MemberSheet } from '../components/MemberSheet';
import { SpeakingRing } from '../components/SpeakingRing';
import { EmptyState, Notice } from '../components/States';
import { StreamViewer } from '../components/StreamViewer';
import { VoiceControl } from '../components/VoiceBar';
import { ConnectionQualityBadge } from '../components/VoiceQuality';
import { VoiceStateIcon } from '../components/VoiceStateIcon';
import { UserVolume } from '../components/VolumeControl';
import { useAppear, useLayoutAnimationOn, useTimingTo } from '../motion';
import { useSettings } from '../stores/settings';
import { colors, font, radius, space } from '../theme';
import { leaveVoice, toggleDeafen, toggleMute, toggleScreenShare, toggleSpeaker } from '../voice/actions';
import { useVoice, voice, type ScreenShareStats } from '../voice/voice';

const GRID_PADDING = space.md;
const GRID_GAP = 10;

export default function VoiceScreen() {
  const router = useRouter();
  const channelId = useVoice((s) => s.channelId);
  const status = useVoice((s) => s.status);
  const listenOnly = useVoice((s) => s.listenOnly);
  const channel = useGuild((s) => s.channels.find((c) => c.id === channelId));
  const voiceStates = useGuild((s) => s.voiceStates);
  const members = useMemo(() => (channelId ? membersOf(voiceStates, channelId) : []), [voiceStates, channelId]);
  const watching = useVoice((s) => s.watching);
  // İzlenen ya da az önce biten yayın ("sona erdi" bilgisi gösterilirken görüntüleyici kalır)
  const viewing = useVoice((s) => s.watching ?? s.streamEnded);
  const selfId = useSession((s) => s.user?.id);
  const selfMute = useSettings((s) => s.selfMute);
  const selfDeaf = useSettings((s) => s.selfDeaf);
  const speaker = useSettings((s) => s.speaker);
  const sharing = useVoice((s) => s.sharing);
  const micAllowed = useVoice((s) => s.micAllowed);
  const canStream = useCan(Permission.STREAM, channelId ?? undefined);
  const { width } = useWindowDimensions();
  // Uzun basılan (yönetilecek / sesi ayarlanacak) üye
  const [member, setMember] = useState<string | null>(null);
  // Katılan/ayrılan kutucukta diğerleri yumuşakça yer değiştirir
  // (yeni kutucuğun kendisi Animated ile büyür; LayoutAnimation yalnızca kaymayı ve çıkışı yapar)
  useLayoutAnimationOn(members.map((m) => m.userId).join(','), 220, false);
  const { fullscreen, setFullscreen, rotate, screenOptions } = useStreamFullscreen(viewing, watching);

  const title = channel?.name ?? 'Ses';
  const options = useMemo(
    () => ({
      ...screenOptions,
      title,
      headerRight: status === 'idle' ? undefined : () => <ConnectionQualityBadge />,
    }),
    [screenOptions, title, status],
  );

  // Tek kişiyse geniş kutucuk, değilse iki sütun; yayın izlenirken kutucuklar kısalır
  const single = members.length === 1;
  const tileWidth = single ? width - GRID_PADDING * 2 : Math.floor((width - GRID_PADDING * 2 - GRID_GAP) / 2);
  const tileHeight = viewing ? 118 : single ? 220 : Math.round(tileWidth * 0.86);
  const openMember = useCallback((userId: string) => setMember(userId), []);

  if (status === 'idle' || !channelId) {
    return (
      <View style={styles.page}>
        <Stack.Screen options={{ ...screenOptions, title: 'Ses', headerRight: undefined }} />
        <EmptyState
          icon="volume-mute-outline"
          tone="muted"
          title="Bir ses kanalına bağlı değilsin"
          text="Kanal listesinden bir ses kanalına dokununca burada konuşanları görürsün."
          action={{ title: 'Kanallara dön', onPress: () => router.back() }}
        />
      </View>
    );
  }

  const micOff = selfMute || selfDeaf || !micAllowed;

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen options={options} />
      {status !== 'connected' && (
        <Notice icon="sync" tone="warn">
          {status === 'connecting' ? 'Ses kanalına bağlanılıyor…' : 'Bağlantı koptu, yeniden bağlanılıyor…'}
        </Notice>
      )}
      {!micAllowed && (
        <Notice icon="mic-off" tone="muted">
          {voice.micBlockedReason()} Yalnızca dinliyorsun.
        </Notice>
      )}
      {listenOnly && (
        <Notice icon="mic-off" tone="muted">
          Mikrofon izni verilmedi: yalnızca dinliyorsun. Ayarlardan izin verip yeniden katılabilirsin.
        </Notice>
      )}

      {sharing && (
        <View style={styles.sharing}>
          <View style={styles.sharingRow}>
            <View style={styles.liveDot} />
            <Text style={styles.sharingText}>Ekranını paylaşıyorsun</Text>
          </View>
          <ShareStatsLine />
        </View>
      )}

      {/* Tam ekranda da aynı bileşen kalır (yalnızca yerleşimi değişir): video yeniden bağlanmaz */}
      {/* Doğrudan sayfanın çocuğu olmalı: tam ekranda sayfanın tamamını kaplar */}
      {viewing && (
        <StreamViewer key={viewing} userId={viewing} fullscreen={fullscreen} onFullscreen={setFullscreen} onRotate={rotate} />
      )}

      <ScrollView contentContainerStyle={styles.grid}>
        {members.map((m) => (
          <MemberTile key={m.userId} state={m} width={tileWidth} height={tileHeight} selfId={selfId} onLongPress={openMember} />
        ))}
      </ScrollView>

      <View style={styles.controls}>
        <VoiceControl
          icon={speaker ? 'volume-high' : 'ear'}
          caption={speaker ? 'Hoparlör' : 'Kulaklık'}
          label={speaker ? 'Hoparlör açık, kulaklığa geç' : 'Ahize, hoparlöre geç'}
          size={52}
          onPress={toggleSpeaker}
        />
        <VoiceControl
          icon={sharing ? 'stop-circle-outline' : 'phone-portrait-outline'}
          caption={sharing ? 'Durdur' : 'Ekran'}
          label={sharing ? 'Ekran paylaşımını durdur' : 'Ekranını paylaş'}
          on={sharing}
          size={52}
          onPress={() => toggleScreenShare(canStream)}
        />
        <VoiceControl
          icon={micOff ? 'mic-off' : 'mic'}
          caption={micOff ? 'Sessiz' : 'Mikrofon'}
          label={micOff ? 'Mikrofonu aç' : 'Sustur'}
          off={micOff}
          size={52}
          onPress={toggleMute}
        />
        <VoiceControl
          icon={selfDeaf ? 'volume-mute' : 'headset'}
          caption={selfDeaf ? 'Sağır' : 'Ses'}
          label={selfDeaf ? 'Sağırlaştırmayı kaldır' : 'Sağırlaştır'}
          off={selfDeaf}
          size={52}
          onPress={toggleDeafen}
        />
        <VoiceControl
          icon="call"
          danger
          caption="Ayrıl"
          label="Bağlantıyı kes"
          size={52}
          onPress={() => {
            leaveVoice();
            router.back();
          }}
        />
      </View>

      <MemberSheet
        userId={member}
        onClose={() => setMember(null)}
        // Seste başka biri: sesini yalnızca kendin için ayarla
        renderExtra={(userId) => (userId !== selfId && voiceStates[userId]?.channelId === channelId ? <UserVolume userId={userId} /> : null)}
      />
    </SafeAreaView>
  );
}

/**
 * Yayın tam ekranı. Ayrı bir Modal yerine ses ekranının kendisi kullanılır: başlık, durum çubuğu ve
 * gezinme çubuğu react-native-screens'in ekran seçenekleriyle gizlenir (sürükleyince geçici görünür),
 * yatay çevirme de aynı yolla (ekran yönü seçeneği) yapılır. Hepsi uygulamada zaten olan yerel
 * kütüphanelerle; yeni APK gerekmez.
 *
 * Eskiden Modal + <StatusBar hidden> kullanılıyordu: gizlenen durum çubuğu Modal'ın değil alttaki
 * ekranın penceresine uygulandığından Modal kapanınca çubuk geri gelip bütün ses ekranı aşağı
 * kayıyordu; ekrana tek dokunuş da tam ekranı kapatıyordu.
 */
function useStreamFullscreen(viewing: string | null, watching: string | null) {
  const [requested, setRequested] = useState(false);
  // Kullanıcının döndür düğmesiyle zorladığı yön (tam ekrandan çıkınca bırakılır)
  const [orientation, setOrientation] = useState<'landscape' | 'portrait' | null>(null);
  const fullscreen = requested && viewing !== null;
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  // Tam ekrandan yeni çıkıldıysa (zorlanan yön bırakılıp telefon kendiliğinden döndüyse) yeniden girilmez
  const exitedAt = useRef(0);
  const setFullscreen = useCallback((on: boolean) => {
    setRequested(on);
    if (!on) {
      setOrientation(null);
      exitedAt.current = Date.now();
    }
  }, []);

  // Yayın kapanınca tam ekran ve zorlanan yön sıfırlanır
  useEffect(() => {
    if (!viewing) setFullscreen(false);
  }, [viewing, setFullscreen]);

  // Telefon yan çevrilince izlenen yayın kendiliğinden tam ekrana geçer (YouTube gibi)
  const wasLandscape = useRef(landscape);
  useEffect(() => {
    if (landscape && !wasLandscape.current && watching && Date.now() - exitedAt.current > 1500) setRequested(true);
    wasLandscape.current = landscape;
  }, [landscape, watching]);

  // Geri tuşu / geri hareketi önce tam ekrandan çıkar
  useEffect(() => {
    if (!fullscreen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setFullscreen(false);
      return true;
    });
    return () => sub.remove();
  }, [fullscreen, setFullscreen]);

  const rotate = useCallback(() => setOrientation(landscape ? 'portrait' : 'landscape'), [landscape]);

  const screenOptions = useMemo(
    () => ({
      headerShown: !fullscreen,
      statusBarHidden: fullscreen,
      navigationBarHidden: fullscreen,
      // 'default' açıkça verilmeli: seçenek kaldırılınca react-native-screens yönü geri bırakmıyor
      orientation: orientation ?? ('default' as const),
    }),
    [fullscreen, orientation],
  );

  return { fullscreen, setFullscreen, rotate, screenOptions };
}

/** Yayının gerçekte nasıl gittiği: çözünürlük, kare hızı, bit hızı, kodlayıcı ve varsa darboğaz */
function ShareStatsLine() {
  const [stats, setStats] = useState<ScreenShareStats | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = (): void =>
      void voice
        .screenShareStats()
        .then((next) => alive && setStats(next))
        .catch(() => undefined);
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!stats) return null;
  const parts = [
    stats.width ? `${stats.width}×${stats.height}` : null,
    `${stats.fps} FPS`,
    `${(stats.kbps / 1000).toFixed(1).replace('.', ',')} Mbps`,
    stats.encoder,
    stats.limit ? `darboğaz: ${stats.limit === 'cpu' ? 'işlemci' : stats.limit === 'bandwidth' ? 'bağlantı' : stats.limit}` : null,
    stats.keyframeRequests ? `anahtar kare isteği: ${stats.keyframeRequests}` : null,
  ];
  return (
    <Text style={styles.statsText} selectable>
      {parts.filter(Boolean).join(' · ')}
    </Text>
  );
}

/**
 * Seste bir kişi: büyük avatar (konuşunca yeşil halka ve kutucuğun kenarı yumuşakça yanar), altta
 * ad ve ses durumu; yayın yapıyorsa CANLI ve "Yayını izle". Katılınca büyüyerek belirir.
 */
const MemberTile = memo(function MemberTile({
  state,
  width,
  height,
  selfId,
  onLongPress,
}: {
  state: VoiceState;
  width: number;
  height: number;
  selfId: string | undefined;
  onLongPress: (userId: string) => void;
}) {
  const user = useGuild((s) => s.users[state.userId]);
  const color = useMemberColor(state.userId);
  const speaking = useVoice((s) => Boolean(s.speaking[state.userId]));
  const hasStream = useVoice((s) => Boolean(s.streams[state.userId]));
  const watching = useVoice((s) => s.watching === state.userId);
  const appear = useAppear(true, 260);
  // Konuşma kenarı: açılışı hızlı, sönüşü yavaş (kısa sessizliklerde titremez)
  const edge = useTimingTo(speaking ? 1 : 0, speaking ? 90 : 280);
  const self = state.userId === selfId;
  const avatar = Math.min(72, Math.round(height * 0.44));
  return (
    <Pressable
      onLongPress={() => onLongPress(state.userId)}
      delayLongPress={300}
      accessibilityLabel={`${user?.displayName ?? 'Üye'}${speaking ? ', konuşuyor' : ''}${state.streaming ? ', yayında' : ''}`}
      accessibilityHint="Ses seviyesi ve seçenekler için uzun bas"
    >
      <Animated.View
        style={[
          styles.tile,
          {
            width,
            height,
            opacity: appear,
            transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }],
          },
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.tileEdge, { opacity: edge }]} />
        {state.streaming && (
          <View style={styles.live}>
            <Text style={styles.liveText}>CANLI</Text>
          </View>
        )}
        <SpeakingRing speaking={speaking} size={avatar}>
          <Avatar user={user} size={avatar} />
        </SpeakingRing>
        <View style={styles.nameRow}>
          <VoiceStateIcon state={state} size={14} />
          <Text style={[styles.name, self && { color: colors.head }, color ? { color } : null]} numberOfLines={1}>
            {user?.displayName ?? '…'}
          </Text>
        </View>
        {hasStream && !self && (
          <Pressable
            onPress={() => voice.watch(watching ? null : state.userId)}
            android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
            style={[styles.watch, watching && { backgroundColor: colors.control }]}
            accessibilityRole="button"
          >
            <Ionicons name={watching ? 'eye-off' : 'eye'} size={14} color="#fff" />
            <Text style={styles.watchText}>{watching ? 'İzlemeyi bırak' : 'Yayını izle'}</Text>
          </Pressable>
        )}
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.deep },
  sharing: {
    backgroundColor: colors.okSoft,
    marginHorizontal: space.sm,
    marginTop: space.sm,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  sharingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ok },
  sharingText: { color: '#2dc770', fontSize: font.small, fontWeight: '700' },
  statsText: { color: colors.muted, fontSize: 11.5, textAlign: 'center', marginTop: 2 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    padding: GRID_PADDING,
    gap: GRID_GAP,
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rail,
    borderRadius: radius.lg - 2,
    paddingHorizontal: space.sm,
    overflow: 'hidden',
  },
  tileEdge: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.lg - 2,
    borderWidth: 2,
    borderColor: colors.ok,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, maxWidth: '100%' },
  name: { color: colors.text, fontSize: font.body - 0.5, fontWeight: '600', flexShrink: 1 },
  live: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  watch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: space.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  watchText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
    paddingTop: space.md,
    paddingBottom: space.md,
    backgroundColor: colors.rail,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
});
