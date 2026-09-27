import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DM_NAME_MAX_LENGTH } from '@diskort/shared';
import { renameDm, useGuild } from '@diskort/client-core';
import { Button, Field } from '../components/ui';
import { toast } from '../stores/ui';
import { colors } from '../theme';

/** Grup konuşmasının adını değiştirmek (boş bırakılırsa üyelerin adları görünür) */
export default function RenameDmScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const dm = useGuild((s) => (id ? s.dms[id] : undefined));
  const [name, setName] = useState(dm?.name ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    if (!dm || busy) return;
    setBusy(true);
    const ok = await renameDm(dm.id, name);
    setBusy(false);
    if (ok) {
      toast('Grubun adı değişti.');
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Grubun adı' }} />
      <View style={styles.body}>
        <Field
          label="Ad"
          value={name}
          onChangeText={setName}
          maxLength={DM_NAME_MAX_LENGTH}
          placeholder="Boş bırakılırsa üyelerin adları görünür"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />
        <Button title="Kaydet" busy={busy} disabled={!dm} onPress={() => void save()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.main },
  body: { padding: 16 },
});
