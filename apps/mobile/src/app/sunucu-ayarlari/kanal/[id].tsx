import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  CHANNEL_NAME_MAX_LENGTH,
  hasPermission,
  Permission,
  sortRoles,
  type Channel,
  type PermissionOverwrite,
} from '@diskort/shared';
import {
  api,
  can,
  channelNameFor,
  channelPermissionInfos,
  errorMessage,
  overwriteState,
  permissionsOf,
  roleIsBelowFor,
  setOverwriteState,
  typedChannelName,
  useGuild,
  useSession,
  type OverwriteState,
} from '@diskort/client-core';
import { BottomSheet, SheetHeader } from '../../../components/BottomSheet';
import { confirmDeleteChannel } from '../../../components/ChannelMenu';
import { NoAccess, RoleDot, SettingsPage, useSettingsGuild, Warning } from '../../../components/serverSettings/common';
import { Button, Card, Field, SaveBar, SectionTitle, SwitchRow } from '../../../components/ui';
import { toast } from '../../../stores/ui';
import { colors, createStyles, font, radius, ripple, space } from '../../../theme';

/** Kanalı düzenlemek: ad (Kanalları Yönet), rol izinleri (Rolleri Yönet) ve silmek */
export default function ChannelSettingsScreen() {
  const guild = useSettingsGuild();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const channel = useGuild((s) => s.channels.find((c) => c.id === id));
  const selfId = useSession((s) => s.user?.id);
  const canManage = useGuild((s) => (id ? can(s, selfId, Permission.MANAGE_CHANNELS, id) : false));
  const canPermissions = useGuild((s) => (id ? can(s, selfId, Permission.MANAGE_ROLES, id) : false));
  const ready = useGuild((s) => s.status === 'ready');

  // Kanal silindi ya da artık görülemiyor (bir kez görülen kanal kaybolunca geri dönülür)
  const seen = useRef(false);
  if (channel) seen.current = true;
  useEffect(() => {
    if (ready && guild && !channel && seen.current && router.canGoBack()) router.back();
  }, [ready, guild, channel, router]);

  if (!guild || !channel) return null;
  const title = channel.type === 'text' ? `#${channel.name}` : channel.name;

  return (
    <>
      <Stack.Screen options={{ title }} />
      {!canManage && !canPermissions ? (
        <SettingsPage>
          <NoAccess text="Bu kanalı düzenleme yetkin yok." />
        </SettingsPage>
      ) : (
        // Kanal sunucuda değişince (başkası düzenledi) izin düzenleyicisi tazelenir
        <ChannelEditor
          key={JSON.stringify(channel.overwrites ?? [])}
          channel={channel}
          canManage={canManage}
          canPermissions={canPermissions}
        />
      )}
    </>
  );
}

