import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { hasPermission, Permission, type Channel, type DmChannel } from '@diskort/shared';
import {
  dmTitle,
  jumpToPinned,
  loadPins,
  openPins,
  useChannelContext,
  useGuild,
  usePermissions,
  useSession,
} from '@diskort/client-core';
import { DmAvatar } from '../components/DmAvatar';
import { shareInvite } from '../components/GuildMenu';
import { HeaderButton } from '../components/HeaderButton';
import { FileList } from '../components/channelPanel/FileList';
import { LinkList } from '../components/channelPanel/LinkList';
import { MediaGrid } from '../components/channelPanel/MediaGrid';
import { MemberList, type MemberSource } from '../components/channelPanel/MemberList';
import { PinList } from '../components/PinsSheet';
import { openChannelSettings } from '../components/serverSettings/common';
import { showChat } from '../stores/nav';
import { colors, createStyles, font, radius, ripple, space } from '../theme';

type TabKey = 'members' | 'media' | 'pins' | 'links' | 'files';

const TAB_LABELS: Record<TabKey, string> = {
  members: 'Üyeler',
  media: 'Medya',
  pins: 'Sabitlemeler',
  links: 'Bağlantılar',
  files: 'Dosyalar',
};

/**
 * Kanal paneli (Discord'daki gibi; sohbet başlığına dokununca açılır): üstte geri, arama ve (yetkisi varsa)
 * kanal ayarları; kanalın simgesi, adı ve türü; kaydırılabilen sekmeler (Üyeler, Medya, Sabitlemeler,
 * Bağlantılar, Dosyalar). Ses kanalında yalnızca üyeler. Grup konuşmasında sunucu bilgisi yok: katılımcılar, medya,
 * sabitlemeler, bağlantılar ve dosyalar. Kanal bildirim ayarı olmadığından bildirim düğmesi yok.
 */
export default function ChannelPanelScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const channel = useGuild((s) => s.channels.find((c) => c.id === id));
  const dm = useGuild((s) => (id ? s.dms[id] : undefined));
  const ready = useGuild((s) => s.status === 'ready');

  // Kanal silindi ya da artık görülemiyor: geri dönülür
  const gone = ready && !channel && !dm;
  useEffect(() => {
    if (gone && router.canGoBack()) router.back();
  }, [gone, router]);

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ headerShown: false }} />
      {channel ? <Panel key={channel.id} channel={channel} dm={null} /> : dm ? <Panel key={dm.id} channel={null} dm={dm} /> : null}
    </View>
  );
}

