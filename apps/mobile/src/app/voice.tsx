import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { membersOf, useCan, useGuild, useMemberColor, useSession } from '@diskort/client-core';
import { Permission, type VoiceState } from '@diskort/shared';
import { Avatar } from '../components/Avatar';
import { MemberSheet } from '../components/MemberSheet';
import { SpeakingRing } from '../components/SpeakingRing';
import { StreamViewer } from '../components/StreamViewer';
import { IconButton } from '../components/VoiceBar';
import { VoiceStateIcon } from '../components/VoiceStateIcon';
import { UserVolume } from '../components/VolumeControl';
import { useAppear, useLayoutAnimationOn } from '../motion';
import { toast } from '../stores/ui';
import { useSettings } from '../stores/settings';
import { colors } from '../theme';
import { useVoice, voice, type ScreenShareStats } from '../voice/voice';

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
  // Uzun basılan (yönetilecek / sesi ayarlanacak) üye
  const [member, setMember] = useState<string | null>(null);
  // Katılan/ayrılan kutucukta diğerleri yumuşakça yer değiştirir
  // (yeni kutucuğun kendisi Animated ile büyür; LayoutAnimation yalnızca kaymayı ve çıkışı yapar)
  useLayoutAnimationOn(members.map((m) => m.userId).join(','), 220, false);
  const { fullscreen, setFullscreen, rotate, screenOptions } = useStreamFullscreen(viewing, watching);

  if (status === 'idle' || !channelId) {
    return (
      <View style={[styles.page, styles.center]}>
        <Stack.Screen options={{ ...screenOptions, title: 'Ses' }} />
        <Text style={styles.muted}>Bir ses kanalına bağlı değilsin.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={{ color: colors.link, fontSize: 15 }}>Kanallara dön</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen options={{ ...screenOptions, title: channel?.name ?? 'Ses' }} />
      {status !== 'connected' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{status === 'connecting' ? 'Bağlanıyor…' : 'Bağlantı koptu, yeniden bağlanılıyor…'}</Text>
        </View>
      )}
      {!micAllowed && (
        <View style={[styles.banner, { backgroundColor: colors.side }]}>
          <Text style={[styles.bannerText, { color: colors.text }]}>{voice.micBlockedReason()} Yalnızca dinliyorsun.</Text>
        </View>
      )}
      {listenOnly && (
        <View style={[styles.banner, { backgroundColor: colors.side }]}>
          <Text style={[styles.bannerText, { color: colors.text }]}>
            Mikrofon izni verilmedi: yalnızca dinliyorsun. Ayarlardan izin verip yeniden katılabilirsin.
          </Text>
        </View>
      )}

      {sharing && (
        <View style={[styles.banner, { backgroundColor: colors.ok }]}>
          <Text style={[styles.bannerText, { color: '#fff' }]}>Ekranını paylaşıyorsun</Text>
          <ShareStatsLine />
        </View>
      )}

      {/* Tam ekranda da aynı bileşen kalır (yalnızca yerleşimi değişir): video yeniden bağlanmaz */}
      {viewing && (
        <StreamViewer key={viewing} userId={viewing} fullscreen={fullscreen} onFullscreen={setFullscreen} onRotate={rotate} />
      )}

      <ScrollView contentContainerStyle={styles.grid}>
        {members.map((m) => (
          <Member key={m.userId} state={m} onLongPress={() => setMember(m.userId)} />
        ))}
      </ScrollView>

      <View style={styles.controls}>
        <IconButton icon={speaker ? 'volume-high' : 'ear'} onPress={() => void voice.setSpeaker(!speaker)} size={24} />
        <IconButton
          icon={sharing ? 'stop-circle-outline' : 'phone-portrait-outline'}
          on={sharing}
          onPress={() =>
            sharing || canStream
              ? void voice.toggleScreenShare()
              : toast('Bu kanalda ekran paylaşma iznin yok.', 'error')
          }
          size={24}
        />
        <IconButton
          icon={selfMute || selfDeaf || !micAllowed ? 'mic-off' : 'mic'}
          active={selfMute || selfDeaf || !micAllowed}
          onPress={() => voice.toggleMute()}
          size={24}
        />
        <IconButton icon={selfDeaf ? 'volume-mute' : 'headset'} active={selfDeaf} onPress={() => voice.toggleDeafen()} size={24} />
        <IconButton
          icon="call"
          danger
          size={24}
          onPress={() => {
            void voice.leave();
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

  return {
    fullscreen,
    setFullscreen,
    rotate,
    screenOptions: {
      headerShown: !fullscreen,
      statusBarHidden: fullscreen,
      navigationBarHidden: fullscreen,
      // 'default' açıkça verilmeli: seçenek kaldırılınca react-native-screens yönü geri bırakmıyor
      orientation: orientation ?? ('default' as const),
    },
  };
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

function Member({ state, onLongPress }: { state: VoiceState; onLongPress: () => void }) {
  const user = useGuild((s) => s.users[state.userId]);
  const color = useMemberColor(state.userId);
  const selfId = useSession((s) => s.user?.id);
  const speaking = useVoice((s) => Boolean(s.speaking[state.userId]));
  const hasStream = useVoice((s) => Boolean(s.streams[state.userId]));
  const watching = useVoice((s) => s.watching === state.userId);
  // Katılan kişinin kutucuğu büyüyerek belirir
  const appear = useAppear(true, 260);
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={300}>
    <Animated.View
      style={[
        styles.member,
        speaking && styles.memberSpeaking,
        {
          opacity: appear,
          transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        },
      ]}
    >
      <SpeakingRing speaking={speaking} size={72}>
        <Avatar user={user} size={72} />
      </SpeakingRing>
      <View style={styles.memberNameRow}>
        <VoiceStateIcon state={state} size={14} />
        <Text
          style={[styles.memberName, state.userId === selfId && { color: colors.head }, color ? { color } : null]}
          numberOfLines={1}
        >
          {user?.displayName ?? '…'}
        </Text>
      </View>
      {state.streaming && state.userId === selfId && (
        <View style={[styles.watch, { backgroundColor: colors.danger }]}>
          <Text style={styles.watchText}>CANLI</Text>
        </View>
      )}
      {hasStream && state.userId !== selfId && (
        <Pressable onPress={() => voice.watch(watching ? null : state.userId)} style={[styles.watch, watching && { backgroundColor: colors.active }]}>
          <Text style={styles.watchText}>{watching ? 'İzlemeyi bırak' : 'Yayını izle'}</Text>
        </Pressable>
      )}
    </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.deep },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.muted, fontSize: 15 },
  banner: { backgroundColor: colors.warn, paddingVertical: 6, paddingHorizontal: 12 },
  bannerText: { color: '#000', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  statsText: { color: 'rgba(255,255,255,0.85)', fontSize: 11.5, textAlign: 'center', marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', padding: 12, gap: 12 },
  member: {
    width: 150,
    alignItems: 'center',
    backgroundColor: colors.rail,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  memberSpeaking: { borderColor: 'rgba(35,165,90,0.55)' },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  memberName: { color: colors.text, fontSize: 15, fontWeight: '500', flexShrink: 1 },
  watch: { marginTop: 10, backgroundColor: colors.brand, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  watchText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingVertical: 14,
    backgroundColor: colors.rail,
  },
});
