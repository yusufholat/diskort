import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { animatedDecorationSet, AVATAR_DECORATION_SCALE, type User } from '@diskort/shared';
import { avatarUrl, useCosmeticUrl, useStatus, type DisplayStatus } from '@diskort/client-core';
import { colors, createStyles } from '../theme';
import { AnimatedDecoration } from './cosmetics/Cosmetics';
import { StatusDot } from './StatusDot';

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
  /** Eski biçim: çevrimiçi / çevrimdışı. `status` verilirse o kullanılır */
  online?: boolean;
  /** Durum noktası (Discord biçimli: ay, eksi, halka) */
  status?: DisplayStatus;
  /** Çevrimiçi noktasının çevresindeki halka: avatarın durduğu yüzeyin rengi */
  surface?: string;
  /** Avatar dekorasyonunun kimliği (user.avatarDecoration): avatarın üstüne, yerleşimi değiştirmeden çizilir */
  decoration?: string | null;
  /** Hareketli dekorasyon küçük avatarda da canlı çizilsin (ayarlardaki seçici) */
  animateDecoration?: boolean;
  /** Hareketli dekorasyonun hafif modu (sesli sahne): 'paused' ise son kare sabit kalır */
  decorationLite?: 'on' | 'paused';
}

export function Avatar({
  user,
  size = 40,
  speaking,
  online,
  status,
  surface = colors.side,
  decoration,
  animateDecoration,
  decorationLite,
}: Props) {
  const shown: DisplayStatus | undefined = status ?? (online === undefined ? undefined : online ? 'online' : 'offline');
  const border = size >= 32 ? 3 : 2;
  const dot = Math.round(size * 0.36) - 2 * border;
  const ring = speaking ? 3 : 0;
  const src = avatarUrl(user);
  // Yüklenemeyen fotoğrafın yerine baş harfler (adres değişince yeniden denenir)
  const [failed, setFailed] = useState<string | null>(null);
  // Hareketli dekorasyon (anim:<set>) kodla çizilir; diğerleri sunucunun kataloğundaki resim
  const animated = animatedDecorationSet(decoration);
  const decorationSrc = useCosmeticUrl('decorations', animated ? null : decoration);
  const over = (size * (AVATAR_DECORATION_SCALE - 1)) / 2;
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
      {animated ? (
        <AnimatedDecoration set={animated} size={size} animate={animateDecoration} lite={decorationLite} />
      ) : decorationSrc ? (
        <Image
          source={{ uri: decorationSrc }}
          style={{ position: 'absolute', left: -over, top: -over, width: size + 2 * over, height: size + 2 * over }}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {shown !== undefined && (
        <View style={[styles.dot, { padding: border, borderRadius: size, backgroundColor: surface }]}>
          <StatusDot status={shown} size={dot} surface={surface} />
        </View>
      )}
    </View>
  );
}

const styles = createStyles(() => ({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  text: { color: '#fff', fontWeight: '600' },
  dot: { position: 'absolute', right: -1, bottom: -1 },
}));

/** Kişinin güncel durum noktasıyla avatar (kendin için görünmezlik de görünür) */
export function PresenceAvatar({ userId, ...props }: Omit<Props, 'status' | 'online'> & { userId: string }) {
  const status = useStatus(userId);
  return <Avatar {...props} status={status} />;
}
