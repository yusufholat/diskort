import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  memberActions,
  memberColorOf,
  moderation,
  moveTargets,
  openDirectMessage,
  useCustomStatus,
  useGuild,
  useSession,
  useStatus,
} from '@diskort/client-core';
import { usePathname, useRouter } from 'expo-router';
import { feedback, haptic } from '../haptics';
import { animateNextLayout } from '../motion';
import { showChat } from '../stores/nav';
import { toast } from '../stores/ui';
import { useVoice, voice as voiceClient } from '../voice/voice';
import { colors, createStyles, font, radius, space } from '../theme';
import { Avatar } from './Avatar';
import { BottomSheet, SheetGroup, SheetItem, SheetNote } from './BottomSheet';

type Confirm = 'kick' | 'ban' | 'disconnect' | null;

/**
 * Bir üyeye basınca açılan menü: başkasıysa "Mesaj gönder", sonra yetkiye ve hiyerarşiye göre yönetim:
 * seste sunucuda susturma, sağırlaştırma, başka kanala taşıma, sesten çıkarma; atma ve yasaklama. Rol
 * düzenleme masaüstünde.
 */
export function MemberSheet({
  userId: requested,
  onClose,
  renderExtra,
}: {
  userId: string | null;
  onClose: () => void;
  /** Başlığın altında gösterilecek ek bölüm (ör. ses ekranında kişinin ses seviyesi) */
  renderExtra?: (userId: string) => ReactNode;
}) {
  // Kapanış animasyonu sürerken içerik kaybolmasın: son üye tutulur
  const last = useRef(requested);
  if (requested) last.current = requested;
  const userId = requested ?? last.current;
  const user = useGuild((s) => (userId ? s.users[userId] : undefined));
  const voice = useGuild((s) => (userId ? s.voiceStates[userId] : undefined));
  const status = useStatus(userId);
  const custom = useCustomStatus(userId);
  const color = useGuild((s) => memberColorOf(s, userId));
  const roleNames = useGuild((s) =>
    (user?.roles ?? [])
      .map((id) => s.roles[id])
      .filter((r) => r !== undefined)
      .sort((a, b) => b.position - a.position)
      .map((r) => r.name)
      .join('\n'),
  );
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [moving, setMoving] = useState(false);
  const selfId = useSession((s) => s.user?.id);
  // Mesaj: ortak sunucusu olan herkese (DM'deki başka sunucudan biri de)
  const reachable = useGuild((s) => (userId ? Boolean(s.reachable[userId]) : false));
  const canMessage = Boolean(user && reachable && userId !== selfId);
  // Başkası ekran paylaşıyorsa "Yayını izle" (o kanalda değilsen önce katılır)
  const streaming = Boolean(voice?.streaming && userId !== selfId);
  const watchingThis = useVoice((s) => s.watching !== null && s.watching === userId);
  const router = useRouter();
  const pathname = usePathname();

  const close = (): void => {
    setConfirm(null);
    setMoving(false);
    onClose();
  };

  const actions = userId && user && !user.removed ? memberActions(userId) : null;
  const targets = moving && user ? moveTargets(user) : [];
  const done = (ok: boolean, message: string): void => {
    feedback(ok ? 'moderate' : 'error');
    if (ok) toast(message);
    close();
  };

  /** Onay isteyen işlem: ilk dokunuşta "Emin misin?", ikincide yapılır */
  const confirmed = (kind: Exclude<Confirm, null>, run: () => void): void => {
    if (confirm !== kind) {
      animateNextLayout(160);
      setConfirm(kind);
      return;
    }
    run();
  };

  const name = user?.displayName ?? '';
  const extra = userId ? renderExtra?.(userId) : null;
  const voiceActions = Boolean(voice && actions && (actions.mute || actions.deafen || actions.move));
  const nothing = !extra && !canMessage && !streaming && actions && !voiceActions && !actions.kick && !actions.ban;
  const roles = roleNames ? roleNames.split('\n') : [];

  const message = async (): Promise<void> => {
    close();
    const dm = await openDirectMessage(userId!);
    if (dm) showChat(dm.id);
  };

  const watchStream = async (): Promise<void> => {
    const target = userId!;
    const channelId = voice!.channelId;
    close();
    if (watchingThis) {
      voiceClient.watch(null);
      return;
    }
    const current = useVoice.getState();
    if (current.channelId !== channelId || current.status === 'idle') {
      haptic('join');
      try {
        await voiceClient.join(channelId);
      } catch (err) {
        feedback('error');
        toast((err as Error).message, 'error');
        return;
      }
      if (useVoice.getState().channelId !== channelId) return;
    }
    voiceClient.watch(target);
    if (pathname !== '/voice') router.push('/voice');
  };

  return (
    <BottomSheet visible={Boolean(requested && user)} onClose={close}>
      <View style={styles.header}>
        <Avatar user={user} size={56} status={user?.removed ? undefined : status} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, color ? { color } : null]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            @{user?.username}
            {voice ? ' · Sesli sohbette' : ''}
          </Text>
          {custom ? (
            <Text style={styles.sub} numberOfLines={2}>
              {custom.emoji ? `${custom.emoji} ` : ''}
              {custom.text}
            </Text>
          ) : null}
        </View>
      </View>
      {roles.length > 0 && !moving && (
        <View style={styles.roles}>
          {roles.map((r) => (
            <View key={r} style={styles.role}>
              <Text style={styles.roleText}>{r}</Text>
            </View>
          ))}
        </View>
      )}
      {!moving && extra}
      <ScrollView style={styles.scroll} bounces={false}>
        {moving ? (
          <>
            <SheetNote>{name} hangi ses kanalına taşınsın?</SheetNote>
            {targets.length === 0 && <SheetNote>Taşınabilecek başka ses kanalı yok.</SheetNote>}
            <SheetGroup>
              {targets.map((c) => (
                <SheetItem
                  key={c.id}
                  icon="volume-medium"
                  label={c.name}
                  onPress={() => void moderation.move(userId!, c.id).then((ok) => done(ok, `${name} → ${c.name}`))}
                />
              ))}
            </SheetGroup>
            <SheetGroup>
              <SheetItem
                icon="arrow-back"
                label="Geri"
                onPress={() => {
                  animateNextLayout(180);
                  setMoving(false);
                }}
              />
            </SheetGroup>
          </>
        ) : (
          <>
            {streaming && (
              <SheetGroup>
                <SheetItem
                  icon={watchingThis ? 'eye-off' : 'eye'}
                  label={watchingThis ? 'İzlemeyi bırak' : 'Yayını izle'}
                  onPress={() => void watchStream()}
                />
              </SheetGroup>
            )}
            {canMessage && (
              <SheetGroup>
                <SheetItem icon="chatbubble-outline" label="Mesaj gönder" onPress={() => void message()} />
              </SheetGroup>
            )}
            {voice && voiceActions && (
              <SheetGroup>
                {actions?.mute && (
                  <SheetItem
                    key="mute"
                    icon={voice.serverMute ? 'mic' : 'mic-off'}
                    label={voice.serverMute ? 'Sunucu susturmasını kaldır' : 'Sunucuda sustur'}
                    onPress={() =>
                      void moderation
                        .setServerMute(userId!, !voice.serverMute)
                        .then((ok) => done(ok, voice.serverMute ? `${name} artık konuşabilir.` : `${name} susturuldu.`))
                    }
                  />
                )}
                {actions?.deafen && (
                  <SheetItem
                    key="deafen"
                    icon={voice.serverDeaf ? 'headset' : 'volume-mute'}
                    label={voice.serverDeaf ? 'Sunucu sağırlaştırmasını kaldır' : 'Sunucuda sağırlaştır'}
                    onPress={() =>
                      void moderation
                        .setServerDeaf(userId!, !voice.serverDeaf)
                        .then((ok) => done(ok, voice.serverDeaf ? `${name} artık duyabilir.` : `${name} sağırlaştırıldı.`))
                    }
                  />
                )}
                {actions?.move && (
                  <SheetItem
                    key="move"
                    icon="swap-horizontal"
                    label="Başka kanala taşı"
                    onPress={() => {
                      animateNextLayout(180);
                      setMoving(true);
                    }}
                  />
                )}
              </SheetGroup>
            )}
            {(voice && actions?.move) || actions?.kick || actions?.ban ? (
              <SheetGroup>
                {voice && actions?.move && (
                  <SheetItem
                    key="disconnect"
                    icon="call"
                    danger
                    label={confirm === 'disconnect' ? 'Emin misin? Sesten çıkar' : 'Sesten çıkar'}
                    onPress={() =>
                      confirmed('disconnect', () =>
                        void moderation.disconnect(userId!).then((ok) => done(ok, `${name} sesten çıkarıldı.`)),
                      )
                    }
                  />
                )}
                {actions?.kick && (
                  <SheetItem
                    key="kick"
                    icon="exit-outline"
                    danger
                    label={confirm === 'kick' ? 'Emin misin? Sunucudan at' : 'Sunucudan at'}
                    hint={confirm === 'kick' ? 'Davet koduyla yeniden katılabilir.' : undefined}
                    onPress={() =>
                      confirmed('kick', () => void moderation.kick(userId!).then((ok) => done(ok, `${name} atıldı.`)))
                    }
                  />
                )}
                {actions?.ban && (
                  <SheetItem
                    key="ban"
                    icon="ban"
                    danger
                    label={confirm === 'ban' ? 'Emin misin? Yasakla' : 'Yasakla'}
                    hint={confirm === 'ban' ? 'Yasak kaldırılana kadar geri dönemez.' : undefined}
                    onPress={() =>
                      confirmed('ban', () => void moderation.ban(userId!).then((ok) => done(ok, `${name} yasaklandı.`)))
                    }
                  />
                )}
              </SheetGroup>
            ) : null}
            {nothing && <SheetNote>Bu üye için yapabileceğin bir şey yok.</SheetNote>}
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = createStyles(() => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md + 2,
    paddingHorizontal: space.lg + 2,
    paddingBottom: space.md,
  },
  name: { color: colors.head, fontSize: font.heading, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: font.small, marginTop: 2 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: space.lg + 2, paddingBottom: space.md },
  role: { backgroundColor: colors.main, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  roleText: { color: colors.text, fontSize: font.caption, fontWeight: '600' },
  // Uzun menü (çok kanal) sayfanın sınırlı yüksekliğine sığsın diye daralabilir
  scroll: { flexShrink: 1, flexGrow: 0 },
}));
