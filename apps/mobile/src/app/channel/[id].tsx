import { useEffect } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { openChat } from '../../stores/nav';
import { colors } from '../../theme';

/**
 * Kanal bağlantısı (diskort://channel/<kimlik>, eski bağlantılar): kanal ya da konuşma ana ekranın
 * sohbeti yapılır ve ana ekrana dönülür. Sohbetin kendisi ana ekrandadır (ChannelChat).
 */
export default function ChannelLinkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useEffect(() => {
    if (id) openChat(id);
    router.dismissTo('/');
  }, [id]);
  return <View style={{ flex: 1, backgroundColor: colors.main }} />;
}
