import { memo, useState, type ReactNode } from 'react';
import { Alert, Image, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { Permission, type DmChannel, type Guild } from '@diskort/shared';
import {
  dmTitle,
  errorMessage,
  guildIconUrl,
  guildInitials,
  guildInvites,
  inviteLink,
  isGuildOwner,
  leaveGuild,
  permissionsInGuild,
  useGuild,
  useGuildList,
  useGuildUnread,
  useMessages,
  useDmUnreadCount,
  useDmUnreadTotal,
  useSession,
  useUnreadDms,
} from '@diskort/client-core';
import { feedback } from '../haptics';
import { openChat, selectGuildInPanel, selectHome, useNav } from '../stores/nav';
import { toast } from '../stores/ui';
import { colors, createStyles, space } from '../theme';
import { CountBadge } from './Badge';
import { DmAvatar } from './DmAvatar';
import { PressableScale } from './PressableScale';

/** Sunucu simgesi: yüklenmiş resim ya da adın baş harfleri */
export function GuildIcon({ guild, size = 44, radius = 14 }: { guild: Pick<Guild, 'name' | 'iconUrl'> | undefined; size?: number; radius?: number }) {
  const src = guildIconUrl(guild);
  const [failed, setFailed] = useState<string | null>(null);
  const text = guildInitials(guild?.name ?? '');
  return (
    <View style={[styles.icon, { width: size, height: size, borderRadius: radius }]}>
      {src && failed !== src ? (
        <Image source={{ uri: src }} style={{ width: size, height: size }} onError={() => setFailed(src)} />
      ) : (
        <Text style={[styles.iconText, { fontSize: size * (text.length > 2 ? 0.28 : 0.36) }]}>{text}</Text>
      )}
    </View>
  );
}

/** Çubuğun genişliği (sol panelde kanal sütununun solunda) */
export const RAIL_WIDTH = 72;
const ICON = 48;

/**
 * Sol paneldeki dikey sunucu çubuğu (Discord mobil gibi): en üstte direkt mesajlar (ana sayfa) düğmesi
 * okunmamış sayısıyla ve okunmamış konuşmalar, altında sunucular okunmamış işareti ve bahsetme
 * sayısıyla, en altta "+" ile sunucu kur / davetle katıl. Seçili öğenin solunda uzun beyaz çizgi,
 * okunmamışın solunda kısa nokta. Sunucuya uzun basınca sunucu menüsü (davet, ayrıl).
 */
export function ServerRail() {
  const guilds = useGuildList();
  const home = useNav((s) => s.home);
  const unreadDms = useUnreadDms(3);
  const router = useRouter();
  return (
    <ScrollView
      style={styles.rail}
      contentContainerStyle={styles.railContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <HomeButton selected={home} />
      {unreadDms.map((dm) => (
        <UnreadDm key={dm.id} dm={dm} />
      ))}
      <View style={styles.separator} />
      {guilds.map((g) => (
        <GuildButton key={g.id} guild={g} home={home} />
      ))}
      <Pressable
        onPress={() => router.push('/sunucu-ekle')}
        style={({ pressed }) => [styles.add, pressed && { backgroundColor: colors.ok }]}
        accessibilityRole="button"
        accessibilityLabel="Sunucu ekle"
      >
        {({ pressed }) => <Ionicons name="add" size={26} color={pressed ? colors.white : colors.ok} />}
      </Pressable>
    </ScrollView>
  );
}

/** Ana sayfa düğmesinin altında okunmamış konuşma: dokununca açılır */
const UnreadDm = memo(function UnreadDm({ dm }: { dm: DmChannel }) {
  const count = useDmUnreadCount(dm.id);
  const selfId = useSession((s) => s.user?.id);
  const title = useGuild((s) => dmTitle(dm, s.users, selfId));
  return (
    <RailItem label={`${title}, ${count} okunmamış mesaj`} onPress={() => openChat(dm.id)}>
      <DmAvatar dm={dm} size={ICON} />
      <View style={styles.badge}>
        <CountBadge count={count} ring={colors.rail} />
      </View>
    </RailItem>
  );
});

/** Çubuktaki bir öğe: solunda seçim/okunmamış çizgisi */
function RailItem({
  children,
  label,
  selected = false,
  unread = false,
  onPress,
  onLongPress,
  hint,
}: {
  children: ReactNode;
  label: string;
  selected?: boolean;
  unread?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  hint?: string;
}) {
  return (
    <View style={styles.item}>
      {(selected || unread) && <View style={[styles.pill, selected ? styles.pillSelected : styles.pillUnread]} />}
      <PressableScale
        scaleTo={0.92}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={300}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
        accessibilityHint={hint}
      >
        {children}
      </PressableScale>
    </View>
  );
}

/** Direkt mesajlar (ana sayfa) düğmesi: tüm konuşmalardaki okunmamış mesaj sayısıyla */
function HomeButton({ selected }: { selected: boolean }) {
  const unread = useDmUnreadTotal();
  return (
    <RailItem
      selected={selected}
      label={unread > 0 ? `Direkt mesajlar, ${unread} okunmamış` : 'Direkt mesajlar'}
      onPress={() => {
        if (!selected) feedback('tick');
        selectHome();
      }}
    >
      <View style={[styles.home, { borderRadius: selected ? 16 : ICON / 2 }, selected && { backgroundColor: colors.brand }]}>
        <Ionicons name="chatbubbles" size={24} color={selected ? colors.white : colors.text} />
      </View>
      <View style={styles.badge}>
        <CountBadge count={unread} ring={colors.rail} />
      </View>
    </RailItem>
  );
}

const GuildButton = memo(function GuildButton({ guild, home }: { guild: Guild; home: boolean }) {
  const selected = useGuild((s) => s.activeGuildId === guild.id) && !home;
  const unread = useGuildUnread(guild.id);
  const channelIds = useGuild(useShallow((s) => s.guilds[guild.id]?.channels.map((c) => c.id) ?? []));
  const mentions = useMessages((s) => channelIds.reduce((n, id) => n + (s.mentionCounts[id] ?? 0), 0));
  return (
    <RailItem
      selected={selected}
      unread={unread}
      onPress={() => {
        if (!selected) feedback('tick');
        selectGuildInPanel(guild.id);
      }}
      onLongPress={() => {
        feedback('tick');
        openGuildMenu(guild);
      }}
      label={`${guild.name}${unread ? ', okunmamış mesajlar var' : ''}${mentions ? `, ${mentions} bahsetme` : ''}`}
      hint="Sunucu menüsü için uzun bas"
    >
      <GuildIcon guild={guild} size={ICON} radius={selected ? 16 : ICON / 2} />
      <View style={styles.badge}>
        <CountBadge count={mentions} ring={colors.rail} />
      </View>
    </RailItem>
  );
});

/** Sunucu menüsü: davet bağlantısını paylaş, sunucudan ayrıl */
export function openGuildMenu(guild: Guild): void {
  const s = useGuild.getState();
  const selfId = useSession.getState().user?.id;
  const perms = permissionsInGuild(s.guilds[guild.id], selfId);
  const canInvite =
    (perms & Permission.CREATE_INVITE) === Permission.CREATE_INVITE ||
    (perms & Permission.MANAGE_INVITES) === Permission.MANAGE_INVITES;
  const owner = isGuildOwner(s, guild.id);
  Alert.alert(guild.name, owner ? 'Bu sunucunun sahibisin.' : undefined, [
    ...(canInvite ? [{ text: 'Arkadaşlarını davet et', onPress: () => void shareInvite(guild) }] : []),
    ...(!owner
      ? [
          {
            text: 'Sunucudan ayrıl',
            style: 'destructive' as const,
            onPress: () =>
              Alert.alert(`"${guild.name}" sunucusundan ayrılınsın mı?`, 'Geri dönmek için yeni bir davet gerekir.', [
                { text: 'Vazgeç', style: 'cancel' },
                {
                  text: 'Ayrıl',
                  style: 'destructive',
                  onPress: () => void leaveGuild(guild.id).then((ok) => ok && toast(`"${guild.name}" sunucusundan ayrıldın.`)),
                },
              ]),
          },
        ]
      : []),
    { text: 'Kapat', style: 'cancel' },
  ]);
}

/** 7 gün geçerli, sınırsız bir davet oluşturup paylaşma penceresini açar */
async function shareInvite(guild: Guild): Promise<void> {
  try {
    const invite = await guildInvites.create(guild.id, { maxUses: null, expiresInHours: 168 });
    const link = inviteLink(invite.code);
    await Share.share({ message: `Diskort'ta "${guild.name}" sunucusuna gel: ${link}` });
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

const styles = createStyles(() => ({
  rail: { width: RAIL_WIDTH, flexGrow: 0, backgroundColor: colors.rail },
  railContent: { alignItems: 'center', gap: space.sm, paddingTop: space.sm, paddingBottom: space.lg },
  item: { width: RAIL_WIDTH, alignItems: 'center' },
  pill: {
    position: 'absolute',
    left: 0,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: colors.head,
  },
  pillSelected: { top: 4, bottom: 4 },
  pillUnread: { top: ICON / 2 - 4, height: 8 },
  home: { width: ICON, height: ICON, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  separator: { width: 32, height: 2, borderRadius: 1, backgroundColor: colors.line },
  icon: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  iconText: { color: colors.white, fontWeight: '800' },
  badge: { position: 'absolute', right: -4, bottom: -4 },
  add: {
    width: ICON,
    height: ICON,
    borderRadius: ICON / 2,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
