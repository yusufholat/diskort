import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import type { Guild } from '@diskort/shared';
import { guildIconUrl, guildInitials } from '@diskort/client-core';
import { colors, createStyles } from '../theme';

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

const styles = createStyles(() => ({
  icon: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  iconText: { color: colors.white, fontWeight: '800' },
}));
