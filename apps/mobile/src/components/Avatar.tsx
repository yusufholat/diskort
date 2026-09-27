import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { User } from '@diskort/shared';
import { avatarUrl } from '@diskort/client-core';
import { colors } from '../theme';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toLocaleUpperCase('tr');
  return (parts[0]![0]! + parts[1]![0]!).toLocaleUpperCase('tr');
}

interface Props {
  user: Pick<User, 'displayName' | 'avatarColor' | 'avatarUrl'> | undefined;
  size?: number;
  speaking?: boolean;
  online?: boolean;
  /** Çevrimiçi noktasının çevresindeki halka: avatarın durduğu yüzeyin rengi */
  surface?: string;
}

export function Avatar({ user, size = 40, speaking, online, surface = colors.side }: Props) {
  const ring = speaking ? 3 : 0;
  const src = avatarUrl(user);
  // Yüklenemeyen fotoğrafın yerine baş harfler (adres değişince yeniden denenir)
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: user?.avatarColor ?? '#747f8d',
            borderWidth: ring,
            borderColor: colors.ok,
          },
        ]}
      >
        {src && failed !== src ? (
          <Image
            source={{ uri: src }}
            style={[styles.photo, { borderRadius: size / 2 }]}
            onError={() => setFailed(src)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={[styles.text, { fontSize: Math.max(10, size * 0.38) }]}>{initials(user?.displayName ?? '?')}</Text>
        )}
      </View>
      {online !== undefined && (
        <View
          style={[
            styles.dot,
            {
              width: size * 0.36,
              height: size * 0.36,
              borderRadius: size,
              backgroundColor: online ? colors.ok : colors.faint,
              borderColor: surface,
              borderWidth: size >= 32 ? 3 : 2,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  text: { color: '#fff', fontWeight: '600' },
  dot: { position: 'absolute', right: -1, bottom: -1 },
});
