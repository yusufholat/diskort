import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { hasPermission, Permission, type Channel, type ChannelType, type Guild } from '@diskort/shared';
import { reorderChannels, reorderedIds, useCan, useGuild } from '@diskort/client-core';
import { animateNextLayout } from '../../motion';
import { colors, createStyles, font, ripple, space, tint } from '../../theme';
import { Button, Card, SectionTitle } from '../ui';
import { Intro } from './common';

/** Kanal @everyone'dan gizlenmiş mi (kilit simgesi) */
const isPrivate = (channel: Channel, guildId: string): boolean => {
  const everyone = channel.overwrites?.find((o) => o.roleId === guildId);
  return everyone !== undefined && hasPermission(everyone.deny, Permission.VIEW_CHANNEL);
};

/**
 * Kanallar: türüne göre liste, oklarla sıralama (masaüstünde sürükle-bırak), dokununca düzenleme (ad,
 * izinler, silme) ve kanal oluşturma.
 */
export function ChannelsSection({ guild }: { guild: Guild }) {
  const channels = useGuild((s) => s.channels);
  const canManage = useCan(Permission.MANAGE_CHANNELS);

  /** Kanalı aynı türdeki komşusunun önüne/arkasına taşır (sunucu tüm kanalların sırasını ister) */
  const move = (channel: Channel, direction: -1 | 1): void => {
    const same = channels.filter((c) => c.type === channel.type);
    const neighbor = same[same.indexOf(channel) + direction];
    if (!neighbor) return;
    animateNextLayout(180);
    void reorderChannels(
      guild.id,
      reorderedIds(
        channels.map((c) => c.id),
        channel.id,
        neighbor.id,
        direction === 1,
      ),
    );
  };

  const create = (type: ChannelType): void => {
    router.push({ pathname: '/sunucu-ayarlari/kanal-olustur', params: { type } });
  };

  const group = (type: ChannelType, title: string) => {
    const list = channels.filter((c) => c.type === type);
    return (
      <View key={type}>
        <SectionTitle>{`${title} — ${list.length}`}</SectionTitle>
        <Card>
          {list.length === 0 && <Text style={styles.empty}>Bu türde kanal yok.</Text>}
          {list.map((c, i) => (
            <ChannelRow
              key={c.id}
              channel={c}
              first={i === 0}
              locked={isPrivate(c, guild.id)}
              canMoveUp={canManage && i > 0}
              canMoveDown={canManage && i < list.length - 1}
              onMove={move}
            />
          ))}
        </Card>
      </View>
    );
  };

  return (
    <View>
      <Intro>
        Kanala dokunarak adını, izinlerini değiştirebilir ya da silebilirsin. Oklarla sırasını değiştir; sıra herkeste
        aynı görünür. Kilitli kanalları yalnızca izin verilen roller görür.
      </Intro>
      {canManage && (
        <View style={styles.createRow}>
          <View style={{ flex: 1 }}>
            <Button title="Metin kanalı oluştur" onPress={() => create('text')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Ses kanalı oluştur" variant="secondary" onPress={() => create('voice')} />
          </View>
        </View>
      )}
      {group('text', 'Metin kanalları')}
      {group('voice', 'Ses kanalları')}
    </View>
  );
}

function ChannelRow({
  channel,
  first,
  locked,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  channel: Channel;
  first: boolean;
  locked: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (channel: Channel, direction: -1 | 1) => void;
}) {
  return (
    <View>
      {!first && <View style={styles.divider} />}
      <Pressable
        onPress={() => router.push({ pathname: '/sunucu-ayarlari/kanal/[id]', params: { id: channel.id } })}
        android_ripple={ripple.row}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`${channel.name}${locked ? ', özel kanal' : ''}, düzenle`}
      >
        <View style={styles.icon}>
          {channel.type === 'text' ? (
            <Feather name="hash" size={20} color={colors.muted} />
          ) : (
            <Ionicons name="volume-medium" size={20} color={colors.muted} />
          )}
          {locked && (
            <View style={styles.lock}>
              <Ionicons name="lock-closed" size={9} color={colors.muted} />
            </View>
          )}
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {channel.name}
        </Text>
        {(canMoveUp || canMoveDown) && (
          <View style={styles.arrows}>
            <ArrowButton icon="chevron-up" label="Yukarı taşı" disabled={!canMoveUp} onPress={() => onMove(channel, -1)} />
            <ArrowButton icon="chevron-down" label="Aşağı taşı" disabled={!canMoveDown} onPress={() => onMove(channel, 1)} />
          </View>
        )}
        <Ionicons name="chevron-forward" size={18} color={colors.faint} />
      </Pressable>
    </View>
  );
}

/** Sıralama oku: devre dışıyken görünmez ama yerini korur (satırlar hizalı kalsın) */
export function ArrowButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'chevron-up' | 'chevron-down';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      android_ripple={{ color: tint(0.14), borderless: true, radius: 18 }}
      style={[styles.arrow, disabled && { opacity: 0 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityElementsHidden={disabled}
      importantForAccessibility={disabled ? 'no-hide-descendants' : 'auto'}
    >
      <Ionicons name={icon} size={20} color={colors.muted} />
    </Pressable>
  );
}

const styles = createStyles(() => ({
  createRow: { flexDirection: 'row', gap: space.sm + 2 },
  empty: { color: colors.muted, fontSize: font.small, padding: space.lg },
  divider: { height: 0.5, backgroundColor: colors.line, marginLeft: 52 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingLeft: space.lg, paddingRight: space.md },
  icon: { width: 24, alignItems: 'center' },
  lock: { position: 'absolute', top: -3, right: -3, backgroundColor: colors.side, borderRadius: 4, padding: 1 },
  name: { flex: 1, color: colors.head, fontSize: font.row, fontWeight: '500' },
  arrows: { flexDirection: 'row' },
  arrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
}));
