import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { DM_GROUP_MAX_PARTICIPANTS, Permission } from '@diskort/shared';
import {
  ackChannel,
  deleteMessage,
  dmBlockedReason,
  dmPartner,
  dmTitle,
  loadInitial,
  loadOlder,
  QUICK_REACTIONS,
  toggleReaction,
  useCan,
  useGuild,
  useMessages,
  useSession,
  type LocalMessage,
} from '@diskort/client-core';
import type { User } from '@diskort/shared';
import { BottomSheet } from '../../components/BottomSheet';
import { Composer } from '../../components/Composer';
import { PressableScale } from '../../components/PressableScale';
import { MessageSkeleton } from '../../components/Skeleton';
import { animateNextLayout } from '../../motion';
import { EmojiGrid } from '../../components/EmojiGrid';
import type { MarkdownContext } from '../../components/Markdown';
import { MessageRow, sameDay } from '../../components/MessageRow';
import { VoiceBar } from '../../components/VoiceBar';
import { toast, useUi } from '../../stores/ui';
import { colors } from '../../theme';

const GROUP_WINDOW_MS = 7 * 60_000;
const EMPTY: LocalMessage[] = [];
// Seçiciler her çağrıda aynı boş diziyi döndürmeli: yeni dizi (?? []) zustand 5'te sonsuz yeniden çizime,
// yani ekranın açılamamasına yol açar.
const NO_REACTIONS: NonNullable<LocalMessage['reactions']> = [];
const keyOf = (m: LocalMessage): string => m.nonce ?? m.id;

