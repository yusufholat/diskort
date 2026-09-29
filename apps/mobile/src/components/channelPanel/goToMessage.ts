import { jumpToMessage } from '@diskort/client-core';
import { showChat } from '../../stores/nav';

/** Panelden sohbete döner ve mesaja atlar (medya, bağlantı, sabitleme) */
export function goToMessage(channelId: string, messageId: string): void {
  showChat(channelId);
  // Ekranlar kapandıktan sonra kaydırılır
  setTimeout(() => {
    void jumpToMessage(channelId, messageId, {
      maxPages: 30,
      notFound: 'Mesaj geçmişte bulunamadı; çok eskide kalmış olabilir.',
    });
  }, 230);
}
