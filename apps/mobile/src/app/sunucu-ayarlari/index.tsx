import { Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { guildSettingsSections, isOwner, useGuild, usePermissions, useSession, type GuildSettingsSection } from '@diskort/client-core';
import { GuildIcon } from '../../components/GuildIcon';
import { shareInvite } from '../../components/GuildMenu';
import { NoAccess, SECTION_INFO, SettingsPage, useSettingsGuild } from '../../components/serverSettings/common';
import { Card, NavRow, SectionTitle } from '../../components/ui';
import { colors, createStyles, font, space } from '../../theme';

/** Sunucu ayarları: sunucunun başlığı ve yetkiye göre bölümler (sunucu menüsünden açılır) */
export default function ServerSettingsScreen() {
  const guild = useSettingsGuild();
  const router = useRouter();
  const perms = usePermissions();
  const selfId = useSession((s) => s.user?.id);
  const owner = useGuild((s) => isOwner(s, selfId));
  const memberCount = useGuild((s) => {
    let n = 0;
    for (const u of Object.values(s.users)) if (!u.removed) n += 1;
    return n;
  });
  const channelCount = useGuild((s) => s.channels.length);
  const roleCount = useGuild((s) => Object.keys(s.roles).length);
  if (!guild) return null;
  const sections = guildSettingsSections(perms, owner);

  const values: Partial<Record<GuildSettingsSection, string>> = {
    members: String(memberCount),
    channels: String(channelCount),
    roles: String(roleCount),
  };

  return (
    <SettingsPage>
      <Stack.Screen options={{ title: 'Sunucu ayarları' }} />
      <View style={styles.hero}>
        <GuildIcon guild={guild} size={72} radius={24} />
        <Text style={styles.name} numberOfLines={2}>
          {guild.name}
        </Text>
        <Text style={styles.sub}>{memberCount} üye</Text>
      </View>
      {sections.length === 0 ? (
        <NoAccess text="Bu sunucuda yönetebileceğin bir ayar yok." />
      ) : (
        <>
          <SectionTitle>Ayarlar</SectionTitle>
          <Card>
            {sections.map((id, i) => {
              const info = SECTION_INFO[id];
              return (
                <NavRow
                  key={id}
                  first={i === 0}
                  icon={info.icon}
                  iconColor={info.color}
                  label={info.label}
                  detail={info.detail}
                  value={values[id]}
                  onPress={() => router.push({ pathname: '/sunucu-ayarlari/[bolum]', params: { bolum: id } })}
                />
              );
            })}
          </Card>
          {sections.includes('invites') && (
            <>
              <SectionTitle>Hızlı</SectionTitle>
              <Card>
                <NavRow
                  first
                  icon="share-social"
                  iconColor={colors.ok}
                  label="Arkadaşlarını davet et"
                  detail="7 gün geçerli bir davet bağlantısı paylaş"
                  onPress={() => void shareInvite(guild)}
                />
              </Card>
            </>
          )}
        </>
      )}
    </SettingsPage>
  );
}

const styles = createStyles(() => ({
  hero: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.xs },
  name: { color: colors.head, fontSize: font.heading + 2, fontWeight: '800', textAlign: 'center', marginTop: space.md },
  sub: { color: colors.muted, fontSize: font.small, marginTop: 2 },
}));