/** Metin kanalı ya da direkt mesaj konuşması (kimlik bir konuşmanınsa) */
export default function TextChannelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const channel = useGuild((s) => s.channels.find((c) => c.id === id));
  const self = useSession((s) => s.user);
  const dm = useGuild((s) => (id ? s.dms[id] : undefined));
  const dmName = useGuild((s) => (dm ? dmTitle(dm, s.users, self?.id) : ''));
  const partner = useGuild((s) => (dm ? dmPartner(dm, s.users, self?.id) : undefined));
  // Bire bir konuşmada karşı taraf ayrıldıysa yazma kutusu yerine neden gösterilir
  const blocked = useGuild((s) => (dm ? dmBlockedReason(dm, s.users, self?.id) : null));
  const target = useMemo(
    () => channel ?? (dm ? { id: dm.id, name: dmName } : undefined),
    [channel, dm, dmName],
  );
  // Kanal "#ad", bire bir konuşma "@ad", grup adıyla geçer
  const label = channel ? `#${channel.name}` : dm && !dm.group ? `@${dmName}` : dmName;
  const users = useGuild((s) => s.users);
  const messages = useMessages((s) => (id ? s.channels[id]?.messages : undefined) ?? EMPTY);
  const loaded = useMessages((s) => (id ? s.channels[id]?.loaded : false) ?? false);
  const hasMore = useMessages((s) => (id ? s.channels[id]?.hasMore : true) ?? true);
  const loading = useMessages((s) => (id ? s.channels[id]?.loading : false) ?? false);
  const lastId = useGuild((s) => (id ? s.lastMessageIds[id] : undefined));
  const readId = useGuild((s) => (id ? s.readStates[id] : undefined));
  const typing = useMessages((s) => (id ? s.typing[id] : undefined));
  // Başkasının mesajını silmek ve yeni tepki eklemek kanaldaki yetkiye bağlı
  const canManageMessages = useCan(Permission.MANAGE_MESSAGES, id);
  const canReact = useCan(Permission.ADD_REACTIONS, id);

  const [atBottom, setAtBottom] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [menuFor, setMenuFor] = useState<LocalMessage | null>(null);
  const [editing, setEditing] = useState<LocalMessage | null>(null);
  const list = useRef<FlatList<LocalMessage>>(null);

  useEffect(() => {
    if (id) void loadInitial(id);
  }, [id]);

  // Bu kanal ekrandayken bahsetmeler bildirim yerine doğrudan okunur
  useFocusEffect(
    useCallback(() => {
      useUi.setState({ viewingChannelId: id ?? null });
      return () => useUi.setState({ viewingChannelId: null });
    }, [id]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);

  // Ekran açık, uygulama önde ve en alttayken okundu say
  useEffect(() => {
    if (id && loaded && active && atBottom && lastId && Number(lastId) > Number(readId ?? 0)) ackChannel(id);
  }, [id, loaded, active, atBottom, lastId, readId]);

  const md: MarkdownContext = useMemo(
    () => ({ usersByName: Object.fromEntries(Object.values(users).map((u) => [u.username, u])), selfId: self?.id }),
    [users, self?.id],
  );

  // Ters liste: en yeni mesaj en altta (indeks 0)
  const data = useMemo(() => [...messages].reverse(), [messages]);

  // Yeni gelen mesajlar animasyonla belirir; geçmiş yüklenirken, eski mesajlar eklenirken ve
  // bekleyen mesajımız onaylanırken (anahtarı değişir) oynatılmaz.
  const seen = useRef<Map<string, LocalMessage>>(new Map());
  const armed = useRef(false);
  const fresh = useMemo(() => {
    const keys = new Set<string>();
    if (!armed.current || !loaded) return keys;
    const prev = seen.current;
    let lastKnown = -1;
    messages.forEach((m, i) => {
      if (prev.has(keyOf(m))) lastKnown = i;
    });
    const current = new Set(messages.map(keyOf));
    const confirmed = new Set(
      [...prev.entries()].filter(([key, m]) => m.status === 'pending' && !current.has(key)).map(([, m]) => m.content),
    );
    for (const m of messages.slice(lastKnown + 1)) {
      if (!m.status && m.authorId === self?.id && confirmed.has(m.content)) continue;
      keys.add(keyOf(m));
    }
    return keys;
  }, [messages, loaded, self?.id]);
  useEffect(() => {
    seen.current = new Map(messages.map((m) => [keyOf(m), m]));
    armed.current = loaded;
  }, [messages, loaded]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    setAtBottom(e.nativeEvent.contentOffset.y < 40);
  };

  const typingNames = Object.keys(typing ?? {})
    .filter((uid) => uid !== self?.id)
    .map((uid) => users[uid]?.displayName)
    .filter(Boolean) as string[];

  if (!target || !self || !id) {
    return <View style={styles.page} />;
  }

  const canAddPeople = dm?.group === true && dm.participantIds.length < DM_GROUP_MAX_PARTICIPANTS;

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: channel ? `# ${channel.name}` : label,
          headerRight:
            canAddPeople && dm
              ? () => (
                  <PressableScale
                    scaleTo={0.8}
                    hitSlop={10}
                    accessibilityLabel="Kişi ekle"
                    onPress={() => router.push({ pathname: '/dm-new', params: { addTo: dm.id } })}
                  >
                    <Ionicons name="person-add" size={21} color={colors.muted} />
                  </PressableScale>
                )
              : undefined,
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={100}>
        <FlatList
          ref={list}
          inverted
          data={data}
          keyExtractor={keyOf}
          onScroll={onScroll}
          scrollEventThrottle={100}
          onEndReached={() => void loadOlder(id)}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingVertical: 8 }}
          // Geçmiş gelene kadar mesaj biçimli iskelet
          ListEmptyComponent={!loaded ? <MessageSkeleton rows={8} /> : null}
          ListFooterComponent={
            hasMore || !loaded ? (
              // Eski mesajlar yüklenirken üstte iki iskelet satırı
              <View style={styles.loading}>{loading && messages.length > 0 ? <MessageSkeleton rows={2} /> : null}</View>
            ) : (
              <View style={styles.intro}>
                {dm ? (
                  <>
                    <Text style={styles.introTitle}>{dmName}</Text>
                    {partner && <Text style={styles.introUser}>@{partner.username}</Text>}
                    <Text style={styles.introText}>
                      {dm.group ? `${dmName} grubunun başlangıcı.` : `${dmName} ile direkt mesaj geçmişinin başlangıcı.`}{' '}
                      Bu konuşmayı yalnızca {dm.group ? 'gruptakiler' : 'ikiniz'} görebilir.
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.introTitle}>{label} kanalına hoş geldin!</Text>
                    <Text style={styles.introText}>Bu, {label} kanalının başlangıcı.</Text>
                  </>
                )}
              </View>
            )
          }
          renderItem={({ item, index }) => {
            const older = data[index + 1];
            const dayBreak = !older || !sameDay(older.createdAt, item.createdAt);
            const compact =
              !!older &&
              !dayBreak &&
              older.authorId === item.authorId &&
              older.status !== 'failed' &&
              item.createdAt - older.createdAt < GROUP_WINDOW_MS;
            return (
              <MessageRow
                message={item}
                author={item.authorId ? users[item.authorId] : undefined}
                compact={compact}
                dayBreak={dayBreak}
                self={self}
                md={md}
                onLongPress={setMenuFor}
                animateIn={fresh.has(keyOf(item))}
              />
            );
          }}
        />

        <Text style={styles.typing} numberOfLines={1}>
          {typingNames.length === 1
            ? `${typingNames[0]} yazıyor…`
            : typingNames.length > 1
              ? `${typingNames.slice(0, 3).join(', ')} yazıyor…`
              : ' '}
        </Text>
        <Composer
          key={editing?.id ?? 'yeni'}
          channel={target}
          placeholder={dm ? `${label} ${dm.group ? 'grubuna' : 'kişisine'} mesaj gönder` : undefined}
          lockedText={blocked ?? undefined}
          mentionable={dm?.participantIds}
          editing={editing}
          onDoneEditing={() => setEditing(null)}
          onSent={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
        />
      </KeyboardAvoidingView>
      <VoiceBar />

      <MessageMenu
        message={menuFor}
        self={self}
        canManageMessages={canManageMessages}
        canReact={canReact}
        onClose={() => setMenuFor(null)}
        onEdit={(m) => setEditing(m)}
      />
    </SafeAreaView>
  );
}

