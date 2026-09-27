import { memo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { Permission, type Guild } from '@diskort/shared';
import {
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
  useSession,
} from '@diskort/client-core';
import { toast } from '../stores/ui';
import { colors, space } from '../theme';

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

/**
 * Kanal listesinin üstündeki sunucu şeridi (masaüstündeki sol çubuk gibi): sunucular, okunmamış işareti ve
 * bahsetme sayısıyla; "+" ile sunucu kurulur ya da davetle katılınır. Uzun basınca sunucu menüsü (davet
 * bağlantısı paylaş, sunucudan ayrıl).
 */
export function GuildSwitcher() {
  const guilds = useGuildList();
  const router = useRouter();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      style={styles.stripWrap}
      keyboardShouldPersistTaps="handled"
    >
      {guilds.map((g) => (
        <GuildButton key={g.id} guild={g} />
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

const GuildButton = memo(function GuildButton({ guild }: { guild: Guild }) {
  const selected = useGuild((s) => s.activeGuildId === guild.id);
  const unread = useGuildUnread(guild.id);
  const channelIds = useGuild(useShallow((s) => s.guilds[guild.id]?.channels.map((c) => c.id) ?? []));
  const mentions = useMessages((s) => channelIds.reduce((n, id) => n + (s.mentionCounts[id] ?? 0), 0));
  return (
    <Pressable
      onPress={() => useGuild.getState().selectGuild(guild.id)}
      onLongPress={() => openGuildMenu(guild)}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${guild.name}${unread ? ', okunmamış mesajlar var' : ''}${mentions ? `, ${mentions} bahsetme` : ''}`}
      accessibilityHint="Sunucu menüsü için uzun bas"
      style={styles.guild}
    >
      <View style={[styles.ring, selected && styles.ringSelected]}>
        <GuildIcon guild={guild} size={44} radius={selected ? 14 : 22} />
      </View>
      {unread && !selected && <View style={styles.dot} />}
      {mentions > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{mentions > 99 ? '99+' : mentions}</Text>
        </View>
      )}
    </Pressable>
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

const styles = StyleSheet.create({
  stripWrap: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.45)' },
  strip: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  guild: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },
  ring: { padding: 2, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  ringSelected: { borderColor: colors.brand },
  icon: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  iconText: { color: colors.white, fontWeight: '800' },
  dot: { position: 'absolute', bottom: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.head },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: colors.danger,
    borderWidth: 3,
    borderColor: colors.side,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontSize: 10.5, fontWeight: '800' },
  add: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.main,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
