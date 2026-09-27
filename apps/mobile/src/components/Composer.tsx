import { useMemo, useState, type ReactNode } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MESSAGE_MAX_LENGTH, Permission, type Channel, type User } from '@diskort/shared';
import {
  addFiles,
  editMessage,
  formatBytes,
  notifyTyping,
  removeFile,
  sendMessage,
  useCan,
  useGuild,
  useMessages,
  type LocalFile,
  type LocalMessage,
} from '@diskort/client-core';
import { pickDocuments, pickMedia } from '../attachments';
import { useAppear } from '../motion';
import { toast } from '../stores/ui';
import { colors } from '../theme';
import { fileIcon } from './Attachments';
import { Avatar } from './Avatar';
import { BottomSheet } from './BottomSheet';
import { PressableScale } from './PressableScale';

/** Kanal değiştirince yarım kalan mesaj kaybolmasın */
const drafts = new Map<string, string>();

const MENTION_QUERY = /(?:^|[\s(])@([a-z0-9_.]{0,32})$/i;
const NO_FILES: LocalFile[] = [];

interface Props {
  /** Metin kanalı ya da direkt mesaj konuşması (kimlik ve görünen ad) */
  channel: Pick<Channel, 'id' | 'name'>;
  /** Düzenlenen mesaj (varsa kutu düzenleme kipine geçer) */
  editing: LocalMessage | null;
  onDoneEditing: () => void;
  onSent: () => void;
  /** Kutudaki ipucu (verilmezse "#kanal kanalına mesaj gönder") */
  placeholder?: string;
  /** Yazılamıyorsa kutu yerine gösterilecek açıklama (verilmezse izin yok mesajı) */
  lockedText?: string;
  /** Bahsetme önerilerinde yalnızca bu kişiler (ör. konuşmanın katılımcıları) */
  mentionable?: readonly string[];
}

export function Composer({ channel, editing, onDoneEditing, onSent, placeholder, lockedText, mentionable }: Props) {
  const [value, setValue] = useState(() => drafts.get(channel.id) ?? '');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  // İmleç yalnızca bahsetme seçilince bir kez ayarlanır (sürekli kontrol Android'de imleci zıplatır)
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>();
  const [editText, setEditText] = useState<string | null>(null);
  const [attachMenu, setAttachMenu] = useState(false);
  const users = useGuild((s) => s.users);
  const online = useGuild((s) => s.online);
  const files = useMessages((s) => s.pendingFiles[channel.id] ?? NO_FILES);
  const canSend = useCan(Permission.SEND_MESSAGES, channel.id);
  const canAttach = useCan(Permission.ATTACH_FILES, channel.id);

  // Düzenleme kipine geçince mesaj metniyle başla
  const text = editing ? (editText ?? editing.content) : value;
  const setText = (next: string): void => {
    if (editing) {
      setEditText(next);
      return;
    }
    setValue(next);
    if (next) drafts.set(channel.id, next);
    else drafts.delete(channel.id);
    if (next.trim()) notifyTyping(channel.id);
  };

  const query = MENTION_QUERY.exec(text.slice(0, selection.start))?.[1];
  const suggestions = useMemo(() => {
    if (query === undefined) return [];
    const q = query.toLocaleLowerCase('tr');
    return Object.values(users)
      .filter((u) => !u.removed && (!mentionable || mentionable.includes(u.id)))
      .filter((u) => u.username.startsWith(q) || u.displayName.toLocaleLowerCase('tr').includes(q))
      .sort((a, b) => Number(!!online[b.id]) - Number(!!online[a.id]) || a.username.localeCompare(b.username))
      .slice(0, 5);
  }, [query, users, online, mentionable]);

  const pick = (user: User): void => {
    const before = text.slice(0, selection.start).replace(/@[a-z0-9_.]*$/i, `@${user.username} `);
    setText(before + text.slice(selection.start));
    setSelection({ start: before.length, end: before.length });
    setForcedSelection({ start: before.length, end: before.length });
  };

  // Dosyalı mesajın metni boş olabilir
  const canSubmit = Boolean(text.trim()) || (editing ? editing.attachments.length > 0 : files.length > 0);

  const submit = (): void => {
    const content = text.trim();
    if (!canSubmit) return;
    if (content.length > MESSAGE_MAX_LENGTH) {
      toast(`Mesaj en fazla ${MESSAGE_MAX_LENGTH} karakter olabilir.`, 'error');
      return;
    }
    if (editing) {
      if (content !== editing.content) void editMessage(editing, content);
      setEditText(null);
      onDoneEditing();
      return;
    }
    sendMessage(channel.id, content);
    setText('');
    onSent();
  };

  const attach = async (pick: () => Promise<LocalFile[]>): Promise<void> => {
    setAttachMenu(false);
    try {
      const picked = await pick();
      if (picked.length) addFiles(channel.id, picked);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Dosya seçilemedi.', 'error');
    }
  };

  const remaining = MESSAGE_MAX_LENGTH - text.trim().length;

  // Salt okunur kanal (kendi mesajını düzenlemek yine serbest)
  if ((!canSend || lockedText) && !editing) {
    return (
      <View style={styles.locked}>
        <Ionicons name="lock-closed" size={16} color={colors.muted} />
        <Text style={styles.lockedText}>{lockedText ?? 'Bu kanala mesaj gönderme iznin yok.'}</Text>
      </View>
    );
  }

  return (
    <View>
      {suggestions.length > 0 && (
        <Suggestions>
          {suggestions.map((u) => (
            <Pressable key={u.id} style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: colors.active }]} onPress={() => pick(u)}>
              <Avatar user={u} size={26} online={!!online[u.id]} />
              <Text style={styles.suggestionName}>{u.displayName}</Text>
              <Text style={styles.suggestionUser}>{u.username}</Text>
            </Pressable>
          ))}
        </Suggestions>
      )}
      {editing && (
        <View style={styles.editBar}>
          <Text style={styles.editText}>Mesajı düzenliyorsun</Text>
          <Pressable
            hitSlop={8}
            onPress={() => {
              setEditText(null);
              onDoneEditing();
            }}
          >
            <Text style={{ color: colors.link }}>Vazgeç</Text>
          </Pressable>
        </View>
      )}
      {!editing && files.length > 0 && (
        <ScrollView horizontal style={styles.tray} contentContainerStyle={styles.trayContent} keyboardShouldPersistTaps="handled">
          {files.map((file, i) => (
            <View key={`${file.uri}-${i}`} style={styles.trayItem}>
              {file.uri && /^image\/(png|jpeg|gif|webp)$/.test(file.type) ? (
                <Image source={{ uri: file.uri }} style={styles.trayImage} />
              ) : (
                <View style={[styles.trayImage, styles.trayIcon]}>
                  <Ionicons name={fileIcon(file.type)} size={30} color={colors.muted} />
                </View>
              )}
              <Text style={styles.trayName} numberOfLines={1}>
                {file.name}
              </Text>
              <Text style={styles.traySize}>{formatBytes(file.size)}</Text>
              <Pressable
                hitSlop={8}
                style={styles.trayRemove}
                onPress={() => removeFile(channel.id, i)}
                accessibilityLabel="Kaldır"
              >
                <Ionicons name="close" size={14} color={colors.head} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      <View style={styles.row}>
        {!editing && canAttach && (
          <PressableScale
            scaleTo={0.85}
            onPress={() => setAttachMenu(true)}
            hitSlop={6}
            style={styles.attach}
            accessibilityLabel="Dosya ekle"
          >
            <Ionicons name="add-circle" size={30} color={colors.muted} />
          </PressableScale>
        )}
        <TextInput
          value={text}
          onChangeText={setText}
          onSelectionChange={(e) => {
            setSelection(e.nativeEvent.selection);
            setForcedSelection(undefined);
          }}
          selection={forcedSelection}
          placeholder={placeholder ?? `#${channel.name} kanalına mesaj gönder`}
          placeholderTextColor={colors.faint}
          multiline
          maxLength={MESSAGE_MAX_LENGTH * 2}
          style={styles.input}
        />
        {remaining < 200 && <Text style={[styles.counter, remaining < 0 && { color: colors.danger }]}>{remaining}</Text>}
        <PressableScale
          scaleTo={0.86}
          onPress={submit}
          disabled={!canSubmit}
          accessibilityLabel={editing ? 'Kaydet' : 'Gönder'}
          style={[styles.send, !canSubmit && { opacity: 0.4 }]}
        >
          <Ionicons name={editing ? 'checkmark' : 'send'} size={20} color="#fff" />
        </PressableScale>
      </View>

      <BottomSheet visible={attachMenu} onClose={() => setAttachMenu(false)}>
        <AttachOption icon="images-outline" label="Fotoğraf veya video" onPress={() => void attach(pickMedia)} />
        <AttachOption icon="document-outline" label="Dosya" onPress={() => void attach(pickDocuments)} />
        <AttachOption icon="close" label="Vazgeç" onPress={() => setAttachMenu(false)} />
      </BottomSheet>
    </View>
  );
}

/** @bahsetme önerileri: yazma kutusunun üstünde hafifçe yükselerek belirir */
function Suggestions({ children }: { children: ReactNode }) {
  const appear = useAppear(true, 160);
  return (
    <Animated.View
      style={[
        styles.suggestions,
        {
          opacity: appear,
          transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function AttachOption({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.hover }]}>
      <Ionicons name={icon} size={22} color={colors.text} />
      <Text style={styles.optionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  attach: { height: 44, justifyContent: 'center' },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: colors.side,
  },
  lockedText: { color: colors.muted, fontSize: 15, flexShrink: 1 },
  tray: { flexGrow: 0, backgroundColor: colors.side },
  trayContent: { gap: 10, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  trayItem: { width: 92 },
  trayImage: { width: 92, height: 92, borderRadius: 8, backgroundColor: colors.main },
  trayIcon: { alignItems: 'center', justifyContent: 'center' },
  trayName: { color: colors.text, fontSize: 12, marginTop: 4 },
  traySize: { color: colors.muted, fontSize: 11 },
  trayRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.deep,
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 15 },
  optionText: { color: colors.head, fontSize: 16 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 160,
    backgroundColor: colors.hover,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    color: colors.text,
    fontSize: 16,
  },
  counter: { color: colors.muted, fontSize: 12, marginBottom: 14 },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestions: { backgroundColor: colors.side, borderTopLeftRadius: 10, borderTopRightRadius: 10, paddingVertical: 4 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  suggestionName: { color: colors.head, fontSize: 15, fontWeight: '500' },
  suggestionUser: { color: colors.muted, fontSize: 13 },
  editBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: colors.side,
  },
  editText: { color: colors.muted, fontSize: 13 },
});
