import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Permission, type Guild, type Invite } from '@diskort/shared';
import { errorMessage, guildInvites, inviteLink, useCan, useGuild } from '@diskort/client-core';
import { animateNextLayout } from '../../motion';
import { toast } from '../../stores/ui';
import { colors, createStyles, font, space, tint } from '../../theme';
import { confirmDialog } from '../Dialog';
import { Button, Card, Choices, SectionTitle } from '../ui';
import { Intro } from './common';

const USES = [
  { value: 1, label: '1 kişi' },
  { value: 5, label: '5 kişi' },
  { value: 10, label: '10 kişi' },
  { value: 25, label: '25 kişi' },
  { value: 0, label: 'Sınırsız' },
] as const;

const EXPIRES = [
  { value: 1, label: '1 saat' },
  { value: 24, label: '1 gün' },
  { value: 168, label: '7 gün' },
  { value: 0, label: 'Süresiz' },
] as const;

/** Davet bağlantısını panoya kopyalar */
async function copyInvite(code: string, asLink = true): Promise<void> {
  await Clipboard.setStringAsync(asLink ? inviteLink(code) : code).catch(() => undefined);
  toast(asLink ? 'Davet bağlantısı kopyalandı.' : 'Davet kodu kopyalandı.');
}

/**
 * Davetler (masaüstündeki gibi): oluşturma (kullanım hakkı, geçerlilik), liste; paylaş, kopyala, sil. Davet
 * Oluştur yetkisi olan kendi davetlerini, Davetleri Yönet yetkisi olan hepsini görür.
 */
export function InvitesSection({ guild }: { guild: Guild }) {
  const canManage = useCan(Permission.MANAGE_INVITES);
  const canCreate = useCan(Permission.CREATE_INVITE);
  const users = useGuild((s) => s.users);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [maxUses, setMaxUses] = useState<number>(0);
  const [expires, setExpires] = useState<number>(168);
  const [busy, setBusy] = useState(false);

  const load = useCallback((): void => {
    guildInvites
      .list(guild.id)
      .then((list) => {
        animateNextLayout(180);
        setInvites(list.sort((a, b) => b.createdAt - a.createdAt));
      })
      .catch((err) => toast(errorMessage(err), 'error'));
  }, [guild.id]);
  useEffect(load, [load]);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const body = { maxUses: maxUses === 0 ? null : maxUses, expiresInHours: expires === 0 ? null : expires };
      const invite = await guildInvites.create(guild.id, body);
      await copyInvite(invite.code);
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (inv: Invite): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Davet silinsin mi?',
      message: `${inv.code} davetiyle artık katılınamaz ve kayıt olunamaz.`,
      icon: 'trash-outline',
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    guildInvites
      .remove(guild.id, inv.code)
      .then(load)
      .catch((err) => toast(errorMessage(err), 'error'));
  };

  const share = (code: string): void => {
    void Share.share({ message: `Diskort'ta "${guild.name}" sunucusuna gel: ${inviteLink(code)}` }).catch(() => undefined);
  };

  return (
    <View>
      <Intro>
        Davet bağlantısını arkadaşına gönder. Diskort'u kurduysa bağlantıya dokununca sunucuya katılır; hesabı yoksa
        giriş ekranında Davet koduyla kaydol seçeneğiyle hesap açar. Sunucudan ayrılan ya da atılan biri de yeni bir
        davetle geri dönebilir.
      </Intro>
      {canCreate || canManage ? (
        <Card style={styles.pad}>
          <Text style={styles.label}>Kullanım hakkı</Text>
          <Choices options={USES} value={maxUses} onChange={setMaxUses} label="Kullanım hakkı" />
          <Text style={[styles.label, { marginTop: space.md }]}>Geçerlilik</Text>
          <Choices options={EXPIRES} value={expires} onChange={setExpires} label="Geçerlilik" />
          <View style={{ marginTop: space.lg }}>
            <Button title="Davet oluştur" busy={busy} onPress={() => void create()} />
          </View>
        </Card>
      ) : null}

      <SectionTitle>{canManage ? 'Aktif davetler' : 'Oluşturduğun davetler'}</SectionTitle>
      <Card>
        {invites === null ? (
          <ActivityIndicator color={colors.muted} style={{ padding: space.lg }} />
        ) : invites.length === 0 ? (
          <Text style={styles.empty}>Henüz davet yok.</Text>
        ) : (
          invites.map((inv, i) => {
            const expired = inv.expiresAt !== null && inv.expiresAt < Date.now();
            const used = inv.maxUses !== null && inv.uses >= inv.maxUses;
            const creator = users[inv.createdBy]?.displayName;
            return (
              <View key={inv.code}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.code, (expired || used) && styles.dead]} selectable>
                      {inv.code}
                    </Text>
                    <Text style={styles.meta}>
                      {inv.uses}/{inv.maxUses ?? '∞'} kullanım ·{' '}
                      {inv.expiresAt ? `${new Date(inv.expiresAt).toLocaleString('tr-TR')} tarihine kadar` : 'süresiz'}
                      {canManage && creator ? ` · ${creator}` : ''}
                    </Text>
                  </View>
                  <IconButton icon="share-social-outline" label="Paylaş" onPress={() => share(inv.code)} />
                  <IconButton icon="copy-outline" label="Bağlantıyı kopyala" onPress={() => void copyInvite(inv.code)} />
                  <IconButton icon="trash-outline" label="Daveti sil" danger onPress={() => void remove(inv)} />
                </View>
              </View>
            );
          })
        )}
      </Card>
    </View>
  );
}

function IconButton({
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
    <Pressable
      onPress={onPress}
      hitSlop={4}
      android_ripple={{ color: tint(0.14), borderless: true, radius: 18 }}
      style={styles.iconButton}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={19} color={danger ? colors.danger : colors.muted} />
    </Pressable>
  );
}

const styles = createStyles(() => ({
  pad: { padding: space.lg },
  label: { color: colors.muted, fontSize: font.caption, fontWeight: '700', textTransform: 'uppercase' },
  empty: { color: colors.muted, fontSize: font.small, padding: space.lg },
  divider: { height: 0.5, backgroundColor: colors.line, marginLeft: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm + 2 },
  code: { color: colors.head, fontSize: font.row, fontFamily: 'monospace', fontWeight: '600' },
  dead: { textDecorationLine: 'line-through', opacity: 0.5 },
  meta: { color: colors.muted, fontSize: font.caption, marginTop: 2, lineHeight: 16 },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
}));
