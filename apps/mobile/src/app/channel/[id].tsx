import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import {
  ackChannel,
  deleteMessage,
  loadInitial,
  loadOlder,
  useGuild,
  useMessages,
  useSession,
  type LocalMessage,
} from '@diskort/client-core';
import { Composer } from '../../components/Composer';
import type { MarkdownContext } from '../../components/Markdown';
import { MessageRow, sameDay } from '../../components/MessageRow';
import { VoiceBar } from '../../components/VoiceBar';
import { toast, useUi } from '../../stores/ui';
import { colors } from '../../theme';

const GROUP_WINDOW_MS = 7 * 60_000;
const EMPTY: LocalMessage[] = [];

export default function TextChannelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const channel = useGuild((s) => s.channels.find((c) => c.id === id));
  const self = useSession((s) => s.user);
  const users = useGuild((s) => s.users);
  const messages = useMessages((s) => (id ? s.channels[id]?.messages : undefined) ?? EMPTY);
  const loaded = useMessages((s) => (id ? s.channels[id]?.loaded : false) ?? false);
  const hasMore = useMessages((s) => (id ? s.channels[id]?.hasMore : true) ?? true);
  const loading = useMessages((s) => (id ? s.channels[id]?.loading : false) ?? false);
  const lastId = useGuild((s) => (id ? s.lastMessageIds[id] : undefined));
  const readId = useGuild((s) => (id ? s.readStates[id] : undefined));
  const typing = useMessages((s) => (id ? s.typing[id] : undefined));

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

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    setAtBottom(e.nativeEvent.contentOffset.y < 40);
  };

  const typingNames = Object.keys(typing ?? {})
    .filter((uid) => uid !== self?.id)
    .map((uid) => users[uid]?.displayName)
    .filter(Boolean) as string[];

  if (!channel || !self || !id) {
    return <View style={styles.page} />;
  }

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen options={{ title: `# ${channel.name}` }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={100}>
        <FlatList
          ref={list}
          inverted
          data={data}
          keyExtractor={(m) => m.nonce ?? m.id}
          onScroll={onScroll}
          scrollEventThrottle={100}
          onEndReached={() => void loadOlder(id)}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingVertical: 8 }}
          ListFooterComponent={
            hasMore || !loaded ? (
              <View style={styles.loading}>{loading ? <ActivityIndicator color={colors.muted} /> : null}</View>
            ) : (
              <View style={styles.intro}>
                <Text style={styles.introTitle}>#{channel.name} kanalına hoş geldin!</Text>
                <Text style={styles.introText}>Bu, #{channel.name} kanalının başlangıcı.</Text>
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
          channel={channel}
          editing={editing}
          onDoneEditing={() => setEditing(null)}
          onSent={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
        />
      </KeyboardAvoidingView>
      <VoiceBar />

      <MessageMenu
        message={menuFor}
        canEdit={menuFor?.authorId === self.id}
        canDelete={menuFor?.authorId === self.id || self.isAdmin}
        onClose={() => setMenuFor(null)}
        onEdit={(m) => setEditing(m)}
      />
    </SafeAreaView>
  );
}

function MessageMenu({
  message,
  canEdit,
  canDelete,
  onClose,
  onEdit,
}: {
  message: LocalMessage | null;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (m: LocalMessage) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const close = (): void => {
    setConfirm(false);
    onClose();
  };
  return (
    <Modal visible={message !== null} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet}>
          <MenuItem
            label="Metni kopyala"
            onPress={() => {
              if (message) void Clipboard.setStringAsync(message.content).then(() => toast('Kopyalandı'));
              close();
            }}
          />
          {canEdit && (
            <MenuItem
              label="Düzenle"
              onPress={() => {
                if (message) onEdit(message);
                close();
              }}
            />
          )}
          {canDelete && (
            <MenuItem
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
          <MenuItem label="Vazgeç" onPress={close} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuItem({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.hover }]}>
      <Text style={[styles.menuText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.main },
  loading: { height: 60, alignItems: 'center', justifyContent: 'center' },
  intro: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 },
  introTitle: { color: colors.head, fontSize: 24, fontWeight: '800' },
  introText: { color: colors.muted, fontSize: 15, marginTop: 4 },
  typing: { color: colors.text, fontSize: 12.5, paddingHorizontal: 16, height: 18 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.side, borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingVertical: 8, paddingBottom: 24 },
  menuItem: { paddingHorizontal: 20, paddingVertical: 15 },
  menuText: { color: colors.head, fontSize: 16 },
});