function Panel({ channel, dm }: { channel: Channel; dm: null } | { channel: null; dm: DmChannel }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const channelId = channel ? channel.id : dm.id;
  const context = useChannelContext(channelId);
  const selfId = useSession((s) => s.user?.id);
  const dmName = useGuild((s) => (dm ? dmTitle(dm, s.users, selfId) : ''));
  const activeGuild = useGuild((s) => s.guild);
  // Sunucu genelindeki ve kanaldaki yetkiler seçili sunucunun verisiyle: kanal o sunucununsa
  const sameGuild = Boolean(channel && activeGuild && channel.guildId === activeGuild.id);
  const guildPerms = usePermissions();
  const channelPerms = usePermissions(channel ? channel.id : undefined);
  const canInvite =
    sameGuild && (hasPermission(guildPerms, Permission.CREATE_INVITE) || hasPermission(guildPerms, Permission.MANAGE_INVITES));
  const canManage = sameGuild && hasPermission(channelPerms, Permission.MANAGE_CHANNELS);

  const tabs = useMemo<TabKey[]>(
    () => (channel?.type === 'voice' ? ['members'] : ['members', 'media', 'pins', 'links', 'files']),
    [channel?.type],
  );
  const [index, setIndex] = useState(0);
  // Bir kez açılan sekme kurulu kalır (geri dönünce yeniden yüklenmez). Kaydırırken boş sayfa görünmesin diye
  // yandaki sekmeler de önceden kurulur; sabitlemeler hariç (açılınca "görüldü" sayılır)
  const withNeighbors = useCallback(
    (v: ReadonlySet<TabKey>, i: number): ReadonlySet<TabKey> => {
      const next = new Set(v);
      next.add(tabs[i]!);
      for (const n of [tabs[i - 1], tabs[i + 1]]) if (n && n !== 'pins') next.add(n);
      return next.size === v.size ? v : next;
    },
    [tabs],
  );
  const [visited, setVisited] = useState<ReadonlySet<TabKey>>(() => withNeighbors(new Set(), 0));
  const pager = useRef<FlatList<TabKey>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  // Sayfa kayarken üyelerdeki hareketli isim plakaları durur: Skia kareleri kaydırmayla aynı kare bütçesini yemesin
  const [moving, setMoving] = useState(false);

  const select = useCallback(
    (i: number) => {
      setIndex(i);
      setVisited((v) => withNeighbors(v, i));
    },
    [withNeighbors],
  );
  const goTo = (i: number): void => {
    // Seçili sekmeye yeniden dokunmak: kayma olmaz, kayma sonu da gelmez (plakalar "kayıyor" diye durup kalmasın)
    if (i === index) return;
    // Bitişik olmayan sekmeye kayarken aradaki (kurulmamış) sayfalar boş görünür; onlara doğrudan atlanır
    const far = Math.abs(i - index) > 1;
    if (!far) setMoving(true);
    select(i);
    pager.current?.scrollToOffset({ offset: i * width, animated: !far });
  };
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    setMoving(false);
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index && i >= 0 && i < tabs.length) select(i);
  };

  const search = (): void => {
    router.push({
      pathname: '/search',
      params: dm ? { dmId: dm.id } : { guildId: channel!.guildId, channelId: channel!.id },
    });
  };

  const source: MemberSource = dm
    ? { kind: 'dm', participantIds: dm.participantIds }
    : { kind: 'channel', channelId };

  const inviteRow =
    canInvite && activeGuild ? (
      <Pressable
        onPress={() => void shareInvite(activeGuild)}
        android_ripple={ripple.row}
        accessibilityRole="button"
        style={styles.invite}
      >
        <View style={styles.inviteIcon}>
          <Ionicons name="person-add" size={19} color={colors.head} />
        </View>
        <Text style={styles.inviteText}>Üyeleri Davet Et</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.faint} />
      </Pressable>
    ) : null;

  const renderPage = ({ item }: { item: TabKey }) => {
    return (
      <View style={{ width, flex: 1 }}>
        {!visited.has(item) ? null : item === 'members' ? (
          <MemberList source={source} context={context} header={inviteRow} still={moving || index !== 0} />
        ) : item === 'media' ? (
          <MediaGrid channelId={channelId} active />
        ) : item === 'pins' ? (
          <PinsTab channelId={channelId} />
        ) : item === 'links' ? (
          <LinkList channelId={channelId} active />
        ) : (
          <FileList channelId={channelId} active />
        )}
      </View>
    );
  };

  const title = channel ? channel.name : dmName;
  const kind = channel ? (channel.type === 'voice' ? 'Ses Kanalı' : 'Metin Kanalı') : 'Grup Konuşması';

  return (
    <>
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <HeaderButton icon="arrow-back" label="Geri" size={24} color={colors.text} onPress={() => router.back()} />
        <View style={{ flex: 1 }} />
        {channel?.type !== 'voice' && <HeaderButton icon="search" label="Bu kanalda ara" size={22} onPress={search} />}
        {canManage && (
          <HeaderButton icon="settings-sharp" label="Kanal ayarları" size={22} onPress={() => openChannelSettings(channelId)} />
        )}
      </View>
      <View style={styles.header}>
        <View style={styles.tile}>
          {dm ? (
            <DmAvatar dm={dm} size={44} />
          ) : channel.type === 'voice' ? (
            <Ionicons name="volume-medium" size={26} color={colors.head} />
          ) : (
            <Feather name="hash" size={26} color={colors.head} />
          )}
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.kind}>{kind}</Text>
        </View>
      </View>
      {tabs.length > 1 && <TabBar tabs={tabs} index={index} scrollX={scrollX} pageWidth={width} onSelect={goTo} />}
      <View style={[styles.pages, { paddingBottom: insets.bottom }]}>
        <Animated.FlatList
          ref={pager}
          data={tabs}
          keyExtractor={(t) => t}
          renderItem={renderPage}
          extraData={`${moving ? 1 : 0}:${index}:${[...visited].join(',')}:${inviteRow ? 1 : 0}:${dm ? dm.participantIds.join(',') : ''}`}
          horizontal
          pagingEnabled
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          scrollEnabled={tabs.length > 1}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onScrollBeginDrag={() => setMoving(true)}
          onMomentumScrollEnd={onMomentumEnd}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          windowSize={tabs.length}
          initialNumToRender={1}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    </>
  );
}

