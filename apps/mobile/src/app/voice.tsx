import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { VideoTrack } from '@livekit/react-native';
import { Track } from 'livekit-client';
import { membersOf, useGuild, useSession } from '@diskort/client-core';
import type { VoiceState } from '@diskort/shared';
import { Avatar } from '../components/Avatar';
import { IconButton } from '../components/VoiceBar';
import { useSettings } from '../stores/settings';
import { colors } from '../theme';
import { useVoice, voice } from '../voice/voice';

export default function VoiceScreen() {
  const router = useRouter();
  const channelId = useVoice((s) => s.channelId);
  const status = useVoice((s) => s.status);
  const listenOnly = useVoice((s) => s.listenOnly);
  const channel = useGuild((s) => s.channels.find((c) => c.id === channelId));
  const voiceStates = useGuild((s) => s.voiceStates);
  const members = useMemo(() => (channelId ? membersOf(voiceStates, channelId) : []), [voiceStates, channelId]);
  const watching = useVoice((s) => s.watching);
  const selfMute = useSettings((s) => s.selfMute);
  const selfDeaf = useSettings((s) => s.selfDeaf);
  const speaker = useSettings((s) => s.speaker);
  const sharing = useVoice((s) => s.sharing);
  const [fullscreen, setFullscreen] = useState(false);

  if (status === 'idle' || !channelId) {
    return (
      <View style={[styles.page, styles.center]}>
        <Stack.Screen options={{ title: 'Ses' }} />
        <Text style={styles.muted}>Bir ses kanalına bağlı değilsin.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={{ color: colors.link, fontSize: 15 }}>Kanallara dön</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen options={{ title: channel?.name ?? 'Ses' }} />
      {status !== 'connected' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{status === 'connecting' ? 'Bağlanıyor…' : 'Bağlantı koptu, yeniden bağlanılıyor…'}</Text>
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
        </View>
      )}

      {watching && (
        <Pressable onPress={() => setFullscreen(true)} style={styles.stream}>
          <StreamVideo userId={watching} />
          <View style={styles.streamHint}>
            <Ionicons name="expand" size={16} color="#fff" />
          </View>
        </Pressable>
      )}

      <ScrollView contentContainerStyle={styles.grid}>
        {members.map((m) => (
          <Member key={m.userId} state={m} />
        ))}
      </ScrollView>

      <View style={styles.controls}>
        <IconButton icon={speaker ? 'volume-high' : 'ear'} onPress={() => void voice.setSpeaker(!speaker)} size={24} />
        <IconButton
          icon={sharing ? 'stop-circle-outline' : 'phone-portrait-outline'}
          on={sharing}
          onPress={() => void voice.toggleScreenShare()}
          size={24}
        />
        <IconButton icon={selfMute || selfDeaf ? 'mic-off' : 'mic'} active={selfMute || selfDeaf} onPress={() => voice.toggleMute()} size={24} />
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

      <Modal visible={fullscreen && Boolean(watching)} animationType="fade" supportedOrientations={['portrait', 'landscape']} onRequestClose={() => setFullscreen(false)}>
        <StatusBar hidden />
        <Pressable style={styles.fullscreen} onPress={() => setFullscreen(false)}>
          {watching && <StreamVideo userId={watching} />}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function StreamVideo({ userId }: { userId: string }) {
  // Abonelik değişince yeniden çiz
  useVoice((s) => s.tracksVersion);
  const found = voice.getScreenPublication(userId);
  if (!found?.publication.track) {
    return (
      <View style={[styles.center, { flex: 1 }]}>
        <Text style={styles.muted}>Yayın yükleniyor…</Text>
      </View>
    );
  }
  return (
    <VideoTrack
      trackRef={{ participant: found.participant, publication: found.publication, source: Track.Source.ScreenShare }}
      objectFit="contain"
      style={{ flex: 1 }}
    />
  );
}

function Member({ state }: { state: VoiceState }) {
  const user = useGuild((s) => s.users[state.userId]);
  const selfId = useSession((s) => s.user?.id);
  const speaking = useVoice((s) => Boolean(s.speaking[state.userId]));
  const hasStream = useVoice((s) => Boolean(s.streams[state.userId]));
  const watching = useVoice((s) => s.watching === state.userId);
  return (
    <View style={styles.member}>
      <Avatar user={user} size={72} speaking={speaking} />
      <View style={styles.memberNameRow}>
        {state.selfDeaf ? (
          <Ionicons name="volume-mute" size={14} color={colors.danger} />
        ) : state.selfMute ? (
          <Ionicons name="mic-off" size={14} color={colors.danger} />
        ) : null}
        <Text style={[styles.memberName, state.userId === selfId && { color: colors.head }]} numberOfLines={1}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.deep },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.muted, fontSize: 15 },
  banner: { backgroundColor: colors.warn, paddingVertical: 6, paddingHorizontal: 12 },
  bannerText: { color: '#000', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  stream: { aspectRatio: 16 / 9, backgroundColor: '#000' },
  streamHint: { position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', padding: 12, gap: 12 },
  member: {
    width: 150,
    alignItems: 'center',
    backgroundColor: colors.rail,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
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
  fullscreen: { flex: 1, backgroundColor: '#000' },
});
