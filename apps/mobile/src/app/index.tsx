import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChannelList, GuildHeader } from '../components/ChannelList';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { MemberSheet } from '../components/MemberSheet';
import { UserPanel } from '../components/UserPanel';
import { VoiceBar } from '../components/VoiceBar';
import { colors } from '../theme';
import { joinVoice } from '../voice/actions';

export default function HomeScreen() {
  const router = useRouter();
  // Uzun basılan (yönetilecek) üye
  const [member, setMember] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <GuildHeader onDms={() => router.push('/dms')} onMembers={() => router.push('/members')} />
      <ConnectionBanner />
      <ChannelList
        onOpenText={(id) => router.push(`/channel/${id}`)}
        onOpenVoice={(id) => {
          joinVoice(id);
          router.push('/voice');
        }}
        onMemberPress={setMember}
      />
      <VoiceBar />
      <UserPanel onSettings={() => router.push('/settings')} />
      <MemberSheet userId={member} onClose={() => setMember(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.side },
});
