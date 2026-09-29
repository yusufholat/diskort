import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  hasPermission,
  Permission,
  ROLE_COLOR_PATTERN,
  ROLE_NAME_MAX_LENGTH,
  type Role,
  type UpdateRoleRequest,
} from '@diskort/shared';
import {
  api,
  canAssignRole,
  canManageRole,
  errorMessage,
  moderation,
  PERMISSION_GROUPS,
  rolePermissionSource,
  useGuild,
  usePermissions,
  useSession,
} from '@diskort/client-core';
import { Avatar } from '../../../components/Avatar';
import { BottomSheet, SheetHeader } from '../../../components/BottomSheet';
import { confirmDialog } from '../../../components/Dialog';
import { SettingsPage, useSettingsGuild, Warning } from '../../../components/serverSettings/common';
import { Button, Card, Field, SaveBar, SectionTitle, Segmented, SwitchRow } from '../../../components/ui';
import { toast } from '../../../stores/ui';
import { colors, createStyles, font, radius, ripple, space } from '../../../theme';

/** Rol renkleri (masaüstündekiyle aynı palet) */
const ROLE_COLORS = [
  '#1abc9c',
  '#2ecc71',
  '#3498db',
  '#9b59b6',
  '#e91e63',
  '#f1c40f',
  '#e67e22',
  '#e74c3c',
  '#95a5a6',
  '#607d8b',
  '#11806a',
  '#1f8b4c',
  '#206694',
  '#71368a',
  '#ad1457',
  '#c27c0e',
  '#a84300',
  '#992d22',
];

type Tab = 'display' | 'permissions' | 'members';

interface Draft {
  name: string;
  color: string | null;
  hoist: boolean;
  permissions: number;
}

/** Rol düzenleme (masaüstündeki Roller → rol): Görünüm, Yetkiler, Üyeler */
export default function RoleScreen() {
  const guild = useSettingsGuild();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useGuild((s) => (id ? s.roles[id] : undefined));
  const ready = useGuild((s) => s.status === 'ready');

  // Rol silindi: ekran kapanır. Yeni oluşturulan rol gateway'den biraz sonra gelebilir; ancak bir kez
  // görülen rol kaybolunca geri dönülür.
  const seen = useRef(false);
  if (role) seen.current = true;
  useEffect(() => {
    if (ready && guild && !role && seen.current && router.canGoBack()) router.back();
  }, [ready, guild, role, router]);

  if (!guild || !role) return null;
  const everyone = role.id === guild.id;
  return (
    <>
      <Stack.Screen options={{ title: everyone ? '@everyone' : role.name }} />
      {/* Rol sunucuda değişince (kaydedildi ya da başkası düzenledi) düzenleyici tazelenir */}
      <RoleEditor key={`${role.id}:${role.name}:${role.color}:${role.hoist}:${role.permissions}`} role={role} everyone={everyone} />
    </>
  );
}