function ChannelEditor({ channel, canManage, canPermissions }: { channel: Channel; canManage: boolean; canPermissions: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(channel.name);
  const [savingName, setSavingName] = useState(false);
  const [overwrites, setOverwrites] = useState<PermissionOverwrite[]>(channel.overwrites ?? []);
  const [savingPerms, setSavingPerms] = useState(false);
  const dirty = JSON.stringify(normalize(overwrites)) !== JSON.stringify(normalize(channel.overwrites ?? []));
  const finalName = channelNameFor(channel.type, name);

  const saveName = async (): Promise<void> => {
    if (!finalName) {
      toast('Kanal adı boş olamaz.', 'error');
      return;
    }
    setSavingName(true);
    try {
      const updated = await api.updateChannel(channel.id, { name: finalName });
      useGuild.getState().apply({ t: 'CHANNEL_UPDATE', d: updated });
      toast('Kanalın adı kaydedildi.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSavingName(false);
    }
  };

  const savePerms = async (): Promise<void> => {
    setSavingPerms(true);
    try {
      await api.updateChannel(channel.id, { overwrites });
      toast('Kanal izinleri kaydedildi.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSavingPerms(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (await confirmDeleteChannel(channel)) router.back();
  };

  return (
    <View style={{ flex: 1 }}>
      <SettingsPage footerSpace={dirty ? 80 : 0}>
        {canManage && (
          <>
            <SectionTitle>Kanal adı</SectionTitle>
            <Card style={styles.pad}>
              <Field
                label="Ad"
                value={name}
                onChangeText={(v) => setName(typedChannelName(channel.type, v))}
                maxLength={CHANNEL_NAME_MAX_LENGTH}
                autoCapitalize={channel.type === 'text' ? 'none' : 'sentences'}
                returnKeyType="done"
                onSubmitEditing={() => void saveName()}
              />
              <Button
                title="Kaydet"
                busy={savingName}
                disabled={!finalName || finalName === channel.name}
                onPress={() => void saveName()}
              />
            </Card>
          </>
        )}
        {canPermissions && <ChannelPermissions channel={channel} overwrites={overwrites} onChange={setOverwrites} />}
        {canManage && (
          <>
            <SectionTitle>Tehlikeli bölge</SectionTitle>
            <Card style={[styles.pad, styles.danger]}>
              <Text style={styles.muted}>
                {channel.type === 'text'
                  ? 'Kanal bütün mesajlarıyla kalıcı olarak silinir.'
                  : 'Ses kanalı silinir; içindekilerin bağlantısı kesilir.'}
              </Text>
              <View style={{ marginTop: space.md }}>
                <Button title="Kanalı sil" variant="danger" onPress={() => void remove()} />
              </View>
            </Card>
          </>
        )}
      </SettingsPage>
      <SaveBar
        visible={dirty}
        busy={savingPerms}
        bottomInset={insets.bottom}
        onReset={() => setOverwrites(channel.overwrites ?? [])}
        onSave={() => void savePerms()}
      />
    </View>
  );
}

/** Aynı izinlerin karşılaştırılabilmesi için sıralı biçim */
function normalize(list: PermissionOverwrite[]): PermissionOverwrite[] {
  return list.filter((o) => o.allow || o.deny).sort((a, b) => a.roleId.localeCompare(b.roleId));
}

/**
 * Kanal izinleri (masaüstündeki Kanalı Düzenle → İzinler): "Özel kanal" kısayolu ve rol başına her yetki
 * için engelle / varsayılan (rolden gelir) / izin ver.
 */
function ChannelPermissions({
  channel,
  overwrites,
  onChange,
}: {
  channel: Channel;
  overwrites: PermissionOverwrite[];
  onChange: (next: PermissionOverwrite[] | ((current: PermissionOverwrite[]) => PermissionOverwrite[])) => void;
}) {
  const rolesById = useGuild((s) => s.roles);
  const guildId = useGuild((s) => s.guild?.id ?? '');
  const selfId = useSession((s) => s.user?.id);
  // Listede gösterilen roller: @everyone ve izni olanlar (yeni eklenenler boş izinle de görünür)
  const [listed, setListed] = useState<string[]>(() => [
    guildId,
    ...(channel.overwrites ?? []).map((o) => o.roleId).filter((rid) => rid !== guildId),
  ]);
  const [selectedId, setSelectedId] = useState(guildId);
  const [adding, setAdding] = useState(false);

  const roles = useMemo(
    () => sortRoles(listed.map((rid) => rolesById[rid]).filter((r) => r !== undefined)),
    [listed, rolesById],
  );
  const selected = rolesById[selectedId] ?? rolesById[guildId];
  const infos = channelPermissionInfos(channel.type);
  const s = useGuild.getState();
  const myPermissions = permissionsOf(s, selfId, channel.id);
  const admin = hasPermission(permissionsOf(s, selfId), Permission.ADMINISTRATOR);
  const editable = selected ? roleIsBelowFor(s, selfId, selected) : false;
  const selectedIsAdmin = selected ? hasPermission(selected.permissions, Permission.ADMINISTRATOR) : false;
  const everyone = overwrites.find((o) => o.roleId === guildId);
  const isPrivate = everyone !== undefined && hasPermission(everyone.deny, Permission.VIEW_CHANNEL);
  const everyoneRole = rolesById[guildId];
  const addable = sortRoles(Object.values(rolesById)).filter((r) => !listed.includes(r.id));

  const set = (roleId: string, flag: number, state: OverwriteState): void =>
    onChange((list) => setOverwriteState(list, roleId, flag, state));

  if (!selected) return null;

  return (
    <View>
      <SectionTitle>İzinler</SectionTitle>
      <Card>
        <SwitchRow
          first
          label="Özel kanal"
          description={
            channel.type === 'text'
              ? 'Kanalı yalnızca aşağıda "Kanalı Gör" izni verilen roller (ve yöneticiler) görür.'
              : 'Kanalı yalnızca aşağıda "Kanalı Gör" izni verilen roller (ve yöneticiler) görür ve katılabilir.'
          }
          value={isPrivate}
          disabled={
            !everyoneRole ||
            !roleIsBelowFor(s, selfId, everyoneRole) ||
            (!admin && !hasPermission(myPermissions, Permission.VIEW_CHANNEL))
          }
          onChange={(on) => set(guildId, Permission.VIEW_CHANNEL, on ? 'deny' : 'inherit')}
        />
      </Card>

      <SectionTitle>Roller</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {roles.map((r) => {
          const on = r.id === selected.id;
          return (
            <Pressable
              key={r.id}
              onPress={() => setSelectedId(r.id)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <RoleDot color={r.color} size={10} />
              <Text style={[styles.chipText, on && { color: colors.head }]} numberOfLines={1}>
                {r.id === guildId ? '@everyone' : r.name}
              </Text>
            </Pressable>
          );
        })}
        {addable.length > 0 && (
          <Pressable onPress={() => setAdding(true)} style={styles.chip} accessibilityRole="button" accessibilityLabel="Rol ekle">
            <Ionicons name="add" size={16} color={colors.muted} />
            <Text style={styles.chipText}>Rol ekle</Text>
          </Pressable>
        )}
      </ScrollView>

      {!editable && <Warning>Bu rol senin en üst rolünden aşağıda olmadığı için izinlerini değiştiremezsin.</Warning>}
      {selectedIsAdmin && (
        <Warning icon="shield">
          Bu rolde Yönetici yetkisi var: kanal izinleri bu roldekileri etkilemez, engellesen de her şeyi yapabilirler.
        </Warning>
      )}

      <Card>
        {infos.map((p, i) => {
          const current = overwriteState(
            overwrites.find((o) => o.roleId === selected.id),
            p.flag,
          );
          const lacking = !admin && !hasPermission(myPermissions, p.flag);
          return (
            <View key={p.name}>
              {i > 0 && <View style={styles.divider} />}
              <View style={styles.permRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.permLabel}>{p.label}</Text>
                  <Text style={styles.permHint}>{p.description}</Text>
                </View>
                <TriState value={current} disabled={!editable || lacking} onChange={(state) => set(selected.id, p.flag, state)} />
              </View>
            </View>
          );
        })}
      </Card>
      <Text style={[styles.muted, { marginTop: space.md }]}>
        Sunucunun sahibi ve Yönetici yetkisi olanlar kanal izinlerinden etkilenmez. Bir üyenin rollerinden biri izin verip
        diğeri engellerse izin verme kazanır.
        {channel.type === 'text' ? ' Mesaj gönderemeyen dosya ekleyemez ve @everyone/@here kullanamaz.' : ''}
      </Text>

      <BottomSheet visible={adding} onClose={() => setAdding(false)}>
        <SheetHeader title="Rol ekle" subtitle="Bu kanalda izinlerini ayarlayacağın rol" />
        <ScrollView style={styles.sheetScroll} bounces={false}>
          {addable.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => {
                setListed((l) => [...l, r.id]);
                setSelectedId(r.id);
                setAdding(false);
              }}
              android_ripple={ripple.row}
              style={styles.sheetRow}
              accessibilityRole="button"
            >
              <RoleDot color={r.color} />
              <Text style={styles.sheetRowText} numberOfLines={1}>
                {r.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const OPTIONS: { value: OverwriteState; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'deny', label: 'Engelle', icon: 'close' },
  { value: 'inherit', label: 'Varsayılan (rolden gelir)', icon: 'remove' },
  { value: 'allow', label: 'İzin ver', icon: 'checkmark' },
];

/** Üç durumlu seçici: engelle (kırmızı) / varsayılan (gri) / izin ver (yeşil) */
function TriState({ value, disabled, onChange }: { value: OverwriteState; disabled: boolean; onChange: (v: OverwriteState) => void }) {
  return (
    <View style={[styles.tri, disabled && { opacity: 0.45 }]} accessibilityRole="radiogroup">
      {OPTIONS.map((o) => {
        const on = value === o.value;
        const bg = on ? (o.value === 'deny' ? colors.danger : o.value === 'allow' ? colors.ok : colors.control) : 'transparent';
        const fg = on ? (o.value === 'inherit' ? colors.onControl : '#fff') : colors.muted;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            disabled={disabled}
            hitSlop={{ top: 6, bottom: 6 }}
            style={[styles.triButton, { backgroundColor: bg }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={o.label}
          >
            <Ionicons name={o.icon} size={17} color={fg} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = createStyles(() => ({
  pad: { padding: space.lg },
  danger: { borderWidth: 1, borderColor: 'rgba(242,63,67,0.35)' },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  chips: { gap: space.sm, paddingBottom: space.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.side,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipOn: { backgroundColor: colors.active, borderColor: colors.brand },
  chipText: { color: colors.muted, fontSize: font.small, fontWeight: '600', maxWidth: 160 },
  divider: { height: 0.5, backgroundColor: colors.line, marginLeft: space.lg },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  permLabel: { color: colors.head, fontSize: font.row - 0.5, fontWeight: '500' },
  permHint: { color: colors.muted, fontSize: font.caption, lineHeight: 17, marginTop: 2 },
  tri: { flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  triButton: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center' },
  sheetScroll: { flexShrink: 1, flexGrow: 0 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg + 2, paddingVertical: space.md },
  sheetRowText: { color: colors.head, fontSize: font.row, fontWeight: '500', flex: 1 },
}));
