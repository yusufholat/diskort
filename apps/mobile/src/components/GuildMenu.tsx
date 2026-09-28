import { useRef } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { create } from 'zustand';
import { hasPermission, Permission, type Guild } from '@diskort/shared';
import {
  ackChannel,
  errorMessage,
  guildInvites,
  guildSettingsSections,
  inviteLink,
  isUnread,
  leaveGuild,
  permissionsInGuild,
  useGuild,
  useGuildUnread,
  useSession,
} from '@diskort/client-core';
import { feedback } from '../haptics';
import { toast } from '../stores/ui';
import { colors, createStyles, font, radius, space, tint, useTheme } from '../theme';
import { BottomSheet, SheetGroup, SheetItem } from './BottomSheet';
import { confirmDialog } from './Dialog';
import { PressableScale } from './PressableScale';
import { openServerSettings } from './serverSettings/common';
import { GuildIcon } from './GuildIcon';

const useGuildMenu = create<{ guildId: string | null }>(() => ({ guildId: null }));

/**
 * Sunucu menüsünü açar (sunucu başlığına dokununca, çubukta sunucuya uzun basınca). Menü GuildMenuHost ile
 * bir kez çizilir.
 */
export function openGuildMenu(guildId: string): void {
  useGuildMenu.setState({ guildId });
}

const closeGuildMenu = (): void => useGuildMenu.setState({ guildId: null });

/** Uygulamada bir kez çizilir (bkz. app/_layout.tsx) */
export function GuildMenuHost() {
  const requested = useGuildMenu((s) => s.guildId);
  // Kapanış animasyonu sürerken içerik kaybolmasın: son sunucu tutulur
  const last = useRef(requested);
  if (requested) last.current = requested;
  const guildId = requested ?? last.current;
  const exists = useGuild((s) => (guildId ? Boolean(s.guilds[guildId]) : false));
  useTheme((s) => s.version);
  return (
    <BottomSheet visible={Boolean(requested) && exists} onClose={closeGuildMenu}>
      {guildId && exists ? <GuildMenu guildId={guildId} /> : null}
    </BottomSheet>
  );
}

/**
 * Sunucu menüsü (Discord mobildeki gibi): üstte simge, ad, çevrimiçi ve üye sayısı; hızlı düğmeler (davet,
 * ayarlar); okundu işaretle, kanal oluştur; sahip değilse sunucudan ayrıl. Yalnızca yetkisi olunanlar görünür.
 */