function RoleEditor({ role, everyone }: { role: Role; everyone: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const selfId = useSession((s) => s.user?.id);
  // Yetkiler birleşir: @everyone'da açık olan bir yetki her rolde de fiilen açıktır
  const everyonePermissions = useGuild((s) => (s.guild ? (s.roles[s.guild.id]?.permissions ?? 0) : 0));
  const myPermissions = usePermissions();
  const manageable = useGuild((s) => canManageRole(s, selfId, role));
  const admin = hasPermission(myPermissions, Permission.ADMINISTRATOR);
  const original: Draft = { name: role.name, color: role.color, hoist: role.hoist, permissions: role.permissions };
  const [draft, setDraft] = useState<Draft>(original);
  const [colorText, setColorText] = useState(role.color ?? '');
  const [tab, setTab] = useState<Tab>(everyone ? 'permissions' : 'display');
  const [busy, setBusy] = useState(false);
  const dirty =
    draft.name !== original.name ||
    draft.color !== original.color ||
    draft.hoist !== original.hoist ||
    draft.permissions !== original.permissions;

  const set = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }));

  const save = async (): Promise<void> => {
    const name = draft.name.trim();
    if (!name) {
      toast('Rol adı boş olamaz.', 'error');
      return;
    }
    const patch: UpdateRoleRequest = {};
    if (draft.permissions !== original.permissions) patch.permissions = draft.permissions;
    if (!everyone) {
      if (name !== original.name) patch.name = name;
      if (draft.color !== original.color) patch.color = draft.color;
      if (draft.hoist !== original.hoist) patch.hoist = draft.hoist;
    }
    setBusy(true);
    try {
      await api.updateRole(useGuild.getState().activeGuildId ?? '', role.id, patch);
      toast('Rol kaydedildi.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: `"${role.name}" rolü silinsin mi?`,
      message: 'Rol bütün üyelerden alınır ve kanal izinlerinden kaldırılır. Bu işlem geri alınamaz.',
      icon: 'trash-outline',
      confirmLabel: 'Rolü sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteRole(useGuild.getState().activeGuildId ?? '', role.id);
      toast('Rol silindi.');
      router.back();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const tabs: { value: Tab; label: string }[] = everyone
    ? [{ value: 'permissions', label: 'Yetkiler' }]
    : [
        { value: 'display', label: 'Görünüm' },
        { value: 'permissions', label: 'Yetkiler' },
        { value: 'members', label: 'Üyeler' },
      ];

  return (
    <View style={{ flex: 1 }}>
      <SettingsPage footerSpace={dirty ? 80 : 0}>
        <View style={styles.titleRow}>
          <View style={[styles.bigDot, { backgroundColor: draft.color ?? '#99aab5' }]} />
          <Text style={[styles.title, draft.color ? { color: draft.color } : null]} numberOfLines={1}>
            {everyone ? '@everyone' : draft.name || 'Adsız rol'}
          </Text>
        </View>
        {!manageable && <Warning>Bu rol senin en üst rolünden aşağıda olmadığı için düzenleyemezsin.</Warning>}
        {tabs.length > 1 && <Segmented options={tabs} value={tab} onChange={setTab} />}

        {tab === 'display' && (
          <View>
            <SectionTitle>Rol adı</SectionTitle>
            <Card style={styles.pad}>
              <Field
                label="Ad"
                value={draft.name}
                maxLength={ROLE_NAME_MAX_LENGTH}
                editable={manageable}
                onChangeText={(name) => set({ name })}
              />
            </Card>
            <SectionTitle>Rol rengi</SectionTitle>
            <Card style={styles.pad}>
              <View style={styles.swatches}>
                <Pressable
                  onPress={() => {
                    set({ color: null });
                    setColorText('');
                  }}
                  disabled={!manageable}
                  style={[styles.swatch, styles.noColor, draft.color === null && styles.swatchOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draft.color === null }}
                  accessibilityLabel="Renksiz"
                >
                  <Ionicons name="close" size={16} color="#99aab5" />
                </Pressable>
                {ROLE_COLORS.map((color) => (
                  <Pressable
                    key={color}
                    onPress={() => {
                      set({ color });
                      setColorText(color);
                    }}
                    disabled={!manageable}
                    style={[styles.swatch, { backgroundColor: color }, draft.color === color && styles.swatchOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: draft.color === color }}
                    accessibilityLabel={color}
                  />
                ))}
              </View>
              <View style={styles.hexRow}>
                <View style={[styles.hexPreview, { backgroundColor: draft.color ?? '#99aab5' }]} />
                <TextInput
                  value={colorText}
                  editable={manageable}
                  maxLength={7}
                  placeholder="#rrggbb"
                  placeholderTextColor={colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Özel renk"
                  style={styles.hexInput}
                  onChangeText={(value) => {
                    const t = value.trim();
                    setColorText(t);
                    if (t === '') set({ color: null });
                    else if (ROLE_COLOR_PATTERN.test(t)) set({ color: t.toLowerCase() });
                  }}
                />
              </View>
              {colorText !== '' && !ROLE_COLOR_PATTERN.test(colorText) && (
                <Text style={styles.error}>Renk #rrggbb biçiminde olmalı.</Text>
              )}
            </Card>
            <SectionTitle>Üye listesi</SectionTitle>
            <Card>
              <SwitchRow
                first
                label="Üyeleri ayrı göster"
                description="Bu roldeki çevrimiçi üyeler üye listesinde kendi başlıkları altında görünür."
                value={draft.hoist}
                disabled={!manageable}
                onChange={(hoist) => set({ hoist })}
              />
            </Card>
            {manageable && (
              <View style={{ marginTop: space.xxl }}>
                <Button title="Rolü sil" variant="danger" onPress={() => void remove()} />
              </View>
            )}
          </View>
        )}

        {tab === 'permissions' && (
          <View>
            <View style={{ marginTop: space.md }}>
              {everyone ? (
                <Text style={styles.muted}>
                  Bu yetkiler herkese verilir. Burada açık olan bir yetki, başka bir rolde kapalı olsa bile herkeste kalır
                  (yetkiler birleşir). Bir yetkiyi yalnızca bazı rollere vermek için burada kapat, o rollerde aç.
                </Text>
              ) : hasPermission(draft.permissions, Permission.ADMINISTRATOR) ? (
                <Warning icon="shield">
                  Bu rolde Yönetici yetkisi açık: roldekiler aşağıdaki bütün yetkilere sahiptir ve kanal izinlerinden
                  etkilenmez.
                </Warning>
              ) : (
                <Text style={styles.muted}>
                  Üyeler @everyone rolünün ve sahip oldukları bütün rollerin yetkilerini birlikte alır. Kilitli yetkiler
                  @everyone rolünde açık olduğu için herkeste zaten var.
                </Text>
              )}
            </View>
            {PERMISSION_GROUPS.map((group) => (
              <View key={group.title}>
                <SectionTitle>{group.title}</SectionTitle>
                <Card>
                  {group.permissions.map((p, i) => {
                    const lacking = !admin && !hasPermission(myPermissions, p.flag);
                    const own = hasPermission(draft.permissions, p.flag);
                    const source = rolePermissionSource(
                      { permissions: draft.permissions, isEveryone: everyone },
                      everyonePermissions,
                      p.flag,
                    );
                    const locked = source !== 'role';
                    return (
                      <SwitchRow
                        key={p.name}
                        first={i === 0}
                        label={p.label}
                        description={lacking ? `${p.description} (Sende olmayan bir yetkiyi veremezsin.)` : p.description}
                        value={own || locked}
                        disabled={!manageable || lacking || locked}
                        onChange={(on) =>
                          set({ permissions: on ? draft.permissions | p.flag : draft.permissions & ~p.flag })
                        }
                      >
                        {source === 'everyone' && (
                          <View style={styles.lockNote}>
                            <Ionicons name="lock-closed" size={12} color={colors.muted} />
                            <Text style={styles.lockText}>
                              @everyone rolünde açık; herkeste zaten var.
                              {own ? ' Bu rolde de ayrıca açık.' : ''}
                            </Text>
                            {own && manageable && !lacking && (
                              <Pressable onPress={() => set({ permissions: draft.permissions & ~p.flag })} hitSlop={6}>
                                <Text style={styles.link}>Bu rolden kaldır</Text>
                              </Pressable>
                            )}
                          </View>
                        )}
                        {source === 'administrator' && (
                          <View style={styles.lockNote}>
                            <Ionicons name="lock-closed" size={12} color={colors.muted} />
                            <Text style={styles.lockText}>Yönetici yetkisi açık olduğu için zaten var.</Text>
                          </View>
                        )}
                      </SwitchRow>
                    );
                  })}
                </Card>
              </View>
            ))}
          </View>
        )}

        {tab === 'members' && <RoleMembers role={role} />}
      </SettingsPage>
      <SaveBar
        visible={dirty}
        busy={busy}
        disabled={!manageable}
        bottomInset={insets.bottom}
        onReset={() => {
          setDraft(original);
          setColorText(original.color ?? '');
        }}
        onSave={() => void save()}
      />
    </View>
  );
}

/** Roldeki üyeler; yetkiliyse üye ekleyip çıkarabilir */
function RoleMembers({ role }: { role: Role }) {
  const users = useGuild((s) => s.users);
  const selfId = useSession((s) => s.user?.id);
  const [adding, setAdding] = useState(false);
  const holders = useMemo(
    () =>
      Object.values(users)
        .filter((u) => !u.removed && u.roles.includes(role.id))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr')),
    [users, role.id],
  );
  const s = useGuild.getState();
  const candidates = Object.values(users)
    .filter((u) => !u.removed && !u.roles.includes(role.id) && canAssignRole(s, selfId, u.id, role))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'));

  return (
    <View style={{ marginTop: space.md }}>
      {candidates.length > 0 && <Button title="Üye ekle" variant="secondary" onPress={() => setAdding(true)} />}
      <SectionTitle>{`Roldekiler — ${holders.length}`}</SectionTitle>
      <Card>
        {holders.length === 0 && <Text style={[styles.muted, styles.pad]}>Bu rolde kimse yok.</Text>}
        {holders.map((u, i) => (
          <View key={u.id}>
            {i > 0 && <View style={styles.divider} />}
            <View style={styles.personRow}>
              <Avatar user={u} size={32} />
              <Text style={styles.personName} numberOfLines={1}>
                {u.displayName}
              </Text>
              {canAssignRole(s, selfId, u.id, role) && (
                <Pressable
                  onPress={() => void moderation.setRole(u.id, role.id, false)}
                  hitSlop={8}
                  style={styles.removeButton}
                  accessibilityRole="button"
                  accessibilityLabel={`${u.displayName} kişisini rolden çıkar`}
                >
                  <Ionicons name="close" size={18} color={colors.muted} />
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </Card>
      <BottomSheet visible={adding} onClose={() => setAdding(false)}>
        <SheetHeader title="Üye ekle" subtitle={`${role.name} rolünü ver`} />
        <ScrollView style={styles.sheetScroll} bounces={false}>
          {candidates.map((u) => (
            <Pressable
              key={u.id}
              onPress={() => {
                setAdding(false);
                void moderation.setRole(u.id, role.id, true);
              }}
              android_ripple={ripple.row}
              style={styles.sheetRow}
              accessibilityRole="button"
            >
              <Avatar user={u} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.personName} numberOfLines={1}>
                  {u.displayName}
                </Text>
                <Text style={styles.muted}>@{u.username}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = createStyles(() => ({
  pad: { padding: space.lg },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  bigDot: { width: 18, height: 18, borderRadius: 9 },
  title: { flex: 1, color: colors.head, fontSize: font.heading, fontWeight: '800' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // borderWidth: 0: seçim kalkınca kenarlık kaldırılmasın (Android'de NaN gelir; bkz. ProfileSettings)
  swatch: { width: 36, height: 36, borderRadius: radius.md, borderWidth: 0 },
  noColor: { borderWidth: 2, borderColor: '#99aab5', alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 3, borderColor: colors.head },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, marginTop: space.lg },
  hexPreview: { width: 36, height: 36, borderRadius: radius.md },
  hexInput: {
    width: 130,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.input,
    color: colors.text,
    paddingHorizontal: space.md,
    fontSize: 15,
    fontFamily: 'monospace',
  },
  error: { color: colors.dangerText, fontSize: font.caption + 0.5, marginTop: space.sm },
  lockNote: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    marginTop: -space.xs,
  },
  lockText: { color: colors.muted, fontSize: font.caption, flexShrink: 1 },
  link: { color: colors.link, fontSize: font.caption, fontWeight: '600' },
  divider: { height: 0.5, backgroundColor: colors.line, marginLeft: 60 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm + 2 },
  personName: { flex: 1, color: colors.head, fontSize: font.row, fontWeight: '600' },
  removeButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sheetScroll: { flexShrink: 1, flexGrow: 0 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg + 2, paddingVertical: space.sm + 2 },
}));
