import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MESSAGE_MAX_LENGTH, type Channel, type User } from '@diskort/shared';
import { editMessage, notifyTyping, sendMessage, useGuild, type LocalMessage } from '@diskort/client-core';
import { toast } from '../stores/ui';
import { colors } from '../theme';
import { Avatar } from './Avatar';

/** Kanal değiştirince yarım kalan mesaj kaybolmasın */
const drafts = new Map<string, string>();

const MENTION_QUERY = /(?:^|[\s(])@([a-z0-9_.]{0,32})$/i;

interface Props {
  channel: Channel;
  /** Düzenlenen mesaj (varsa kutu düzenleme kipine geçer) */
  editing: LocalMessage | null;
  onDoneEditing: () => void;
  onSent: () => void;
}

export function Composer({ channel, editing, onDoneEditing, onSent }: Props) {
  const [value, setValue] = useState(() => drafts.get(channel.id) ?? '');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  // İmleç yalnızca bahsetme seçilince bir kez ayarlanır (sürekli kontrol Android'de imleci zıplatır)
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>();
  const [editText, setEditText] = useState<string | null>(null);
  const users = useGuild((s) => s.users);
  const online = useGuild((s) => s.online);

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
      .filter((u) => u.username.startsWith(q) || u.displayName.toLocaleLowerCase('tr').includes(q))
      .sort((a, b) => Number(!!online[b.id]) - Number(!!online[a.id]) || a.username.localeCompare(b.username))
      .slice(0, 5);
  }, [query, users, online]);

  const pick = (user: User): void => {
    const before = text.slice(0, selection.start).replace(/@[a-z0-9_.]*$/i, `@${user.username} `);
    setText(before + text.slice(selection.start));
    setSelection({ start: before.length, end: before.length });
    setForcedSelection({ start: before.length, end: before.length });
  };

  const submit = (): void => {
    const content = text.trim();
    if (!content) return;
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

  const remaining = MESSAGE_MAX_LENGTH - text.trim().length;

  return (
    <View>
      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map((u) => (
            <Pressable key={u.id} style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: colors.active }]} onPress={() => pick(u)}>
              <Avatar user={u} size={26} online={!!online[u.id]} />
              <Text style={styles.suggestionName}>{u.displayName}</Text>
              <Text style={styles.suggestionUser}>{u.username}</Text>
            </Pressable>
          ))}
        </View>
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
      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSelectionChange={(e) => {
            setSelection(e.nativeEvent.selection);
            setForcedSelection(undefined);
          }}
          selection={forcedSelection}
          placeholder={`#${channel.name} kanalına mesaj gönder`}
          placeholderTextColor={colors.faint}
          multiline
          maxLength={MESSAGE_MAX_LENGTH * 2}
          style={styles.input}
        />
        {remaining < 200 && <Text style={[styles.counter, remaining < 0 && { color: colors.danger }]}>{remaining}</Text>}
        <Pressable
          onPress={submit}
          disabled={!text.trim()}
          style={({ pressed }) => [styles.send, !text.trim() && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name={editing ? 'checkmark' : 'send'} size={20} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
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
