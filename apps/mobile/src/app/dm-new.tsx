import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DM_GROUP_MAX_PARTICIPANTS, DM_NAME_MAX_LENGTH } from '@diskort/shared';
import { addDmParticipant, createDm, dmTitle, useGuild, useSession } from '@diskort/client-core';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/ui';
import { colors, radius } from '../theme';

const NOBODY: string[] = [];

/**
 * Kişi seçerek direkt mesaj başlatmak: tek kişi bire bir konuşma, birden çok kişi grup (isteğe bağlı
 * adıyla). `addTo` verilirse seçilenler o gruba eklenir.
 */
export default function NewDmScreen() {
  const { addTo } = useLocalSearchParams<{ addTo?: string }>();
  const router = useRouter();
  const selfId = useSession((s) => s.user?.id);
  const users = useGuild((s) => s.users);
  const online = useGuild((s) => s.online);
  const group = useGuild((s) => (addTo ? s.dms[addTo] : undefined));
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const existing = group?.participantIds ?? NOBODY;
  // Seçilebilecek en fazla kişi: grubun boş yeri ya da (yeni konuşmada) kendin hariç sınır
  const capacity = group ? DM_GROUP_MAX_PARTICIPANTS - existing.length : DM_GROUP_MAX_PARTICIPANTS - 1;
  const candidates = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    return Object.values(users)
      .filter((u) => !u.removed && u.id !== selfId && !existing.includes(u.id))
      .filter((u) => !q || u.username.includes(q) || u.displayName.toLocaleLowerCase('tr').includes(q))
      .sort(
        (a, b) =>
          Number(Boolean(online[b.id])) - Number(Boolean(online[a.id])) ||
          a.displayName.localeCompare(b.displayName, 'tr'),
      );
  }, [users, online, selfId, existing, query]);

  const toggle = (id: string): void =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : current.length < capacity ? [...current, id] : current,
    );

  const makesGroup = !group && selected.length > 1;

  const submit = async (): Promise<void> => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      if (group) {
        for (const id of selected) if (!(await addDmParticipant(group.id, id))) return;
        router.back();
        return;
      }
      const dm = await createDm(selected, makesGroup ? name.trim() || null : null);
      // Seçim ekranının yerine konuşma açılır (geri gelince listeye dönülür)
      if (dm) router.replace(`/channel/${dm.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen options={{ title: group ? 'Kişi ekle' : 'Yeni mesaj' }} />
      <Text style={styles.hint}>
        {group
          ? `${dmTitle(group, users, selfId)} grubuna eklenecek kişileri seç. Eklenenler geçmiş mesajları da görür.`
          : `Bir kişi seçersen bire bir konuşma, birden çok kişi seçersen grup başlar (en fazla ${DM_GROUP_MAX_PARTICIPANTS} kişi).`}
      </Text>
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Kullanıcı ara"
          placeholderTextColor={colors.faint}
          selectionColor={colors.brand}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
      </View>
      <FlatList
        data={candidates}
        keyExtractor={(u) => u.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 8 }}
        ListEmptyComponent={
          <Text style={styles.empty}>{query ? 'Eşleşen kimse yok.' : 'Eklenebilecek kimse yok.'}</Text>
        }
        renderItem={({ item }) => {
          const on = selected.includes(item.id);
          const disabled = !on && selected.length >= capacity;
          return (
            <Pressable
              onPress={() => toggle(item.id)}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled }}
              style={({ pressed }) => [
                styles.row,
                on && { backgroundColor: colors.active },
                pressed && { backgroundColor: colors.hover },
                disabled && { opacity: 0.4 },
              ]}
            >
              <Avatar user={item} size={38} online={Boolean(online[item.id])} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.displayName}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  @{item.username}
                </Text>
              </View>
              <View style={[styles.check, on && styles.checkOn]}>
                {on && <Ionicons name="checkmark" size={16} color="#fff" />}
              </View>
            </Pressable>
          );
        }}
      />
      <View style={styles.footer}>
        {makesGroup && (
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={DM_NAME_MAX_LENGTH}
            placeholder="Grup adı (isteğe bağlı)"
            placeholderTextColor={colors.faint}
            selectionColor={colors.brand}
            style={styles.nameInput}
          />
        )}
        <Button
          title={
            group
              ? `Ekle${selected.length ? ` (${selected.length})` : ''}`
              : makesGroup
                ? `Grup oluştur (${selected.length + 1} kişi)`
                : 'Mesaj gönder'
          }
          disabled={selected.length === 0}
          busy={busy}
          onPress={() => void submit()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.side },
  hint: { color: colors.muted, fontSize: 14, paddingHorizontal: 16, paddingTop: 14, lineHeight: 20 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.input,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    marginHorizontal: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  name: { color: colors.text, fontSize: 16, fontWeight: '500' },
  sub: { color: colors.muted, fontSize: 13 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  empty: { color: colors.muted, fontSize: 15, textAlign: 'center', padding: 24 },
  footer: {
    gap: 10,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.side,
  },
  nameInput: {
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.input,
    color: colors.text,
    paddingHorizontal: 12,
    fontSize: 16,
  },
});