/** Uzun basınca açılan menüdeki hızlı tepkiler (sonrasında tüm emojiler için +) */
const MENU_REACTIONS = QUICK_REACTIONS.slice(0, 6);

/** Uzun basınca alttan kayarak açılan mesaj menüsü (tepkiler, kopyala, düzenle, sil). */
function MessageMenu({
  message,
  self,
  canManageMessages,
  canReact,
  onClose,
  onEdit,
}: {
  message: LocalMessage | null;
  self: User;
  /** Kanalda başkalarının mesajlarını silebilir mi */
  canManageMessages: boolean;
  /** Yeni tepki ekleyebilir mi (var olan tepkilere katılmak her zaman serbest) */
  canReact: boolean;
  onClose: () => void;
  onEdit: (m: LocalMessage) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [allEmojis, setAllEmojis] = useState(false);
  // Kapanış animasyonu sürerken menünün içeriği değişmesin: son mesaj tutulur
  const last = useRef(message);
  if (message) last.current = message;
  const shown = message ?? last.current;
  const canEdit = shown?.authorId === self.id;
  const canDelete = shown?.authorId === self.id || canManageMessages;

  // Her açılışta menü baştan başlar
  useEffect(() => {
    if (!message) return;
    setConfirm(false);
    setAllEmojis(false);
  }, [message]);

  // Menü açıkken gelen tepki değişiklikleri de görünsün
  const reactions = useMessages(
    (s) => (shown ? s.channels[shown.channelId]?.messages.find((m) => m.id === shown.id)?.reactions : undefined) ?? NO_REACTIONS,
  );
  const react = (emoji: string): void => {
    if (shown) void toggleReaction(shown.channelId, shown.id, emoji);
    onClose();
  };
  const mine = (emoji: string): boolean => reactions.some((r) => r.emoji === emoji && r.me);
  const existing = (emoji: string): boolean => reactions.some((r) => r.emoji === emoji);
  // Yetki yoksa yalnızca mesajdaki tepkiler gösterilir
  const quick = canReact ? MENU_REACTIONS : MENU_REACTIONS.filter(existing);
  return (
    <BottomSheet visible={message !== null} onClose={onClose}>
      {allEmojis ? (
        <EmojiGrid onPick={react} />
      ) : (
        <>
          <View style={[styles.quickRow, quick.length === 0 && !canReact && { display: 'none' }]}>
            {quick.map((emoji) => (
              <PressableScale
                key={emoji}
                scaleTo={0.85}
                onPress={() => react(emoji)}
                style={({ pressed }) => [styles.quick, mine(emoji) && styles.quickMine, pressed && styles.quickPressed]}
              >
                <Text style={styles.quickEmoji}>{emoji}</Text>
              </PressableScale>
            ))}
            {canReact && (
              <PressableScale
                scaleTo={0.85}
                accessibilityLabel="Tüm emojiler"
                onPress={() => {
                  animateNextLayout(220);
                  setAllEmojis(true);
                }}
                style={({ pressed }) => [styles.quick, pressed && styles.quickPressed]}
              >
                <Ionicons name="add" size={26} color={colors.text} />
              </PressableScale>
            )}
          </View>
          <MessageMenuItems
            message={shown}
            canEdit={canEdit}
            canDelete={canDelete}
            confirm={confirm}
            setConfirm={(value) => {
              animateNextLayout(160);
              setConfirm(value);
            }}
            close={onClose}
            onEdit={onEdit}
          />
        </>
      )}
    </BottomSheet>
  );
}

function MessageMenuItems({
  message,
  canEdit,
  canDelete,
  confirm,
  setConfirm,
  close,
  onEdit,
}: {
  message: LocalMessage | null;
  canEdit: boolean;
  canDelete: boolean;
  confirm: boolean;
  setConfirm: (confirm: boolean) => void;
  close: () => void;
  onEdit: (m: LocalMessage) => void;
}) {
  return (
    <>
      {message?.content ? (
        <MenuItem
          icon="copy-outline"
          label="Metni kopyala"
          onPress={() => {
            void Clipboard.setStringAsync(message.content).then(() => toast('Kopyalandı'));
            close();
          }}
        />
      ) : null}
      {canEdit && (
        <MenuItem
          icon="create-outline"
          label="Düzenle"
          onPress={() => {
            if (message) onEdit(message);
            close();
          }}
        />
      )}
      {canDelete && (
        <MenuItem
          icon="trash-outline"
          label={confirm ? 'Emin misin? Kalıcı olarak sil' : 'Mesajı sil'}
          danger
          onPress={() => {
            if (!confirm) {
              setConfirm(true);
              return;
            }
            if (message) void deleteMessage(message);
            close();
          }}
        />
      )}
      <MenuItem icon="close" label="Vazgeç" onPress={close} />
    </>
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
  page: { flex: 1, backgroundColor: colors.main },
  loading: { minHeight: 60, justifyContent: 'center', paddingBottom: 8 },
  intro: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 },
  introTitle: { color: colors.head, fontSize: 24, fontWeight: '800' },
  introText: { color: colors.muted, fontSize: 15, marginTop: 4 },
  introUser: { color: colors.text, fontSize: 16, marginTop: 2 },
  typing: { color: colors.text, fontSize: 12.5, paddingHorizontal: 16, height: 18 },
  quickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    marginBottom: 4,
  },
  quick: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.main,
  },
  quickMine: { backgroundColor: 'rgba(88,101,242,0.35)' },
  quickPressed: { backgroundColor: colors.active },
  quickEmoji: { fontSize: 24 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 15 },
  menuText: { color: colors.head, fontSize: 16 },
});