/** "Sabitlemeler" sekmesi: açıkken liste güncel tutulur; dokununca sohbette mesaja gidilir */
function PinsTab({ channelId }: { channelId: string }) {
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => openPins(channelId), [channelId]);
  const refresh = (): void => {
    setRefreshing(true);
    void loadPins(channelId, true).finally(() => setRefreshing(false));
  };
  return (
    <PinList
      channelId={channelId}
      onRefresh={refresh}
      refreshing={refreshing}
      style={styles.pinList}
      onJump={(message) => {
        showChat(channelId);
        setTimeout(() => void jumpToPinned(message), 230);
      }}
    />
  );
}

/**
 * Kaydırılabilen sekme şeridi: alt çizgi sayfa kaydırmasını izler (sürüklerken de), seçili sekme görünür
 * tutulur.
 */
function TabBar({
  tabs,
  index,
  scrollX,
  pageWidth,
  onSelect,
}: {
  tabs: TabKey[];
  index: number;
  scrollX: Animated.Value;
  pageWidth: number;
  onSelect: (i: number) => void;
}) {
  const strip = useRef<ScrollView>(null);
  const [layouts, setLayouts] = useState<Record<number, { x: number; width: number }>>({});
  const measured = tabs.every((_, i) => layouts[i]);

  useEffect(() => {
    const l = layouts[index];
    if (l) strip.current?.scrollTo({ x: Math.max(0, l.x - space.xl), animated: true });
  }, [index, layouts]);

  const onLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setLayouts((prev) => (prev[i]?.x === x && prev[i]?.width === width ? prev : { ...prev, [i]: { x, width } }));
  };

  // Alt çizgi: 1 genişliğinde çubuk; konumu ve genişliği sayfa kaydırmasından hesaplanır
  const inputRange = tabs.map((_, i) => i * pageWidth);
  const indicator =
    measured && tabs.length > 1
      ? {
          transform: [
            { translateX: scrollX.interpolate({ inputRange, outputRange: tabs.map((_, i) => layouts[i]!.x + layouts[i]!.width / 2), extrapolate: 'clamp' }) },
            { scaleX: scrollX.interpolate({ inputRange, outputRange: tabs.map((_, i) => layouts[i]!.width), extrapolate: 'clamp' }) },
          ],
        }
      : null;

  return (
    <View style={styles.tabBar}>
      <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tabs.map((t, i) => (
          <Pressable
            key={t}
            onPress={() => onSelect(i)}
            onLayout={onLayout(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === index }}
            hitSlop={{ top: 6, bottom: 6 }}
            style={styles.tab}
          >
            <Text style={[styles.tabText, i === index && styles.tabTextActive]}>{TAB_LABELS[t]}</Text>
          </Pressable>
        ))}
        {indicator && <Animated.View pointerEvents="none" style={[styles.indicator, indicator]} />}
      </ScrollView>
    </View>
  );
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.main },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, minHeight: 56 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.md },
  tile: {
    width: 56,
    height: 56,
    borderRadius: radius.lg - 4,
    backgroundColor: colors.side,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: colors.head, fontSize: font.heading + 1, fontWeight: '800' },
  kind: { color: colors.muted, fontSize: font.small + 0.5, marginTop: 2 },
  tabBar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  tabs: { paddingHorizontal: space.lg, gap: space.xl },
  tab: { paddingTop: space.sm, paddingBottom: space.md },
  tabText: { color: colors.muted, fontSize: font.row, fontWeight: '600' },
  tabTextActive: { color: colors.brandText },
  indicator: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: 1,
    height: 3,
    marginLeft: -0.5,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: colors.brand,
  },
  pages: { flex: 1 },
  pinList: { flex: 1 },
  invite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.lg,
    paddingHorizontal: space.md + 2,
    minHeight: 58,
    borderRadius: radius.lg - 4,
    backgroundColor: colors.side,
    overflow: 'hidden',
  },
  inviteIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.active,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteText: { flex: 1, color: colors.head, fontSize: font.row, fontWeight: '600' },
}));
