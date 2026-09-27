import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GUILD_NAME_MAX_LENGTH, parseInviteCode, type InvitePreview } from '@diskort/shared';
import { api, createGuild, errorMessage, joinGuild, useSession } from '@diskort/client-core';
import { GuildIcon } from '../components/ServerRail';
import { Button, Field } from '../components/ui';
import { toast } from '../stores/ui';
import { colors, createStyles, font, radius, space } from '../theme';

type Tab = 'join' | 'create';

/**
 * Sunucu ekle: davet bağlantısı ya da koduyla bir sunucuya katıl veya kendi sunucunu kur. Davet
 * bağlantısından (diskort://davet/<kod>) açılınca kod hazır gelir.
 */
export default function AddGuildScreen() {
  const params = useLocalSearchParams<{ code?: string; tab?: Tab }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(params.tab === 'create' ? 'create' : 'join');
  const displayName = useSession((s) => s.user?.displayName ?? '');
  const [value, setValue] = useState(params.code ?? '');
  const [name, setName] = useState(displayName ? `${displayName} sunucusu`.slice(0, GUILD_NAME_MAX_LENGTH) : '');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = parseInviteCode(value);

  // Geçerli görünen kod yazılınca hangi sunucuya davet edildiği gösterilir
  useEffect(() => {
    setPreview(null);
    if (!code) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .previewInvite(code)
        .then((p) => !cancelled && setPreview(p))
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code]);

  const join = async (): Promise<void> => {
    if (!code) {
      setError(value.trim() ? 'Davet bağlantısı ya da kodu geçersiz.' : 'Davet bağlantısını ya da kodunu yapıştır.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const guild = await joinGuild(value);
      toast(`"${guild.name}" sunucusuna katıldın.`);
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const create = async (): Promise<void> => {
    if (!name.trim()) {
      setError('Sunucu adı boş olamaz.');
      return;
    }
    setBusy(true);
    setError(null);
    const guild = await createGuild(name);
    setBusy(false);
    if (!guild) return;
    toast(`"${guild.name}" kuruldu. Arkadaşlarını davet etmek için sunucuya uzun bas.`);
    router.back();
  };

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Sunucu ekle' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.tabs}>
            {(['join', 'create'] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => {
                  setTab(t);
                  setError(null);
                }}
                style={[styles.tab, tab === t && styles.tabActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t }}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === 'join' ? 'Sunucuya katıl' : 'Sunucu oluştur'}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === 'join' ? (
            <>
              <Text style={styles.hint}>Arkadaşının gönderdiği davet bağlantısını ya da kodunu yapıştır.</Text>
              <Field
                label="Davet bağlantısı ya da kodu"
                value={value}
                onChangeText={(t) => {
                  setValue(t);
                  setError(null);
                }}
                error={error}
                placeholder="https://diskort.ziroo.net/davet/AB12CD34"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={!params.code}
                returnKeyType="go"
                onSubmitEditing={() => void join()}
              />
              {preview?.guild && (
                <View style={styles.preview}>
                  <GuildIcon guild={preview.guild} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.previewName} numberOfLines={1}>
                      {preview.guild.name}
                    </Text>
                    <Text style={styles.hint}>{preview.memberCount} üye</Text>
                  </View>
                </View>
              )}
              <Button title="Katıl" busy={busy} onPress={() => void join()} />
            </>
          ) : (
            <>
              <Text style={styles.hint}>Metin ve ses kanalıyla hazır gelir; adını sonra da değiştirebilirsin.</Text>
              <Field
                label="Sunucu adı"
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setError(null);
                }}
                error={error}
                maxLength={GUILD_NAME_MAX_LENGTH}
                returnKeyType="done"
                onSubmitEditing={() => void create()}
              />
              <Button title="Oluştur" busy={busy} onPress={() => void create()} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.main },
  body: { padding: space.lg, gap: space.md },
  tabs: { flexDirection: 'row', backgroundColor: colors.input, borderRadius: radius.md, padding: 3 },
  tab: { flex: 1, paddingVertical: space.sm, borderRadius: radius.md - 2, alignItems: 'center' },
  tabActive: { backgroundColor: colors.active },
  tabText: { color: colors.muted, fontSize: font.small, fontWeight: '700' },
  tabTextActive: { color: colors.head },
  hint: { color: colors.muted, fontSize: font.small },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.side,
    borderRadius: radius.md,
    padding: space.md,
  },
  previewName: { color: colors.head, fontSize: font.body, fontWeight: '700' },
}));