function GuildMenu({ guildId }: { guildId: string }) {
  const guild = useGuild((s) => s.guilds[guildId]?.guild);
  const selfId = useSession((s) => s.user?.id);
  const perms = useGuild((s) => permissionsInGuild(s.guilds[guildId], selfId));
  const owner = Boolean(guild && selfId && guild.ownerId === selfId);
  const memberCount = useGuild((s) => {
    const g = s.guilds[guildId];
    let n = 0;
    if (g) for (const m of Object.values(g.members)) if (!m.removed) n += 1;
    return n;
  });
  const onlineCount = useGuild((s) => {
    const g = s.guilds[guildId];
    let n = 0;
    if (g) for (const m of Object.values(g.members)) if (!m.removed && s.online[m.userId]) n += 1;
    return n;
  });
  const unread = useGuildUnread(guildId);
  if (!guild) return null;

  const canInvite = hasPermission(perms, Permission.CREATE_INVITE) || hasPermission(perms, Permission.MANAGE_INVITES);
  const canManageChannels = hasPermission(perms, Permission.MANAGE_CHANNELS);
  const hasSettings = guildSettingsSections(perms, owner).length > 0;

  /** Menüyü kapatıp sunucuyu seçer ve ekranı açar (ayarlar seçili sunucuya göre çalışır) */
  const go = (path: '/sunucu-ayarlari' | '/sunucu-ayarlari/kanal-olustur'): void => {
    closeGuildMenu();
    openServerSettings(guildId, path);
  };

  const markRead = (): void => {
    const s = useGuild.getState();
    for (const c of s.guilds[guildId]?.channels ?? []) if (c.type === 'text' && isUnread(s, c.id)) ackChannel(c.id);
    closeGuildMenu();
    feedback('tick');
    toast(`"${guild.name}" okundu olarak işaretlendi.`);
  };

  const leave = async (): Promise<void> => {
    closeGuildMenu();
    const ok = await confirmDialog({
      title: `"${guild.name}" sunucusundan ayrılınsın mı?`,
      message: 'Bu sunucunun kanallarını artık göremezsin ve rollerin alınır. Geri dönmek için yeni bir davet gerekir.',
      icon: 'exit-outline',
      confirmLabel: 'Sunucudan ayrıl',
      danger: true,
    });
    if (ok && (await leaveGuild(guildId))) toast(`"${guild.name}" sunucusundan ayrıldın.`);
  };

  return (
    <ScrollView style={styles.scroll} bounces={false}>
      <View style={styles.header}>
        <GuildIcon guild={guild} size={64} radius={22} />
        <Text style={styles.name} numberOfLines={2}>
          {guild.name}
        </Text>
        <View style={styles.counts}>
          <View style={[styles.dot, { backgroundColor: colors.ok }]} />
          <Text style={styles.count}>{onlineCount} çevrimiçi</Text>
          <View style={[styles.dot, { backgroundColor: colors.muted }]} />
          <Text style={styles.count}>{memberCount} üye</Text>
        </View>
        {owner && (
          <View style={styles.ownerChip}>
            <MaterialCommunityIcons name="crown-outline" size={14} color={colors.warn} />
            <Text style={styles.ownerText}>Bu sunucunun sahibisin</Text>
          </View>
        )}
      </View>

      {(canInvite || hasSettings) && (
        <View style={styles.quick}>
          {canInvite && (
            <QuickAction icon="person-add" label="Davet et" onPress={() => void shareInvite(guild, closeGuildMenu)} />
          )}
          {hasSettings && <QuickAction icon="settings-sharp" label="Ayarlar" onPress={() => go('/sunucu-ayarlari')} />}
        </View>
      )}

      <SheetGroup>
        {unread && <SheetItem key="read" icon="checkmark-done" label="Okundu olarak işaretle" onPress={markRead} />}
        {canManageChannels && (
          <SheetItem
            key="channel"
            icon="add-circle-outline"
            label="Kanal oluştur"
            onPress={() => go('/sunucu-ayarlari/kanal-olustur')}
          />
        )}
        {canInvite && (
          <SheetItem
            key="invite"
            icon="link-outline"
            label="Arkadaşlarını davet et"
            hint="7 gün geçerli bir davet bağlantısı paylaşılır"
            onPress={() => void shareInvite(guild, closeGuildMenu)}
          />
        )}
        {hasSettings && (
          <SheetItem key="settings" icon="settings-outline" label="Sunucu ayarları" onPress={() => go('/sunucu-ayarlari')} />
        )}
      </SheetGroup>

      {!owner && (
        <SheetGroup>
          <SheetItem icon="exit-outline" label="Sunucudan ayrıl" danger onPress={() => void leave()} />
        </SheetGroup>
      )}
    </ScrollView>
  );
}

/** Başlığın altındaki yuvarlak hızlı düğme (Discord mobildeki gibi simge ve altında ad) */
function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <PressableScale
      scaleTo={0.9}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.quickItem}
    >
      <View style={styles.quickIcon}>
        <Ionicons name={icon} size={22} color={colors.head} />
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
    </PressableScale>
  );
}

/** 7 gün geçerli, sınırsız bir davet oluşturup paylaşma penceresini açar */
export async function shareInvite(guild: Pick<Guild, 'id' | 'name'>, before?: () => void): Promise<void> {
  before?.();
  try {
    const invite = await guildInvites.create(guild.id, { maxUses: null, expiresInHours: 168 });
    const link = inviteLink(invite.code);
    await Share.share({ message: `Diskort'ta "${guild.name}" sunucusuna gel: ${link}` });
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}


const styles = createStyles(() => ({
  // Uzun menü sayfanın sınırlı yüksekliğine sığsın diye daralabilir
  scroll: { flexShrink: 1, flexGrow: 0 },
  header: { alignItems: 'center', paddingHorizontal: space.xl, paddingBottom: space.lg },
  name: { color: colors.head, fontSize: font.heading + 2, fontWeight: '800', textAlign: 'center', marginTop: space.md },
  counts: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.xs + 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  count: { color: colors.muted, fontSize: font.small, marginRight: space.sm },
  ownerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: space.sm + 2,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.warnSoft,
  },
  ownerText: { color: colors.warn, fontSize: font.caption, fontWeight: '700' },
  quick: { flexDirection: 'row', justifyContent: 'center', gap: space.xxl, paddingBottom: space.lg },
  quickItem: { alignItems: 'center', gap: 6, minWidth: 72 },
  quickIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: tint(0.08),
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: { color: colors.text, fontSize: font.caption + 0.5, fontWeight: '600' },
}));
