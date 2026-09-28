import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { GUILD_NAME_MAX_LENGTH, Permission, type Guild } from '@diskort/shared';
import {
  api,
  deleteGuild,
  errorMessage,
  isOwner,
  removeGuildIcon,
  uploadGuildIcon,
  useCan,
  useGuild,
  useSession,
} from '@diskort/client-core';
import { pickAvatar } from '../../attachments';
import { feedback } from '../../haptics';
import { toast } from '../../stores/ui';
import { colors, createStyles, font, radius, ripple, space } from '../../theme';
import { Avatar } from '../Avatar';
import { BottomSheet, SheetHeader } from '../BottomSheet';
import { confirmDialog } from '../Dialog';
import { GuildIcon } from '../GuildIcon';
import { PressableScale } from '../PressableScale';
import { Button, Card, Field, SectionTitle } from '../ui';

/** Genel (masaüstündeki gibi): sunucunun simgesi ve adı, sahip, sahipliği devretmek ve sunucuyu silmek */
export function OverviewSection({ guild }: { guild: Guild }) {
  const selfId = useSession((s) => s.user?.id);
  const owner = useGuild((s) => isOwner(s, selfId));
  const isPrimary = useGuild((s) => s.activeGuildId === s.primaryGuildId);
  const canManage = useCan(Permission.MANAGE_GUILD);
  const ownerUser = useGuild((s) => (s.guild?.ownerId ? s.users[s.guild.ownerId] : undefined));
  const [name, setName] = useState(guild.name);
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const saveName = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('Sunucu adı boş olamaz.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.updateGuild(guild.id, { name: trimmed });
      toast('Sunucunun adı kaydedildi.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: `"${guild.name}" silinsin mi?`,
      message:
        'Sunucu bütün kanalları, mesajları, dosyaları, rolleri ve davetleriyle kalıcı olarak silinir. Üyeler sunucuya bir daha erişemez. Bu işlem geri alınamaz.',
      icon: 'trash-outline',
      confirmLabel: 'Sunucuyu sil',
      danger: true,
      requireText: guild.name,
    });
    if (!ok) return;
    if (await deleteGuild(guild.id)) {
      feedback('moderate');
      toast('Sunucu silindi.');
      if (router.canDismiss()) router.dismissTo('/');
    }
  };

  return (
    <View>
      {canManage && <IconPicker guild={guild} />}
      <SectionTitle>Sunucu adı</SectionTitle>
      <Card style={styles.pad}>
        <Field
          label="Ad"
          value={name}
          onChangeText={setName}
          maxLength={GUILD_NAME_MAX_LENGTH}
          editable={canManage}
          returnKeyType="done"
          onSubmitEditing={() => void saveName()}
        />
        {canManage ? (
          <Button
            title="Kaydet"
            busy={busy}
            disabled={!name.trim() || name.trim() === guild.name}
            onPress={() => void saveName()}
          />
        ) : (
          <Text style={styles.muted}>Sunucunun adını değiştirmek için Sunucuyu Yönet yetkisi gerekir.</Text>
        )}
      </Card>

      <SectionTitle>Sahip</SectionTitle>
      <Card style={styles.pad}>
        <View style={styles.ownerRow}>
          <Avatar user={ownerUser} size={40} surface={colors.side} />
          <View style={{ flex: 1 }}>
            <View style={styles.ownerName}>
              <Text style={styles.ownerText} numberOfLines={1}>
                {ownerUser?.displayName ?? 'Yok'}
              </Text>
              <MaterialCommunityIcons name="crown-outline" size={16} color={colors.warn} accessibilityLabel="Sahip" />
            </View>
            {ownerUser && <Text style={styles.muted}>@{ownerUser.username}</Text>}
          </View>
        </View>
        <Text style={[styles.muted, { marginTop: space.md }]}>
          Sahip herkesin üstündedir ve her yetkiye sahiptir; kimse onu atamaz, yasaklayamaz ya da rollerini
          değiştiremez. Sahip sunucudan ayrılmadan ya da hesabını silmeden önce sahipliği başka birine devretmelidir.
        </Text>
        {owner && (
          <View style={{ marginTop: space.md }}>
            <Button title="Sahipliği devret" variant="secondary" onPress={() => setTransferOpen(true)} />
          </View>
        )}
      </Card>

      {owner && !isPrimary && (
        <>
          <SectionTitle>Tehlikeli bölge</SectionTitle>
          <Card style={[styles.pad, styles.danger]}>
            <Text style={[styles.muted, { marginBottom: space.md }]}>
              Sunucu, kanalları ve bütün mesajlarıyla kalıcı olarak silinir. Bu işlem geri alınamaz.
            </Text>
            <Button title="Sunucuyu sil" variant="danger" onPress={() => void remove()} />
          </Card>
        </>
      )}
      {owner && isPrimary && (
        <Text style={[styles.muted, { marginTop: space.lg }]}>
          Bu, hesap yöneticilerinin ana sunucusu olduğu için silinemez.
        </Text>
      )}

      <TransferOwnership guild={guild} open={transferOpen} onClose={() => setTransferOpen(false)} />
    </View>
  );
}

