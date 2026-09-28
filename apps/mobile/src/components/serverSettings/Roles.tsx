import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MAX_ROLES, Permission, sortRoles, type Guild, type Role } from '@diskort/shared';
import { api, canManageRole, errorMessage, useCan, useGuild, useSession } from '@diskort/client-core';
import { animateNextLayout } from '../../motion';
import { toast } from '../../stores/ui';
import { colors, createStyles, font, ripple, space } from '../../theme';
import { Button, Card, SectionTitle } from '../ui';
import { ArrowButton } from './Channels';
import { Intro, RoleDot } from './common';

/** Roller: oluşturma, sıralama (oklarla), dokununca düzenleme (görünüm, yetkiler, üyeler) */
export function RolesSection({ guild }: { guild: Guild }) {
  const rolesById = useGuild((s) => s.roles);
  const users = useGuild((s) => s.users);
  const selfId = useSession((s) => s.user?.id);
  const canCreate = useCan(Permission.MANAGE_ROLES);
  const roles = useMemo(() => sortRoles(Object.values(rolesById)), [rolesById]);
  const members = useMemo(() => Object.values(users).filter((u) => !u.removed), [users]);
  const [busy, setBusy] = useState(false);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const role = await api.createRole(guild.id, { name: 'yeni rol' });
      // Gateway olayını beklemeden listeye koy (düzenleme ekranı rolü hemen bulsun; olay gelince tekrar zararsız)
      const current = useGuild.getState().guilds[guild.id]?.roles ?? {};
      useGuild.getState().apply({
        t: 'ROLES_UPDATE',
        d: { guildId: guild.id, roles: [...Object.values(current).filter((r) => r.id !== role.id), role] },
      });
      router.push({ pathname: '/sunucu-ayarlari/rol/[id]', params: { id: role.id } });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const others = roles.filter((r) => r.id !== guild.id);

  /** Rolü bir sıra yukarı/aşağı taşır (yalnızca kendi en üst rolünün altındakiler arasında) */
  const move = async (role: Role, direction: -1 | 1): Promise<void> => {
    const order = others.map((r) => r.id);
    const i = order.indexOf(role.id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    animateNextLayout(180);
    try {
      await api.reorderRoles(guild.id, order);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const movable = (role: Role, direction: -1 | 1): boolean => {
    const s = useGuild.getState();
    const neighbor = others[others.indexOf(role) + direction];
    return Boolean(neighbor) && canManageRole(s, selfId, role) && canManageRole(s, selfId, neighbor!);
  };

  return (
    <View>
      <Intro>
        Üyeleri rollerle gruplayıp yetki ver. Üstteki rol alttakileri yönetebilir; kimse kendi en üst rolünden
        yukarıdakileri düzenleyemez. Üyenin adının rengi, renkli rollerinden en üsttekinden gelir.
      </Intro>
      {canCreate && (
        <Button title="Rol oluştur" busy={busy} disabled={others.length >= MAX_ROLES} onPress={() => void create()} />
      )}
      <SectionTitle>{`Roller — ${roles.length}`}</SectionTitle>
      <Card>
        {roles.map((role, i) => {
          const everyone = role.id === guild.id;
          const count = everyone ? members.length : members.filter((u) => u.roles.includes(role.id)).length;
          const up = !everyone && movable(role, -1);
          const down = !everyone && movable(role, 1);
          return (
            <View key={role.id}>
              {i > 0 && <View style={styles.divider} />}
              <Pressable
                onPress={() => router.push({ pathname: '/sunucu-ayarlari/rol/[id]', params: { id: role.id } })}
                android_ripple={ripple.row}
                style={styles.row}
                accessibilityRole="button"
                accessibilityLabel={`${everyone ? '@everyone' : role.name}, ${count} üye, düzenle`}
              >
                <RoleDot color={role.color} size={14} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, role.color ? { color: role.color } : null]} numberOfLines={1}>
                    {everyone ? '@everyone' : role.name}
                  </Text>
                  <Text style={styles.count}>
                    {everyone ? 'Herkes · varsayılan yetkiler' : `${count} üye`}
                  </Text>
                </View>
                {!everyone && (up || down) && (
                  <View style={{ flexDirection: 'row' }}>
                    <ArrowButton icon="chevron-up" label="Yukarı taşı" disabled={!up} onPress={() => void move(role, -1)} />
                    <ArrowButton icon="chevron-down" label="Aşağı taşı" disabled={!down} onPress={() => void move(role, 1)} />
                  </View>
                )}
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </Pressable>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = createStyles(() => ({
  divider: { height: 0.5, backgroundColor: colors.line, marginLeft: 44 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md + 2, minHeight: 56, paddingLeft: space.lg, paddingRight: space.md },
  name: { color: colors.head, fontSize: font.row, fontWeight: '600' },
  count: { color: colors.muted, fontSize: font.caption + 0.5, marginTop: 1 },
}));
