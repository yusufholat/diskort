import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { Ban, Guild } from '@diskort/shared';
import { api, errorMessage, moderation } from '@diskort/client-core';
import { animateNextLayout } from '../../motion';
import { toast } from '../../stores/ui';
import { colors, createStyles, font, space } from '../../theme';
import { Avatar } from '../Avatar';
import { confirmDialog } from '../Dialog';
import { Button, Card } from '../ui';
import { Intro } from './common';

/** Yasaklı hesaplar; yasak kalkınca kişi yeni bir davetle geri dönebilir */
export function BansSection({ guild }: { guild: Guild }) {
  const [bans, setBans] = useState<Ban[] | null>(null);

  const load = useCallback((): void => {
    api
      .listBans(guild.id)
      .then((list) => {
        animateNextLayout(180);
        setBans(list);
      })
      .catch((err) => toast(errorMessage(err), 'error'));
  }, [guild.id]);
  useEffect(load, [load]);

  const unban = async (ban: Ban): Promise<void> => {
    const ok = await confirmDialog({
      title: `${ban.user.displayName} kişisinin yasağı kaldırılsın mı?`,
      message: 'Yeni bir davetle sunucuya geri dönebilir.',
      icon: 'lock-open-outline',
      confirmLabel: 'Yasağı kaldır',
    });
    if (!ok || !(await moderation.unban(ban.user.id))) return;
    toast(`${ban.user.displayName} kişisinin yasağı kaldırıldı.`);
    load();
  };

  return (
    <View>
      <Intro>
        Yasaklı kişiler bu sunucuya davetle geri dönemez (hesapları ve diğer sunucuları etkilenmez). Yasağı kaldırılan
        kişi yeni bir davetle geri dönebilir.
      </Intro>
      <Card>
        {bans === null ? (
          <ActivityIndicator color={colors.muted} style={{ padding: space.lg }} />
        ) : bans.length === 0 ? (
          <Text style={styles.empty}>Yasaklı kimse yok.</Text>
        ) : (
          bans.map((ban, i) => (
            <View key={ban.user.id}>
              {i > 0 && <View style={styles.divider} />}
              <View style={styles.row}>
                <Avatar user={ban.user} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {ban.user.displayName} <Text style={styles.username}>@{ban.user.username}</Text>
                  </Text>
                  <Text style={styles.meta} numberOfLines={2}>
                    {new Date(ban.bannedAt).toLocaleString('tr-TR')}
                    {ban.reason ? ` · ${ban.reason}` : ' · sebep belirtilmedi'}
                  </Text>
                </View>
              </View>
              <View style={styles.action}>
                <Button title="Yasağı kaldır" variant="secondary" onPress={() => void unban(ban)} />
              </View>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

const styles = createStyles(() => ({
  empty: { color: colors.muted, fontSize: font.small, padding: space.lg },
  divider: { height: 0.5, backgroundColor: colors.line, marginLeft: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md },
  name: { color: colors.head, fontSize: font.row, fontWeight: '600' },
  username: { color: colors.muted, fontSize: font.caption, fontWeight: '400' },
  meta: { color: colors.muted, fontSize: font.caption, marginTop: 2 },
  action: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md },
}));
