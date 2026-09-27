import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSession } from '@diskort/client-core';

/**
 * Davet bağlantısı (diskort://davet/<kod>): oturum açıksa katılma ekranı, değilse kayıt ekranı kodla
 * hazır açılır.
 */
export default function InviteLinkScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const token = useSession((s) => s.token);
  return token ? (
    <Redirect href={{ pathname: '/sunucu-ekle', params: { code: code ?? '' } }} />
  ) : (
    <Redirect href={{ pathname: '/login', params: { code: code ?? '' } }} />
  );
}
