import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  memberActions,
  memberColorOf,
  moderation,
  moveTargets,
  openDirectMessage,
  useGuild,
  useSession,
} from '@diskort/client-core';
import { toast } from '../stores/ui';
import { colors } from '../theme';
import { Avatar } from './Avatar';
import { BottomSheet } from './BottomSheet';

type Confirm = 'kick' | 'ban' | 'disconnect' | null;

/**
 * Bir üyeye basınca açılan menü: başkasıysa "Mesaj gönder", sonra yetkiye ve hiyerarşiye göre yönetim:
 * seste sunucuda susturma, sağırlaştırma, başka kanala taşıma, sesten çıkarma; atma ve yasaklama. Rol
 * düzenleme masaüstünde.
 */
export function MemberSheet({ userId: requested, onClose }: { userId: string | null; onClose: () => void }) {
  // Kapanış animasyonu sürerken içerik kaybolmasın: son üye tutulur
  const last = useRef(requested);
  if (requested) last.current = requested;
  const userId = requested ?? last.current;
  const user = useGuild((s) => (userId ? s.users[userId] : undefined));
  const voice = useGuild((s) => (userId ? s.voiceStates[userId] : undefined));
  const color = useGuild((s) => memberColorOf(s, userId));
  const roleNames = useGuild((s) =>
    (user?.roles ?? [])
      .map((id) => s.roles[id])
      .filter((r) => r !== undefined)
      .sort((a, b) => b.position - a.position)
      .map((r) => r.name)
      .join(', '),
  );
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [moving, setMoving] = useState(false);
  const router = useRouter();
  const selfId = useSession((s) => s.user?.id);
  const canMessage = Boolean(user && !user.removed && userId !== selfId);

  const close = (): void => {
    setConfirm(null);
    setMoving(false);
    onClose();
  };

  const actions = userId && user && !user.removed ? memberActions(userId) : null;
  const targets = moving && user ? moveTargets(user) : [];
  const done = (ok: boolean, message: string): void => {
    if (ok) toast(message);
    close();
  };

  /** Onay isteyen işlem: ilk dokunuşta "Emin misin?", ikincide yapılır */
  const confirmed = (kind: Exclude<Confirm, null>, run: () => void): void => {
    if (confirm !== kind) {
      setConfirm(kind);
      return;
    }
    run();
  };

  const name = user?.displayName ?? '';
  const nothing =
    !canMessage &&
    actions &&
    !(voice && (actions.mute || actions.deafen || actions.move)) &&
    !actions.kick &&
    !actions.ban;

  const message = async (): Promise<void> => {
    close();
    const dm = await openDirectMessage(userId!);
    if (dm) router.push(`/channel/${dm.id}`);
  };

  return (
    <BottomSheet visible={Boolean(requested && user)} onClose={close}>
      <View style={styles.header}>
        <Avatar user={user} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, color ? { color } : null]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            @{user?.username}
            {roleNames ? ` · ${roleNames}` : ''}
          </Text>
        </View>
      </View>
      <ScrollView style={{ maxHeight: 420 }}>
        {moving ? (
          <>
            {targets.length === 0 && <Text style={styles.empty}>Taşınabilecek başka ses kanalı yok.</Text>}
            {targets.map((c) => (
              <Item
                key={c.id}
                icon="volume-medium"
                label={c.name}
                onPress={() =>
                  void moderation.move(userId!, c.id).then((ok) => done(ok, `${name} → ${c.name}`))
                }
              />
            ))}
            <Item icon="arrow-back" label="Geri" onPress={() => setMoving(false)} />
          </>
        ) : (
          <>
            {canMessage && <Item icon="chatbubble-outline" label="Mesaj gönder" onPress={() => void message()} />}
            {voice && actions?.mute && (
              <Item
                icon={voice.serverMute ? 'mic' : 'mic-off'}
                label={voice.serverMute ? 'Sunucu susturmasını kaldır' : 'Sunucuda sustur'}
                onPress={() =>
                  void moderation
                    .setServerMute(userId!, !voice.serverMute)
                    .then((ok) => done(ok, voice.serverMute ? `${name} artık konuşabilir.` : `${name} susturuldu.`))
                }
              />
            )}
            {voice && actions?.deafen && (
              <Item
                icon={voice.serverDeaf ? 'headset' : 'volume-mute'}
                label={voice.serverDeaf ? 'Sunucu sağırlaştırmasını kaldır' : 'Sunucuda sağırlaştır'}
                onPress={() =>
                  void moderation
                    .setServerDeaf(userId!, !voice.serverDeaf)
                    .then((ok) => done(ok, voice.serverDeaf ? `${name} artık duyabilir.` : `${name} sağırlaştırıldı.`))
                }
              />
            )}
            {voice && actions?.move && (
              <>
                <Item icon="swap-horizontal" label="Başka kanala taşı" onPress={() => setMoving(true)} />
                <Item
                  icon="call"
                  danger
                  label={confirm === 'disconnect' ? 'Emin misin? Sesten çıkar' : 'Sesten çıkar'}
                  onPress={() =>
                    confirmed('disconnect', () =>
                      void moderation.disconnect(userId!).then((ok) => done(ok, `${name} sesten çıkarıldı.`)),
                    )
                  }
                />
              </>
            )}
            {actions?.kick && (
              <Item
                icon="exit-outline"
                danger
                label={confirm === 'kick' ? 'Emin misin? Sunucudan at' : 'Sunucudan at'}
                onPress={() =>
                  confirmed('kick', () => void moderation.kick(userId!).then((ok) => done(ok, `${name} atıldı.`)))
                }
              />
            )}
            {actions?.ban && (
              <Item
                icon="ban"
                danger
                label={confirm === 'ban' ? 'Emin misin? Yasakla' : 'Yasakla'}
                onPress={() =>
                  confirmed('ban', () => void moderation.ban(userId!).then((ok) => done(ok, `${name} yasaklandı.`)))
                }
              />
            )}
            {nothing && <Text style={styles.empty}>Bu üye için yapabileceğin bir şey yok.</Text>}
          </>
        )}
      </ScrollView>
      <Item icon="close" label="Kapat" onPress={close} />
    </BottomSheet>
  );
}

function Item({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.hover }]}>
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.muted} />
      <Text style={[styles.itemText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  name: { color: colors.head, fontSize: 17, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 },
  itemText: { color: colors.head, fontSize: 16 },
  empty: { color: colors.muted, fontSize: 15, paddingHorizontal: 20, paddingVertical: 14 },
});
