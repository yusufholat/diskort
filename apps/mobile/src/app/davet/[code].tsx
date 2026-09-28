import { useEffect } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { setPendingInvite, useSession } from '@diskort/client-core';

/**
 * Davet yolu (/davet/<kod>). Uygulamayı açan bağlantılar +native-intent.ts'te karşılanır; buraya başka bir
 * yoldan gelinirse de aynısı yapılır: kod bekletilir, ana ekran "Sunucu ekle"yi kodla açar. Oturum yoksa
 * giriş ekranı açılır (kayıt değil: sunucu daveti hesap açtırmaz, yalnızca hesabı olanı sunucuya katar).
 */
export default function InviteLinkScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const token = useSession((s) => s.token);
  useEffect(() => {
    if (code) setPendingInvite(code);
  }, [code]);
  return <Redirect href={token ? '/' : '/login'} />;
}
