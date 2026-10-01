import { memo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCallMembers, useCanCallDm, useDmCall, useGuild, useSession, type LocalMessage } from '@diskort/client-core';
import { callRecordView } from '../calls';
import { colors, createStyles, font, layout, radius, space } from '../theme';
import { joinVoice } from '../voice/actions';
import { useVoice } from '../voice/voice';
import { Avatar } from './Avatar';
import { HeaderButton } from './HeaderButton';
import { messageStamp, Separator } from './MessageRow';
import { PressableScale } from './PressableScale';

// Direkt mesaj aramasının sohbetteki parçaları: başlıktaki arama düğmesi, süren aramaya katılma şeridi ve
// arama kaydı satırı (message.type 'call'). Arama, konuşmanın ses odasına bağlanmaktır (ses istemcisi
// konuşmanın kimliğiyle katılır); sunucu ilk bağlananın katılımıyla diğerlerini çalar.

/** Bu konuşmanın aramasına bu telefondan bağlı mısın */
function useInThisCall(dmId: string): boolean {
  return useVoice((s) => s.status !== 'idle' && s.channelId === dmId);
}

/**
 * Başlıktaki arama düğmesi: aramada değilsen arar (süren arama varsa ona katılır) ve ses ekranını açar;
 * aramadaysan ses ekranını açar. Salt okunur konuşmada (engel, ortak sunucu kalmadı) görünmez.
 */
export function DmCallButton({ dmId }: { dmId: string }) {
  const router = useRouter();
  const canCall = useCanCallDm(dmId);
  const inCall = useInThisCall(dmId);
  const active = useDmCall(dmId) !== undefined;
  if (!canCall && !inCall) return null;
  return (
    <HeaderButton
      icon="call"
      size={21}
      color={inCall ? colors.okText : colors.muted}
      label={inCall ? 'Aramayı aç' : active ? 'Aramaya katıl' : 'Ara'}
      onPress={() => {
        if (!inCall) joinVoice(dmId);
        router.push('/voice');
      }}
    />
  );
}

/** Başlığın altında: konuşmada arama sürüyor ve sen içinde değilsin → kimler aramada ve "Aramaya katıl" */
export function DmCallStrip({ dmId }: { dmId: string }) {
  const router = useRouter();
  const call = useDmCall(dmId);
  const members = useCallMembers(dmId);
  const canCall = useCanCallDm(dmId);
  const inCall = useInThisCall(dmId);
  const users = useGuild((s) => s.users);
  if (!call || inCall || !canCall || members.length === 0) return null;
  const shown = members.slice(0, 3);
  return (
    <View style={styles.strip}>
      <View style={styles.faces}>
        {shown.map((m, i) => (
          <View key={m.userId} style={[styles.face, i > 0 && { marginLeft: -8 }]}>
            <Avatar user={users[m.userId]} size={24} />
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stripTitle} numberOfLines={1}>
          Arama sürüyor
        </Text>
        <Text style={styles.stripSub} numberOfLines={1}>
          {members.length} kişi aramada
        </Text>
      </View>
      <PressableScale
        scaleTo={0.94}
        onPress={() => {
          joinVoice(dmId);
          router.push('/voice');
        }}
        accessibilityRole="button"
        accessibilityLabel="Aramaya katıl"
        style={styles.join}
      >
        <Ionicons name="call" size={15} color="#fff" />
        <Text style={styles.joinText}>Aramaya katıl</Text>
      </PressableScale>
    </View>
  );
}

/**
 * Sohbetteki arama kaydı: kısa sistem satırı ("Ali arama başlattı · 12 dk", "Cevapsız arama"). Yanıtlanmaz,
 * düzenlenmez; uzun basma menüsü yok.
 */
export const CallRecordRow = memo(function CallRecordRow({
  message,
  dayBreak,
  newDivider,
}: {
  message: LocalMessage;
  /** Üstünde gün ayracı */
  dayBreak: boolean;
  /** Okunmamış ilk satır: üstünde "YENİ" ayracı */
  newDivider: boolean;
}) {
  const selfId = useSession((s) => s.user?.id);
  const authorName = useGuild((s) => (message.authorId ? s.users[message.authorId]?.displayName : undefined));
  const view = callRecordView(message, authorName, selfId);
  const tone = view.missed ? colors.dangerText : colors.okText;
  return (
    <View>
      {(dayBreak || newDivider) && <Separator day={dayBreak ? message.createdAt : null} unread={newDivider} />}
      <View style={styles.record} accessibilityLabel={`${view.text}${view.detail ? `, ${view.detail}` : ''}`}>
        <View style={styles.recordIcon}>
          <Ionicons name={view.missed ? 'call-outline' : 'call'} size={16} color={tone} style={view.missed ? styles.missedIcon : undefined} />
        </View>
        <Text style={styles.recordText} numberOfLines={2}>
          <Text style={styles.recordMain}>{view.text}</Text>
          {view.detail ? <Text style={view.live ? { color: colors.okText } : null}>{` · ${view.detail}`}</Text> : null}
          <Text style={styles.recordTime}>{`  ${messageStamp(message.createdAt)}`}</Text>
        </Text>
      </View>
    </View>
  );
});

const styles = createStyles(() => ({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.okSoft,
  },
  faces: { flexDirection: 'row' },
  face: { borderRadius: 14, backgroundColor: colors.main, padding: 2 },
  stripTitle: { color: colors.okText, fontSize: font.small, fontWeight: '800' },
  stripSub: { color: colors.muted, fontSize: font.caption },
  join: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.ok,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    height: 34,
  },
  joinText: { color: '#fff', fontSize: font.small, fontWeight: '700' },
  record: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingRight: 14, marginTop: 4 },
  recordIcon: { width: layout.avatarColumn, alignItems: 'center' },
  missedIcon: { transform: [{ rotate: '135deg' }] },
  recordText: { flex: 1, color: colors.muted, fontSize: font.small + 0.5 },
  recordMain: { color: colors.text, fontWeight: '600' },
  recordTime: { color: colors.faint, fontSize: font.caption },
}));
