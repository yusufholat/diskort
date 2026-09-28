import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { CHANNEL_NAME_MAX_LENGTH, Permission, type ChannelType } from '@diskort/shared';
import { api, channelNameFor, errorMessage, typedChannelName, useCan, useGuild } from '@diskort/client-core';
import { NoAccess, SettingsPage, useSettingsGuild } from '../../components/serverSettings/common';
import { Button, Field, SectionTitle } from '../../components/ui';
import { feedback } from '../../haptics';
import { showChat } from '../../stores/nav';
import { toast } from '../../stores/ui';
import { colors, createStyles, font, radius, ripple, space } from '../../theme';

const TYPES: { type: ChannelType; label: string; hint: string }[] = [
  { type: 'text', label: 'Metin', hint: 'Mesajlar, resimler, bağlantılar, fikirler' },
  { type: 'voice', label: 'Ses', hint: 'Sesli sohbet ve ekran paylaşımı' },
];

/** Kanal oluşturma (masaüstündeki Kanal Oluştur penceresi): tür ve ad */
export default function CreateChannelScreen() {
  const guild = useSettingsGuild();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const canManage = useCan(Permission.MANAGE_CHANNELS);
  const [type, setType] = useState<ChannelType>(params.type === 'voice' ? 'voice' : 'text');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!guild) return null;
  const finalName = channelNameFor(type, name);

  const submit = async (): Promise<void> => {
    if (!finalName) {
      setError('Kanal adı boş olamaz.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createChannel(guild.id, { name: finalName, type });
      // Gateway olayını beklemeden listeye koy (açılacak sohbet tanınsın; olay gelince tekrar zararsız)
      useGuild.getState().apply({ t: 'CHANNEL_CREATE', d: created });
      feedback('tick');
      toast(created.type === 'text' ? `#${created.name} oluşturuldu.` : `"${created.name}" oluşturuldu.`);
      // Metin kanalı hemen açılır (masaüstündeki gibi); ses kanalı listede belirir
      if (created.type === 'text') showChat(created.id);
      else router.back();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <SettingsPage>
      <Stack.Screen options={{ title: 'Kanal oluştur' }} />
      {!canManage ? (
        <NoAccess text="Bu sunucuda kanal oluşturma yetkin yok." />
      ) : (
        <>
          <SectionTitle>Kanal türü</SectionTitle>
          <View style={styles.types} accessibilityRole="radiogroup">
            {TYPES.map((t) => {
              const selected = t.type === type;
              return (
                <Pressable
                  key={t.type}
                  onPress={() => {
                    setType(t.type);
                    setName((n) => (t.type === 'text' ? typedChannelName('text', n) : n));
                  }}
                  android_ripple={ripple.row}
                  style={[styles.type, selected && styles.typeSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  {t.type === 'text' ? (
                    <Feather name="hash" size={24} color={selected ? colors.head : colors.muted} />
                  ) : (
                    <Ionicons name="volume-medium" size={24} color={selected ? colors.head : colors.muted} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.typeLabel}>{t.label}</Text>
                    <Text style={styles.typeHint}>{t.hint}</Text>
                  </View>
                  <View style={[styles.radio, selected && styles.radioOn]} />
                </Pressable>
              );
            })}
          </View>
          <View style={{ marginTop: space.xl }}>
            <Field
              label="Kanal adı"
              value={name}
              onChangeText={(v) => {
                setName(typedChannelName(type, v));
                setError(null);
              }}
              placeholder={type === 'text' ? 'yeni-kanal' : 'Yeni Kanal'}
              maxLength={CHANNEL_NAME_MAX_LENGTH}
              autoFocus
              autoCapitalize={type === 'text' ? 'none' : 'sentences'}
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              error={error}
            />
          </View>
          <Text style={styles.note}>
            Kanalı yalnızca bazı rollerin görmesini istersen oluşturduktan sonra kanala uzun bas → Kanalı düzenle →
            İzinler.
          </Text>
          <Button title="Kanal oluştur" busy={busy} disabled={!finalName} onPress={() => void submit()} />
        </>
      )}
    </SettingsPage>
  );
}

const styles = createStyles(() => ({
  types: { gap: space.sm },
  type: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg - 4,
    backgroundColor: colors.side,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  typeSelected: { backgroundColor: colors.active, borderColor: colors.brand },
  typeLabel: { color: colors.head, fontSize: font.row, fontWeight: '600' },
  typeHint: { color: colors.muted, fontSize: font.caption + 0.5, marginTop: 1 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.muted },
  radioOn: { borderWidth: 7, borderColor: colors.head },
  note: { color: colors.muted, fontSize: font.caption + 0.5, lineHeight: 18, marginBottom: space.lg },
}));
