import { memo, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DM_GROUP_MAX_PARTICIPANTS, type DmChannel } from '@diskort/shared';
import {
  ackChannel,
  closeDm,
  dmTitle,
  isUnread,
  useDmList,
  useDmUnreadCount,
  useGuild,
  useSession,
} from '@diskort/client-core';
import { BottomSheet } from '../components/BottomSheet';
import { DmAvatar } from '../components/DmAvatar';
import { PressableScale } from '../components/PressableScale';
import { Button } from '../components/ui';
import { animateNextLayout, useLayoutAnimationOn } from '../motion';
import { toast } from '../stores/ui';
import { colors } from '../theme';

const dayMonth = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });

/** Listedeki kısa "son etkinlik": "şimdi", "5 dk", "3 sa", "Dün", "4 g", "12 Eyl" */
function formatAgo(ts: number, now = Date.now()): string {
  const minutes = Math.floor((now - ts) / 60_000);
  if (minutes < 1) return 'şimdi';
  if (minutes < 60) return `${minutes} dk`;
  const start = (t: number): number => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((start(now) - start(ts)) / 86_400_000);
  if (days === 0) return `${Math.floor(minutes / 60)} sa`;
  if (days === 1) return 'Dün';
  if (days < 7) return `${days} g`;
  return dayMonth.format(ts);
}

/** Direkt mesajlar: konuşmalar son etkinliğe göre; dokununca açılır, uzun basınca seçenekler. */
export default function DmListScreen() {
  const router = useRouter();
  const dms = useDmList();
  const [menuFor, setMenuFor] = useState<DmChannel | null>(null);
  // Yeni konuşma belirir, kapanan yumuşakça çıkar, yeri değişen kayar
  useLayoutAnimationOn(dms.map((d) => d.id).join(','));

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Direkt Mesajlar',
          headerRight: () => (
            <PressableScale scaleTo={0.8} hitSlop={10} accessibilityLabel="Yeni mesaj" onPress={() => router.push('/dm-new')}>
              <Ionicons name="create-outline" size={23} color={colors.muted} />
            </PressableScale>
          ),
        }}
      />
      <FlatList
        data={dms}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
        renderItem={({ item }) => (
          <DmRow dm={item} onPress={() => router.push(`/channel/${item.id}`)} onLongPress={() => setMenuFor(item)} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="chatbubbles" size={40} color="#fff" />
            </View>
            <Text style={styles.emptyTitle}>Henüz bir konuşman yok</Text>
            <Text style={styles.emptyText}>
              Bir kişiyle ya da küçük bir grupla ayrı yazış. Mesajları yalnızca konuşmadakiler görür; sunucu
              yöneticileri de okuyamaz.
            </Text>
            <View style={{ alignSelf: 'stretch', marginTop: 20 }}>
              <Button title="Yeni mesaj" onPress={() => router.push('/dm-new')} />
            </View>
          </View>
        }
      />
      <DmMenu dm={menuFor} onClose={() => setMenuFor(null)} />
    </SafeAreaView>
  );
}

const DmRow = memo(function DmRow({
  dm,
  onPress,
  onLongPress,
}: {
  dm: DmChannel;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const selfId = useSession((s) => s.user?.id);
  const title = useGuild((s) => dmTitle(dm, s.users, selfId));
  const unread = useGuild((s) => isUnread(s, dm.id));
  const count = useDmUnreadCount(dm.id);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {unread && <View style={styles.unreadPill} />}
      <DmAvatar dm={dm} size={44} status />
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
          {title}
        </Text>
        {dm.group && <Text style={styles.sub}>{dm.participantIds.length} üye</Text>}
      </View>
      <View style={styles.meta}>
        <Text style={styles.time}>{formatAgo(dm.lastActivityAt)}</Text>
        {count > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
});

/** Uzun basınca: okundu say; grupta ad değiştir, kişi ekle, ayrıl; bire bir konuşmada kapat */
function DmMenu({ dm: requested, onClose }: { dm: DmChannel | null; onClose: () => void }) {
  const router = useRouter();
  // Kapanış animasyonu sürerken içerik kaybolmasın
  const last = useRef(requested);
  if (requested) last.current = requested;
  const dm = requested ?? last.current;
  const selfId = useSession((s) => s.user?.id);
  const title = useGuild((s) => (dm ? dmTitle(dm, s.users, selfId) : ''));
  const unread = useGuild((s) => (dm ? isUnread(s, dm.id) : false));
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (requested) setConfirm(false);
  }, [requested]);

  if (!dm) return null;
  const close = (): void => onClose();

  return (
    <BottomSheet visible={requested !== null} onClose={close}>
      <Text style={styles.menuTitle} numberOfLines={1}>
        {title}
      </Text>
      {unread && (
        <MenuItem
          icon="checkmark-done"
          label="Okundu say"
          onPress={() => {
            ackChannel(dm.id);
            close();
          }}
        />
      )}
      {dm.group && (
        <MenuItem
          icon="create-outline"
          label="Grubun adını değiştir"
          onPress={() => {
            close();
            router.push({ pathname: '/dm-rename', params: { id: dm.id } });
          }}
        />
      )}
      {dm.group && dm.participantIds.length < DM_GROUP_MAX_PARTICIPANTS && (
        <MenuItem
          icon="person-add-outline"
          label="Kişi ekle"
          onPress={() => {
            close();
            router.push({ pathname: '/dm-new', params: { addTo: dm.id } });
          }}
        />
      )}
      {dm.group ? (
        <MenuItem
          icon="exit-outline"
          danger
          label={confirm ? 'Emin misin? Gruptan ayrıl' : 'Gruptan ayrıl'}
          onPress={() => {
            if (!confirm) {
              animateNextLayout(160);
              setConfirm(true);
              return;
            }
            close();
            void closeDm(dm.id);
          }}
        />
      ) : (
        <MenuItem
          icon="close-circle-outline"
          label="Konuşmayı kapat"
          onPress={() => {
            close();
            void closeDm(dm.id).then((ok) => ok && toast('Konuşma listeden kaldırıldı; yeni mesaj gelince döner.'));
          }}
        />
      )}
      <MenuItem icon="close" label="Vazgeç" onPress={close} />
    </BottomSheet>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.hover }]}>
      <Ionicons name={icon} size={21} color={danger ? colors.danger : colors.muted} />
      <Text style={[styles.menuText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.side },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 62,
    marginHorizontal: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  pressed: { backgroundColor: colors.hover },
  unreadPill: { position: 'absolute', left: -8, width: 4, height: 10, borderRadius: 2, backgroundColor: '#fff' },
  name: { color: colors.muted, fontSize: 16.5, fontWeight: '500' },
  nameUnread: { color: colors.head, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 13, marginTop: 1 },
  meta: { alignItems: 'flex-end', gap: 4 },
  time: { color: colors.faint, fontSize: 12 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { color: colors.head, fontSize: 19, fontWeight: '700' },
  emptyText: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: 8, lineHeight: 21 },
  menuTitle: { color: colors.head, fontSize: 17, fontWeight: '700', paddingHorizontal: 20, paddingBottom: 8 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 15 },
  menuText: { color: colors.head, fontSize: 16 },
});