/** Sunucu simgesi: galeriden seçilip Android'in kırpma ekranında kare kırpılır; sunucu küçültür */
function IconPicker({ guild }: { guild: Guild }) {
  const [busy, setBusy] = useState(false);

  const change = async (): Promise<void> => {
    const file = await pickAvatar().catch((err: unknown) => {
      toast(errorMessage(err), 'error');
      return null;
    });
    if (!file) return;
    setBusy(true);
    try {
      await uploadGuildIcon(guild.id, file);
      toast('Sunucu simgesi güncellendi.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Simge kaldırılsın mı?',
      message: 'Simgenin yerinde sunucu adının baş harfleri görünür.',
      confirmLabel: 'Kaldır',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeGuildIcon(guild.id);
      toast('Sunucu simgesi kaldırıldı.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.iconBlock}>
      <PressableScale
        scaleTo={0.94}
        onPress={() => void change()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Sunucu simgesini değiştir"
      >
        <GuildIcon guild={guild} size={96} radius={32} />
        <View style={styles.cameraBadge}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={16} color="#fff" />}
        </View>
      </PressableScale>
      <Text style={styles.hint}>Simgeyi değiştirmek için dokun. Kare kırpılır; en az 256×256 önerilir.</Text>
      {guild.iconUrl ? (
        <Pressable onPress={() => void remove()} disabled={busy} hitSlop={8} accessibilityRole="button">
          <Text style={styles.removeText}>Simgeyi kaldır</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Sahipliği devretmek: üye seçilir, onaylanınca o kişi sunucunun sahibi olur */
function TransferOwnership({ guild, open, onClose }: { guild: Guild; open: boolean; onClose: () => void }) {
  const users = useGuild((s) => s.users);
  const selfId = useSession((s) => s.user?.id);
  const candidates = useMemo(
    () =>
      Object.values(users)
        .filter((u) => !u.removed && u.id !== selfId)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr')),
    [users, selfId],
  );

  const pick = async (userId: string): Promise<void> => {
    const target = users[userId];
    if (!target) return;
    onClose();
    const ok = await confirmDialog({
      title: 'Sahiplik devredilsin mi?',
      message: `${target.displayName} sunucunun sahibi olur ve herkesin üstüne geçer. Sen yalnızca rollerinin verdiği yetkilerle kalırsın; bu işlemi yalnızca yeni sahip geri alabilir.`,
      icon: 'swap-horizontal',
      confirmLabel: 'Sahipliği devret',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.updateGuild(guild.id, { ownerId: target.id });
      feedback('moderate');
      toast(`${target.displayName} artık sunucunun sahibi.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <BottomSheet visible={open} onClose={onClose}>
      <SheetHeader title="Sahipliği devret" subtitle="Yeni sahibi seç" />
      <ScrollView style={styles.sheetScroll} bounces={false}>
        {candidates.length === 0 && <Text style={[styles.muted, styles.sheetNote]}>Sunucuda başka üye yok.</Text>}
        {candidates.map((u) => (
          <Pressable
            key={u.id}
            onPress={() => void pick(u.id)}
            android_ripple={ripple.row}
            style={styles.personRow}
            accessibilityRole="button"
          >
            <Avatar user={u} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={styles.personName} numberOfLines={1}>
                {u.displayName}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                @{u.username}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = createStyles(() => ({
  pad: { padding: space.lg },
  danger: { borderWidth: 1, borderColor: 'rgba(242,63,67,0.35)' },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  iconBlock: { alignItems: 'center', gap: space.sm, paddingTop: space.sm },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.brand,
    borderWidth: 3,
    borderColor: colors.main,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { color: colors.faint, fontSize: font.caption, textAlign: 'center', marginTop: space.xs },
  removeText: { color: colors.dangerText, fontSize: font.small, fontWeight: '600' },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  ownerName: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ownerText: { color: colors.head, fontSize: font.row, fontWeight: '700', flexShrink: 1 },
  sheetScroll: { flexShrink: 1, flexGrow: 0 },
  sheetNote: { paddingHorizontal: space.lg + 2 },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg + 2,
    paddingVertical: space.sm + 2,
    borderRadius: radius.md,
  },
  personName: { color: colors.head, fontSize: font.row, fontWeight: '600' },
}));
